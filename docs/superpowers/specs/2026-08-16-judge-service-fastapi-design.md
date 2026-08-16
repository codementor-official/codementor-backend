# judge-service sang FastAPI — Thiết kế

Ngày: 2026-08-16
Phạm vi: `codementor-backend/apps/judge-service`, cấu hình monorepo, `kong/kong.yml`, `docker-compose.yml`.
Không đụng frontend, không đụng 8 service còn lại.

Engine tham khảo: `/home/nguyen/Workspace/python/code-runner/backend`.

---

## 1. Hiện trạng

**judge-service hôm nay là một cái vỏ.** Hai file, không có logic chấm bài nào:
`main.ts` gọi `bootstrapService`, `app.module.ts` khai báo `ConfigModule`, `HealthModule`,
`HttpModule`, `LoggingModule`, `PrismaModule`, `MessagingModule`. Không đăng ký handler Kafka
nào, không có sandbox, không có ngôn ngữ nào chạy được.

`submission-service` cũng vậy — hai file rỗng. Nghĩa là **hiện không có ai phát
`cmd.judge.run.v1`**, và một judge chỉ nghe Kafka sẽ không nhận được việc nào cho tới khi
submission-service được viết.

Hợp đồng thì đã có đủ, ở `libs/contracts/src/events`:

```ts
JudgeRunV1        { submissionId, language, sourceCode, timeLimitMs, memoryLimitKb,
                    testCases: { order, input, expected, weight }[] }
JudgeStartedV1    { submissionId, worker }
JudgeCompletedV1  { submissionId, verdict, score, passedTests, totalTests,
                    runtimeMs, memoryKb, runDetailRef }
```

Topic: `cmd.judge.run.v1` → `evt.judge.started.v1` + `evt.judge.completed.v1`.
Partition key là `submissionId`. Envelope chung ở `envelope.ts` (`eventId`, `eventName`,
`occurredAt`, `correlationId`, `causationId`, `actor`, `producer`, `payload`).

Engine tham khảo có đúng thứ còn thiếu: một `docker_executor.py` đã hardened, kèm comment ghi
lại kết quả đo thật (vì sao `max_pool_size=128`, vì sao semaphore là nút thắt chứ không phải
CPU, vì sao `container.stats()` trễ 1–2s nên `peak_memory_mb` thường là None).

## 2. Quyết định đã chốt

| # | Quyết định | Lý do |
|---|---|---|
| D1 | Python nằm tại `apps/judge-service/`, thay chỗ code TS | Gần các service khác. Chỉ 3 chỗ trong monorepo cần loại trừ — đã kiểm. |
| D2 | **Cả** `POST /run` **lẫn** Kafka consumer | HTTP dùng được ngay khi submission-service còn rỗng; Kafka đúng kiến trúc khi nó xong. Cùng một engine, hai cửa vào. |
| D3 | Judge tự ghi `submission_run_details`, trả `_id` | Validator Mongo đã có sẵn nhánh `judge.worker/imageTag/languageVersion` — nó được thiết kế cho judge ghi. Đẩy chi tiết từng case qua Kafka thì payload phình theo số test case. |
| D4 | Script trong `codementor-backend/package.json` | Một chỗ chạy mọi thứ. |
| D5 | Judge0 giữ lại, không nối dây | Máy hiện tại kẹt cgroup v1/v2 nên Judge0 không chạy. Giữ code + config để bật lại được, `EXECUTION_ENGINE` mặc định `docker`. |

**Lưu ý về D3:** `docs/02-service-architecture.md` gán `submission_run_details` cho
submission-service, và bảng ở §5 ghi judge "**0** — không sở hữu bảng nào". Ghi Mongo từ judge
đi ngược mô tả đó. Chấp nhận vì schema đã chừa chỗ cho judge, nhưng cần sửa lại hai dòng docs
đó cho khớp thực tế thay vì để tài liệu nói một đằng code làm một nẻo.

## 3. Thiết kế

### 3.1 Gỡ khỏi monorepo Nest

Ba chỗ, không hơn:

| File | Sửa |
|---|---|
| `nest-cli.json` | bỏ khoá `judge-service` khỏi `projects` |
| `package.json` | bỏ `&& nest build judge-service` khỏi `build:all` |
| `eslint.config.mjs` | bỏ `'judge-service'` khỏi mảng `APPS` (dòng 6) |

Xoá `apps/judge-service/src/` và `tsconfig.app.json`.

