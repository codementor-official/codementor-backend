# CodeMentor AI Service — Python

Document-guided AI Tutor with separately labeled teaching explanations. Port 3008, internal HTTP only.
The old NestJS AI placeholder has been removed; do not start a stale dist/apps/ai-service.

## Local setup

Python 3.12 is managed by uv, consistent with the existing Python Judge service.
From the backend root:

~~~powershell
npm run ai:install
npm run migrate:ai
npm run start:ai
~~~

The migration uses the sibling codementor-infra repository's Mongo validators. It is
idempotent and does not change PostgreSQL or existing learning data. It has already been
applied to the configured development database during this implementation.

Read the same **codementor-backend/.env** as the Node services:

~~~dotenv
OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_CHAT_MODEL=gpt-5-nano
AI_SERVICE_URL=http://localhost:3008
AI_REQUEST_TIMEOUT_MS=90000
AI_DAILY_REQUEST_LIMIT=50
~~~

INTERNAL_SERVICE_TOKEN must be a random shared secret of at least 24 characters and match
Workspace Service. A local secret was prepared in the untracked ENV. Do not put it or the
OpenAI key into frontend ENV, commits or logs. Restart AI Service after adding the key.
MONGO_URI/MONGO_DB and the existing AWS_S3_*/AWS_* settings are reused. No second bucket,
upload flow, public file mirror or new vector service is required.

Run Core, Workspace, the existing gateway and Client as usual. The service manager also
supports `npm run services -- start ai`. Nest's build:all builds Node services only;
`npm run ai:check` validates Python separately. Container build uses this folder's Dockerfile
and uv.lock; no host port is published in the backend Compose configuration.

## Public surface: /api/v1/ai/*

Ngoài đường nội bộ, service có một đường CÔNG KHAI sau Kong. Nó tự kiểm JWT Keycloak trong
`app/auth.py` (copy từ judge-service — Kong ở dự án này không có plugin JWT).

~~~dotenv
KEYCLOAK_ISSUER=          # PHẢI trùng issuer mà Nest và judge đang dùng, không đặt biến riêng
KEYCLOAK_AUDIENCE=        # để trống nếu Keycloak chưa có audience mapper
AI_SUGGEST_DAILY_LIMIT=100
~~~

`POST /api/v1/ai/suggest/test-cases` — gợi ý ĐẦU VÀO cho test case từ đề bài đang soạn.
`count` là 1–5, mặc định 3 — người soạn chọn ở ô ngay cạnh nút trong studio. Không bao giờ trả
`expected`: studio lấy đáp án bằng nút "Sinh đáp án", tức là bằng cách chạy lời giải mẫu thật
qua judge. Đề bài rỗng hoặc quá ngắn bị từ chối trước khi tiêu một lời gọi model; chế độ hàm
còn phải có chữ ký kèm ít nhất một tham số.

Route Kong ở `kong/kong.yml` (`ai-service`, `read_timeout: 300000`) chỉ mở `/api/v1/ai`.
`/api/v1/internal/*` KHÔNG nằm trong đó và vẫn chỉ tới được từ trong mạng Docker.

## Đo đếm: `ai_call_events`

`app/telemetry.py` ghi một dòng cho mỗi lời gọi model (token vào/ra, độ trễ, lỗi), mỗi lần chặn
hạn mức và mỗi run agent hỏng; không ghi prompt hay nội dung. Agent/người dùng lấy từ phạm vi đặt
ở cửa vào (`telemetry.set_scope`). Collection có validator + TTL 90 ngày ở
`codementor-infra/database/mongo/schemas/10-ai-call-events.js` — chạy `npm run migrate:ai` TRƯỚC
khi deploy, nếu không Mongo tự tạo collection không có TTL.

`GET /api/v1/ai/admin/stats?days=7|30` (realm role admin) là nguồn số liệu của trang Vận hành AI.

## Client flow

/ai-tutor → choose an existing membership → search approved documents → select 1–8 sources
→ ask a question → the answer streams in (preparing → finding passages → writing → checking
quotes) → the finished turn shows verified excerpts and a separate "Giải thích & mở rộng" block.
Learning shortcuts and document selection stay in the right rails. Documents can be added or
swapped between questions; each question uses exactly the documents selected when it is sent.
No manual indexing is exposed to learners and a failed job is never retried silently.
Conversations belong to the authenticated user and chosen Workspace.
Summaries and practice questions are generated as chat answers, not saved exercise entities.

## Architecture

The Tutor runs on the same agent stack as Codey and Lecter (`app/tutor/`):

Browser (`useAgent("tutor")`) → Next `/api/copilotkit/t/<slug>` → `POST /api/v1/ai/tutor/workspace/:slug/run`
(Keycloak JWT, AG-UI over SSE) → `stream_run` → fixed LangGraph `wait ⟲ → retrieve → generate → verify`.

- Before the stream opens, the route calls workspace-service with the user's own token:
  `GET /workspaces/:slug` (membership) and `POST /workspaces/:slug/ai/documents/prepare`
  (view_doc + approved-only + queue indexing). Bad selection, missing permission or a failed
  document is a real 4xx and costs no daily request.
- `wait` polls `documents/status` (2.5 s, max 3 min), reporting progress in `state.step`.
- The model writes two marked blocks (`<<<TRICH_DAN>>>` / `<<<GIAI_THICH>>>`) so text can
  stream. `verify` (`app/tutor/answer.py::ground`) keeps only quotes that are literal
  substrings of the cited passage — the same rule as before — and stores the turn in
  `state.grounding[<user message id>]`.
