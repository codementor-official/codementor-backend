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

## Client flow

/ai-tutor → choose an existing membership → search approved documents → select 1–8 sources
→ ask a question → automatically prepare the selected sources → answer with citation excerpts.
The restored chat-first layout keeps learning shortcuts and document selection in right rails.
No manual indexing is exposed to learners. Preparing/polling uses only selected IDs, rechecks
access on every request, and never silently retries a failed job. Sending again retries it.
Conversations belong to the authenticated user and chosen Workspace. Sources are immutable
for a conversation; select New conversation to change them. Search/pagination, loading,
processing, missing-key, unsupported-format and failure states use real APIs.
Summaries and practice questions are generated as chat answers, not saved exercise entities.

## Architecture

Client → Workspace Service (token identity + membership + view_doc + approval checks)
→ Python AI Service (shared internal token) → Mongo / existing S3 / OpenAI.

- Public endpoints under /api/v1/workspaces/:slug/ai:
  GET status, GET documents (supported formats filtered before pagination),
  POST documents/prepare, POST documents/status, POST documents/:id/index (compatibility),
  GET/POST conversations, GET/DELETE conversations/:id,
  POST conversations/:id/messages.
- Python accepts POST /api/v1/internal/workspace-ai/:action using a strict internal contract.
  Browser-supplied userId, storage keys and arbitrary source URLs are not accepted by the
  public facade. Backend checks apply to owner/deputy/member, not just UI visibility.
- Each answer and history read revalidates approved, non-deleted sources. The facade checks
  permission again after generation. Changed document revisions invalidate old conversations.
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
  Index copies expire after 30 days and can be rebuilt; conversation history persists until deleted.
- Generation uses Responses API with store=false and strict JSON output. Model `sourceQuotes`
  are checked for literal membership in the corresponding retrieved text (normalizing only
  whitespace). The public `answer` is assembled from verified excerpts, not model-written
  claims: a valid source ID alone cannot substantiate an invented fact.
  `supplementalAnswer` contains teaching explanations/examples and is rendered under
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
- Per-user daily budget covers questions and indexing requests; bounded model output and
  timeouts prevent unlimited requests. Conversation leases prevent parallel answers.
  Repeated successful request IDs replay the saved answer instead of paying again.
- No live token streaming yet: UI shows a pending state, then the complete grounded response.

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