### 3.2 Cấu trúc

```
apps/judge-service/
  app/
    __init__.py
    main.py              FastAPI, lifespan bật/tắt Kafka consumer
    config.py            pydantic-settings, đọc .env của backend
    api.py               POST /run, GET /health
    auth.py              xác thực JWT Keycloak (xem 3.6)
    messaging/
      envelope.py        dựng EventEnvelope khớp libs/contracts
      consumer.py        aiokafka: nhận cmd.judge.run.v1, phát started/completed
      dedupe.py          processed_events (consumer, event_id) qua asyncpg
    run_details.py       ghi submission_run_details qua motor
    services/
      __init__.py
      docker_executor.py     port từ code-runner
      execution_config.py    port, tag image đổi thành codementor-runner-*
      execution_engine.py    chọn docker | judge0
      judgement.py           verdict theo từ vựng CodeMentor
      judge0_client.py       giữ lại, không ai gọi — nhưng vẫn phải import được
  docker/
    python.Dockerfile cpp.Dockerfile java.Dockerfile
    node.Dockerfile   go.Dockerfile php.Dockerfile
  tests/
    test_judgement.py         bảng verdict + score, không cần Docker
    test_grading_docker.py    chấm thật bằng container, đánh dấu `docker`
  pyproject.toml
  Dockerfile
  README.md
```

### 3.3 Verdict và score

Ánh xạ từ vựng engine sang từ vựng CodeMentor:

| docker_executor | JudgeCompletedV1 |
|---|---|
| `Passed` | `accepted` |
| `Wrong Answer` | `wrong_answer` |
| `Compile Error` | `compile_error` |
| `Runtime Error` | `runtime_error` |
| `Time Limit Exceeded` | `timeout` |
| — | `memory_exceeded` ← **phải thêm** |

`memory_exceeded` không tồn tại trong engine tham khảo. Docker giết tiến trình vượt
`mem_limit` bằng OOM killer, và kết quả đến tay ta là `exit_code == 137`. Nhưng 137 cũng là
kết quả của SIGKILL vì bất kỳ lý do gì, nên chỉ dựa vào exit code là đoán mò: đọc
`container.attrs["State"]["OOMKilled"]` sau `wait()` mới là câu trả lời chắc chắn.
`RunOutcome` nhận thêm trường `oom_killed`.

Verdict của cả bài, theo thứ tự ưu tiên:

1. Biên dịch hỏng → `compile_error` (không case nào chạy)
2. Mọi case `accepted` → `accepted`
3. Còn lại → verdict của case hỏng **đầu tiên**

`score` = `sum(weight của case pass) / sum(weight) * 100`, làm tròn về int. `weight` đã có
trong `JudgeRunV1.testCases[]` và hiện chưa ai dùng; mặc định 1 khi vắng mặt hoặc khi tổng
weight bằng 0.

`runtimeMs` = tổng thời gian các case. `memoryKb` = đỉnh trong các case, hoặc 0 khi không đo
được — xem giới hạn ở 3.7.

### 3.4 Hai cửa vào, một engine

```
POST /api/v1/judge/run                cmd.judge.run.v1 (Kafka)
        │                                      │
        │                              evt.judge.started.v1
        │                                      │
        └──────────► run_against_testcases() ◄─┘
                              │
                    ┌─────────┴─────────┐
              trả JSON đồng bộ    ghi Mongo → evt.judge.completed.v1
```

`POST /run` nhận đúng shape `JudgeRunV1` (trừ `submissionId`, tuỳ chọn) và trả verdict + chi
tiết từng case ngay trong response. Không ghi Mongo, không phát event: nó là đường "chạy thử",
không phải bài nộp.

Consumer Kafka nhận cùng payload, phát `started`, chạy, ghi Mongo, phát `completed` kèm
`runDetailRef`.

### 3.5 Khử trùng lặp

Kafka là at-least-once. Bảng `processed_events` với khoá chính `(consumer, event_id)` đã tồn
tại trong `prisma/schema.prisma` và là cách 8 service Nest chống trùng. Judge dùng đúng bảng
đó qua asyncpg:

```sql
INSERT INTO processed_events (consumer, event_id, topic)
VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
```

Không chèn được nghĩa là đã xử lý → bỏ qua. Handler ném lỗi thì xoá dòng đó để lần giao lại
còn chạy, giống `EventConsumer.unmarkProcessed` bên Nest.