- History lives in `ai_agent_sessions` (agentId `tutor`, plus `grounding` and `documents`).
  The run route reloads `grounding` from Mongo; the browser's copy is never trusted.
  Old `ai_conversations` are moved with `npm run migrate:tutor-conversations` (dry-run by default).
- workspace-service keeps only the document facade under /api/v1/workspaces/:slug/ai:
  GET status, GET documents, POST documents/prepare, POST documents/status,
  POST documents/:id/index. Python's internal `POST /api/v1/internal/workspace-ai/:action`
  accepts only `status`, `documents`, `index`.
- Approved PDF text, DOCX paragraphs/tables, PPTX slide text/tables/groups and UTF-8
  TXT/Markdown are supported. PDF/PPTX citations carry actual page/slide numbers;
  DOCX/TXT/Markdown have no fabricated page numbers. Binary DOC/PPT need conversion first.
- Extraction runs in a killable subprocess (40 seconds). PDF: up to 100 pages. Files: 20 MB
  or the lower DOCUMENT_MAX_UPLOAD_MB limit. Office expanded ZIP content: at most 40 MB.
  PPTX: up to 100 slides. Extraction works under Windows Uvicorn reload's SelectorEventLoop.
  Linux parser process has a memory ceiling; Windows relies on process/time/input limits.
- Token-based chunks: 600 tokens with 80-token overlap, at most 160 chunks per document.
  Embeddings use 1536 dimensions. Mongo stores text and vectors; bounded cosine retrieval
  scans only the selected approved document revisions (max 8 documents).
- The Mongo indexing queue uses atomic leases. Interrupted jobs resume; failed jobs require
  explicit retry. Source IDs/model/revision prevent duplicate indexing of unchanged documents.
  Index copies expire after 30 days and can be rebuilt; conversation history expires after 90 days.
- Retrieval keeps each ready index's vectors in an in-process LRU keyed by `(_id, updatedAt)`,
  so a question no longer reloads every embedding from Mongo.
- Generation uses the Responses API (store=false, low reasoning/verbosity, 3000-token cap)
  through the shared `chat_model()`; the last three turns go back to the model in their
  verified form. Quotes are checked for literal membership in the corresponding retrieved
  text (normalizing only whitespace). The public `answer` is assembled from verified excerpts, not model-written
  claims: a valid source ID alone cannot substantiate an invented fact.
  The explanation block (`supplementalAnswer`) contains teaching explanations/examples and is rendered under
  a distinct "Giải thích & mở rộng" label, never with document citations. Insufficient direct
  evidence does not discard a relevant supplemental explanation. Unrelated questions and
  unknown private facts (deadlines, author intent, group rules) are instructed to abstain.
  Invalid quotes/IDs are excluded; supplemental text with source markers is discarded.
  Literal verification proves excerpt provenance, not interpretation or relevance. General
  explanations remain model-generated and can be incorrect; they are never labeled quotations.
  Low-similarity follow-ups receive at most three fallback excerpts from the selected sources
  instead of an unconditional refusal, so the model can assess whether they are on topic.
  Documents are treated as untrusted data, not system instructions. Generated HTML/images
  and arbitrary clickable links are not rendered in chat.
- Per-user daily budget (`rag` key, shared with indexing) is charged once per run; bounded
  model output and timeouts prevent unlimited requests. Conversations are capped at 50 turns.
- While streaming, quotes are shown dimmed as "đang đối chiếu"; only `grounding` decides what is
  labelled "Từ tài liệu của bạn".

## Scope and limitations

This is RAG for approved Workspace documents, not a universal AI agent. OCR for scanned
PDFs/images, DOC/PPT/XLS import, web crawling, model-based recommendation ranking,
automatic content classification and exercise-studio generation are not added here.
Existing recommendation logic is unchanged; OPENAI_EMBEDDING_MODEL is the shared default
for a future vector recommendation pipeline, not a claim that pipeline is already deployed.

Indexing sends extracted chunks to OpenAI; questions send a bounded set of relevant excerpts.
The UI discloses this. store=false is a Responses setting, not a guarantee of zero retention
under the OpenAI account's data policy.

Local browser smoke test (2026-09-03) exercised automatic preparation with the configured
provider and reloaded persisted history. A metadata-only source initially triggered an
unsupported model assertion. Strict source-only prompting then over-refused related questions.
Following user feedback, the model now separates direct evidence from related teaching in
two output fields. It still forbids attributing outside facts to titles or reference URLs.
This is a smoke test, not a comprehensive quality evaluation: citation-ID checks and prompts
reduce, but cannot eliminate, model errors. Sparse demo notes are not full course documents.

## Verification

~~~powershell
npm run ai:lint
npm run ai:check
npm run ai:test
# Optional actual Mongo integration, isolated test database, no OpenAI calls:
cd apps/ai-service
$env:AI_TEST_LIVE_MONGO='1'
uv run pytest tests/test_rag_mongo.py -q
~~~

Mongo integration creates a unique codementor_ai_test_<uuid> database, copies only
validators, and removes that exact temporary database afterward. No production content is
seeded or deleted. Tests cover extraction, citations, queue recovery, isolation, pagination,
concurrent requests, replay and history persistence. Nest unit tests cover Workspace
permissions and moderation state before and after generation.

Official API references used:
[Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering),
[PowerPoint extraction](https://python-pptx.readthedocs.io/en/latest/user/quickstart.html),
[Embeddings](https://developers.openai.com/api/docs/guides/embeddings),
[Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano).