Ghi Mongo dùng `update_one(..., upsert=True)` trên `submissionId`, vì collection có index
`uq_submission_id` unique — chấm lại cùng một submission mà `insert_one` là đụng khoá.

### 3.6 Sandbox và bề mặt tấn công

Code học viên chạy trong container ephemeral, port nguyên cấu hình đã được code-runner đo:

```
network_mode=none, network_disabled=True   không có mạng
user=1000:1000                             không phải root
cap_drop=ALL, no-new-privileges            không leo thang
read_only=True                             rootfs chỉ đọc
tmpfs /tmp 256m mode=1777                  chỗ ghi duy nhất
pids_limit=64                              chặn fork bomb
mem_limit theo bài, nano_cpus=0.5e9        chặn ngốn tài nguyên
```

Giữ nguyên comment giải thích từng con số — chúng ghi lại kết quả đo thật (256m vì Go cần
~67MB build cache mỗi lần cold-compile, tmpfs sparse nên không tốn gì cho ngôn ngữ khác).

**Judge cần `/var/run/docker.sock`, và đó là quyền tương đương root trên host.** Code học viên
không chạm được socket này — nó nằm trong tiến trình judge, không nằm trong container chạy
bài. Nhưng bất kỳ lỗ hổng thực thi mã nào trong chính judge đều đổi được thành chiếm máy.
Ba hệ quả bắt buộc:

1. **`POST /run` phải xác thực.** Kong ở đây không có plugin JWT — mỗi service tự verify
   (`libs/platform/src/auth/keycloak.strategy.ts` dùng `jwks-rsa` với
   `${KEYCLOAK_ISSUER}/protocol/openid-connect/certs`). Judge làm y hệt bằng `PyJWT` +
   `PyJWKClient`: xác thực chữ ký, `issuer`, `audience`, hạn dùng. Endpoint không auth ở đây
   nghĩa là bất kỳ ai gọi được `:8000` đều chạy được code tuỳ ý trên host.
2. **Giới hạn đầu vào**: `sourceCode` ≤ 256 KB, `testCases` ≤ 100, mỗi `input`/`expected`
   ≤ 64 KB. Không có thì một request là một cách làm cạn host.
3. **Trên EC2, judge chạy máy riêng.** Cùng host với service khác nghĩa là socket đó nằm
   cạnh dữ liệu người dùng.

Ghi cả ba vào `README.md` của service, không chỉ trong spec này.

### 3.7 Đồng thời và giới hạn đo lường

`docker-py` là đồng bộ, FastAPI là async → mỗi lần chấm chạy qua `asyncio.to_thread`, và
`threading.Semaphore` của code-runner giữ nguyên vai trò chặn số container đồng thời.
`max_pool_size=128` giữ nguyên: comment trong engine ghi rõ mỗi submission giữ hai kết nối
(một cho `wait()`, một cho luồng lấy `stats()`), và ở concurrency 20 với mặc định 10 thì
docker-py ném `queue.Full` thô.

`peak_memory_mb` **thường là None** và đó không phải lỗi: `container.stats()` mất 1–2s trong
dockerd mới trả số thật, còn container AC/WA/RE điển hình sống 200–700ms. Engine tham khảo đã
ghi rõ điều này. Nên `memoryKb` trong `JudgeCompletedV1` sẽ là 0 với phần lớn bài — chấp nhận,
không đi săn tiếp.

### 3.8 Ảnh runner

Sáu Dockerfile copy từ `code-runner/docker/`, đổi tag `coderunner-*:1.0` →
`codementor-runner-*:1.0`. Chúng rất mỏng (base image + user uid 1000), trừ `node` phải cài
sẵn `typescript` và `@types/node` vào `/opt/ts-types` — không có nó thì mọi bài TS chạm stdin
đều lỗi type, và submission không có `node_modules` riêng.

`make images` tương đương: build 6 image, gắn tag. Đặt thành script `judge:images`.

### 3.9 Cấu hình chạy

`package.json` của backend thêm:

```json
"judge:install": "cd apps/judge-service && uv sync",
"judge:images":  "cd apps/judge-service && ./scripts/build-images.sh",
"judge:dev":     "cd apps/judge-service && uv run uvicorn app.main:app --reload --port 3007",
"judge:test":    "cd apps/judge-service && uv run pytest",
"judge:lint":    "cd apps/judge-service && uv run ruff check ."
```

`kong/kong.yml` thêm service trỏ `127.0.0.1:3007`, route `/api/v1/judge`, `strip_path: false`.

`docker-compose.yml`: judge-service tách khỏi `x-service-base` (base build image Node dùng
chung), có build context riêng và mount:

```yaml
judge-service:
  build: { context: ./apps/judge-service }
  container_name: codementor-judge
  env_file: .env
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
  ports: ['3007:3007']
```

Biến môi trường dùng lại tên đang có: `DATABASE_URL`, `MONGO_URI`, `MONGO_DB`,
`KAFKA_BROKERS`, `KEYCLOAK_ISSUER`, `KEYCLOAK_AUDIENCE`. Thêm mới: `EXECUTION_ENGINE`
(`docker`), `JUDGE0_URL`, `DOCKER_EXECUTION_CONCURRENCY` (4).

## 4. Kiểm chứng

Repo backend có jest (`jest.config.js`) nhưng judge sẽ dùng pytest — hai runtime, hai runner.

1. `test_judgement.py` — bảng verdict và công thức score, thuần hàm, không cần Docker. Đây là
   chỗ dễ sai nhất (ưu tiên verdict, weight bằng 0, chia cho 0).
2. `test_docker_executor.py` — mỗi ngôn ngữ một bài "cộng hai số": AC, WA, CE, RE, TLE. Cần
   Docker và 6 image, nên đánh dấu `@pytest.mark.docker` để chạy riêng.
3. `curl` vào `POST /api/v1/judge/run` qua Kong với token thật — xác nhận auth chặn khi thiếu
   token và chạy được khi có.
4. Kafka: `kafka-console-producer` bắn một envelope `cmd.judge.run.v1`, xác nhận có
   `evt.judge.completed.v1` và một document trong `submission_run_details`.

## 5. Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Mount docker.sock = root trên host | Auth bắt buộc trên `/run`, giới hạn đầu vào, tách máy khi lên EC2 (§3.6) |
| Validator Mongo `strict` + `additionalProperties: false` | `runtimeMs`/`memoryKb` là `int` trong schema còn engine trả float — phải `round()`. Không gửi khoá `None`: driver serialize thành `null`, mà `null` không phải `bsonType` nào cả. Đây là bẫy đã sập một lần với `exercise_contents`, có ghi trong `mongo.module.ts`. |
| Hai runtime trong một repo | Judge bị loại khỏi `build:all`/eslint/nest-cli, nên CI Node không thấy nó. Script `judge:*` là chỗ duy nhất chạy được — ghi vào README. |
| Ảnh runner chưa build trên máy mới | `docker_executor` ném `ExecutionError` khi thiếu image; `judge:images` phải chạy một lần trước khi dev. |

## 6. Đã cân nhắc rồi bỏ

- **Giữ judge bằng NestJS, gọi sang một sidecar Python.** Thêm một chặng mạng và một tiến
  trình để tránh viết lại 200 dòng — trong khi service TS hiện tại không có logic nào để giữ.
- **Chỉ Kafka, không HTTP.** Đúng docs, nhưng không chấm được bài nào cho tới khi
  submission-service tồn tại.
- **Bật Judge0.** Máy hiện tại kẹt cgroup v1/v2. Code và config giữ lại để bật lại. (D5)

## 7. Sửa so với thiết kế ban đầu

**`judge0_client.py` không port nguyên văn được.** Bản gốc `import app.db.models`, một module
chỉ tồn tại trong repo code-runner, nên `EXECUTION_ENGINE=judge0` sẽ vỡ ngay lúc import —
"cấu hình sẵn để đó" mà bật lên là crash thì không phải để đó được. Đã sửa: dùng `JudgeCase`,
trả `(results, compile_output)` đúng chữ ký của docker_executor, và ánh xạ status id sang từ
vựng CodeMentor. Bỏ `run_single()` (không ai gọi, và nó mang theo trường `is_hidden` của mô
hình cũ). Trạng thái 13/14 của Judge0 giờ ném `Judge0Error` thay vì trả verdict
`"System Error"` — đó là lỗi hạ tầng, không phải kết quả chấm.

Judge0 cũng **không bao giờ trả `memory_exceeded`**: nó gộp tràn bộ nhớ vào nhóm runtime
error 7–12. Chỉ engine docker phân biệt được, nhờ cờ `OOMKilled` của daemon.
- **Đo `peak_memory_mb` cho mọi bài.** `container.stats()` trễ hơn vòng đời container điển
  hình. (§3.7)
