# codementor-backend

Backend của **CodeMentor** — nền tảng tự học lập trình. Kiến trúc **Service-Based**: 10 service
triển khai độc lập (8 NestJS + 2 Python), dùng chung một PostgreSQL nhưng có **logical ownership
rõ ràng**, giao tiếp bất đồng bộ qua **Kafka** và đồng bộ qua **HTTP**.

Thiết kế đầy đủ: [`docs/02-service-architecture.md`](docs/02-service-architecture.md)

---

## Yêu cầu

| | Phiên bản | Ghi chú |
| --- | --- | --- |
| Node.js | ≥ 22 (khuyến nghị 24) | |
| Docker | có | cho Kafka + Kong (chạy local) |
| Hạ tầng dùng chung | đã chạy trên EC2 | PostgreSQL, MongoDB, Keycloak — xem `../codementor-connect.txt` |

> Schema database **không** thuộc repo này. Xem [§Database](#database) trước khi chạy migration.

### Cái gì chạy ở đâu

| Chạy trên EC2 `13.214.122.227` | Chạy local bằng `docker compose` ở repo này |
| --- | --- |
| PostgreSQL `:5432`, MongoDB `:27017`, Keycloak sau Nginx tại `https://id.codementor.cloud` | Kafka `:9092`, Kong `:8000`, Kafka UI `:8081` |

Keycloak **không** còn nghe `:8080` công khai — nó bind `127.0.0.1:8080` trên EC2, Nginx +
Let's Encrypt là lối vào duy nhất. `KEYCLOAK_ISSUER` phải là
`https://id.codementor.cloud/realms/codementor`; dùng `http://13.214.122.227:8080/...` thì đăng
nhập xong mọi lời gọi API đều 401 vì issuer trong token không khớp.

EC2 là máy 1.9 GB RAM nên chỉ giữ ba thứ có state. Kafka và Kong là hạ tầng không state —
để local thì nhẹ máy, và không phải phơi broker PLAINTEXT hay gateway ra internet.

`docker-compose.yml` vẫn còn `keycloak` + `keycloak-db` làm **phương án dự phòng** khi cần
một stack hoàn toàn offline; ngày thường không bật, vì realm thật nằm trên EC2.

### Chuẩn bị EC2 chạy application

Cách chia hai máy ít vận hành nhất:

- EC2 dữ liệu: PostgreSQL, MongoDB, Keycloak.
- EC2 application: Kafka, Kong và toàn bộ service backend.

Không chia các service application ngẫu nhiên giữa hai máy: Compose DNS chỉ hoạt động trong
một host, còn Kafka và các HTTP call nội bộ đang dùng tên service. Hai máy 1 GB cũng không đủ
cho stack đầy đủ; riêng application stack cần khoảng 4,5 GB khi có judge sandbox, nên dùng máy
8 GB hoặc chỉ bật một tập service phục vụ demo đã đo RAM.

Từ máy dev, chuẩn bị EC2 application và chép `.env` hiện tại qua SSH:

```bash
SSH_KEY=../codementor-app.pem ./scripts/bootstrap-ec2.sh ec2-user@<APP_IP>
SSH_KEY=../codementor-app.pem ./scripts/push-env-ec2.sh ec2-user@<APP_IP>
```

`push-env-ec2.sh` truyền secret qua stdin, ghi atomically với quyền `0600`, rồi chạy
`docker compose config --quiet`. Không cần `export` từng biến: `env_file: .env` đã đưa chúng
vào container. Có thể dùng SSH host alias thay cho `SSH_KEY`.

Hai script **không tự chạy stack production**. `docker-compose.yml` hiện phục vụ local: DB URL
và Keycloak còn override theo local, Kong trỏ `host.docker.internal`, và compose còn thiếu
`notification-service`. Cần `docker-compose.prod.yml` + `kong.prod.yml` riêng trước khi mở
`80/443`; không dùng file local để deploy rồi phơi các cổng `3001–3013`, `8081`, `9092`.

## Chạy lần đầu

```bash
# 1. Hạ tầng local: Kafka + Kong. PostgreSQL/MongoDB/Keycloak đã chạy sẵn trên EC2.
cp .env.example .env          # rồi điền endpoint EC2 từ ../codementor-connect.txt
docker compose up -d kafka kafka-ui kong

# 2. Sinh Prisma client từ schema thật (introspect, KHÔNG migrate)
npm install
npm run db:sync

# 3. Chạy service
npm run build:all             # 8 service NestJS. ai/judge là Python, xem README riêng của chúng
npm run services start        # cả 8, hoặc: npm run start:core để chạy 1 service ở chế độ watch

# 4. Kiểm tra
npm run smoke                 # gọi HTTP qua gateway, kiểm các luồng chính
```

| Giao diện | URL |
| --- | --- |
| Gateway (frontend chỉ gọi origin này) | http://localhost:8000/api/v1 |
| Swagger từng service | `http://localhost:<port>/api/docs` |
| Kafka UI | http://localhost:8081 |
| Keycloak Admin | https://id.codementor.cloud/admin/ |

---

## 10 service

| Service | Port | Sở hữu (PostgreSQL) | MongoDB | Truy cập |
| --- | --- | --- | --- | --- |
| `core-service` | 3001 | `users`, `user_stats`, `learning_preferences`, `study_schedule_slots`, `technologies`, `tags`, `tag_categories`, `companies`, `announcements`, `audit_logs` | — | công khai |
| `learning-service` | 3002 | `roadmaps*`, `courses*`, `chapters`, `lessons`, 4 bảng `*_prerequisites`, `*_enrollments`, `lesson_progress`, `articles` | `lesson_contents`, `article_contents` | công khai |
| `exercise-service` | 3003 | `exercises`, `exercise_sets`, `exercise_prerequisites`, `exercise_progress`… | `exercise_contents` | công khai |
| `workspace-service` | 3004 | `study_groups`, `group_members`, quyền nhóm, `assignments`, `group_documents` | — | công khai |
| `submission-service` | 3006 | `submissions` | — | công khai |
| `judge-service` (Python/FastAPI) | 3007 | **0** | `submission_run_details` | nội bộ + `/api/v1/judge/run` |
| `ai-service` (Python/FastAPI) | 3008 | **0** | `ai_conversations`, `ai_documents`, `ai_rag`, `ai_agent_sessions` | nội bộ + `/api/v1/ai/*` |
| `realtime-service` | 3009 | **0** — chỉ cầu nối Kafka → WS/SSE | — | công khai |
| `notification-service` | 3012 | `notifications*` | `notifications`, `notification_reads` | công khai |
| `recommendation-service` | 3013 | **0** — chỉ đọc | — | công khai |

Prisma introspect **53 model** từ schema thật; `codementor-infra` đang giữ **29 migration**.

Cổng 3005 bỏ trống: `document-service` đã **xoá** ngày 2026-09-16. Nó chỉ là skeleton
(health + wiring), không route Kong, không ai gọi, trong khi `group_documents` từ đầu đã do
`workspace-service` đọc ghi. Bốn topic `*.document.*` trong `libs/contracts` vẫn được khai báo
nhưng hiện không service nào phát hay nghe.

**Không bảng nào có hai chủ, không bảng nào vô chủ.**

`judge` và `ai` là **stateless worker**: không sở hữu bảng quan hệ, không ghi thẳng vào bảng của
service khác. Nếu judge tự ghi `submissions.verdict` thì hai service cùng công bố trạng thái bài
nộp — mất điểm kiểm soát duy nhất.

Health endpoint **không** đồng dạng: 8 service NestJS dùng `/api/v1/health`, judge-service dùng
`/api/v1/judge/health`. Viết healthcheck cho compose/Ansible thì nhớ khác biệt này.

---

## Cấu trúc

```text
apps/                       10 deployment unit (8 NestJS + ai-service, judge-service bằng Python)
  <service>/src/
    main.ts                 gọi bootstrapService() dùng chung
    app.module.ts
    contexts/<ctx>/         1 service CÓ THỂ chứa nhiều bounded context
      domain/               ⛔ không import NestJS / Prisma / Kafka
      application/          use case, không phụ thuộc HTTP
      infrastructure/       repository, adapter
      presentation/http/    REST cho frontend
      presentation/messaging/  Kafka consumer

libs/
  kernel/                   Entity, AggregateRoot, ValueObject, Result, DomainError
  platform/                 config, logging, prisma, mongo, http filter, auth, bootstrap
  messaging/                Kafka client, EventBus, outbox, consumer khử trùng
  contracts/                ⭐ THỨ DUY NHẤT được chia sẻ giữa các service
```

> **Bounded context ≠ service.** Service là đơn vị *triển khai*; context là ranh giới *mô hình*.
> Một service chứa 1–n context. Đây là điểm phân biệt Service-Based với Microservices.

---

## Ranh giới được cưỡng chế, không chỉ ghi trong tài liệu

`npm run lint` **chặn** bốn loại vi phạm sau — đã kiểm chứng bằng cách cố tình viết code sai:

| Vi phạm | Thông báo |
| --- | --- |
| Service import code service khác | *Dùng HTTP client hoặc Kafka event trong `libs/contracts`* |
| `libs/kernel` import hạ tầng | *kernel phải thuần TypeScript* |
| `domain/` import `kafkajs` | *phát event qua port `EventBus`* |
| `domain/` import NestJS / Prisma / Mongoose / platform | *domain không phụ thuộc framework* |

Tầng thứ hai là **quyền của PostgreSQL**: mỗi service một DB user, chỉ `GRANT` trên bảng mình
sở hữu. ESLint chặn người vô ý; quyền CSDL chặn cả khi cố tình, cả script chạy tay.

---

## Kafka

Quy ước tên: `cmd.*` = yêu cầu làm việc (đúng **một** consumer group) · `evt.*` = sự việc đã xảy
ra (fan-out). **26 topic**, tất cả khai báo tại `libs/contracts/src/events/topics.ts` — **cấm
hard-code chuỗi**, gõ sai một ký tự sẽ tạo topic mới một cách im lặng.

Luồng chấm bài — chú ý **judge không phát `submission.evaluated`**:

```text
submission ──cmd.judge.run──▶ judge ──evt.judge.started──▶ realtime
                                │
                                └──evt.judge.completed──▶ submission
                                                            │ ghi verdict (bảng mình sở hữu)
                                                            └─evt.submission.evaluated─┬─▶ exercise
                                                                                        ├─▶ core (XP, streak)
                                                                                        └─▶ realtime
```

Ba thứ bắt buộc khi làm việc với Kafka ở đây:

| | Vì sao |
| --- | --- |
| **`eventId` + bảng `processed_events`** | Kafka là *at-least-once*. Không khử trùng thì "cộng 50 XP" chạy hai lần là chuyện sớm muộn |
| **`PARTITION_KEY` đúng cho từng topic** | Kafka chỉ đảm bảo thứ tự *trong* một partition. Sai key thì chạy đúng lúc dev (1 partition), sai khi scale |
| **Outbox cho luồng quan trọng** | `INSERT submissions` rồi `kafka.send()` là hai hệ thống. Chết ở giữa → bài nộp treo mãi ở `pending` |

Outbox chỉ bật ở service cần (`enableOutbox: true`) và dùng qua `OUTBOX_EVENT_BUS`. Vì cùng
interface `EventBus`, chuyển một luồng sang outbox không sửa use case.

### Kafka là phụ thuộc cứng lúc khởi động — đã đo

`KafkaClient.onModuleInit()` gọi `producer.connect()` không bọc try/catch. kafkajs thử lại 8 lần
rồi ném `KafkaJSNumberOfRetriesExceeded`; lỗi thoát ra khỏi `onModuleInit` và **giết tiến trình**.

Đo ngày 2026-09-16, `KAFKA_BROKERS` trỏ vào host không tồn tại:

| Service | Kafka chết | Kết quả |
| --- | --- | --- |
| 7 service gọi `MessagingModule.forRoot` (core, learning, exercise, workspace, submission, realtime, notification) | có | **exit 1 sau ~75 s** |
| `recommendation-service` (không import `MessagingModule`) | có | chạy bình thường |
| `ai-service` | có | chạy bình thường — không dùng Kafka |
| `judge-service` | có | **chạy bình thường**, health 200 — `lifespan` đã bọc try/except, đường HTTP vẫn chấm được |

judge-service (Python) làm đúng, 7 service NestJS thì không. Hệ quả khi triển khai: Kafka phải
`service_healthy` **trước** mọi service NestJS, và một lần Kafka restart là 7 container cùng chết
rồi phụ thuộc `restart: unless-stopped` để bò dậy.

Muốn đổi sang degrade thay vì chết, sửa một chỗ duy nhất trong `libs/messaging/src/kafka.client.ts`:

```ts
async onModuleInit(): Promise<void> {
  try {
    await this.producer.connect();
    this.logger.log(`Kafka producer đã kết nối (${this.options.serviceName})`);
  } catch (err) {
    // Kafka chưa lên không được phép làm chết cả service: đường HTTP đọc vẫn phục vụ được.
    // `producer.send()` sau đó sẽ tự kết nối lại, nên không cần vòng retry riêng.
    this.logger.error(`không kết nối được Kafka — chỉ còn đường HTTP: ${err}`);
  }
}
```

Đánh đổi phải biết trước khi chọn: publish lúc Kafka còn chết sẽ **ném lỗi ở tầng use case** thay
vì service từ chối khởi động. Luồng nào bắt buộc không mất message thì phải bật outbox
(`enableOutbox: true`), vì outbox ghi vào PostgreSQL trước rồi mới đẩy đi.

---

## Xác thực

**Keycloak là nhà cung cấp danh tính**; backend là *resource server* — chỉ xác minh chữ ký
RS256 qua JWKS. Chi tiết: [`docs/01-identity-keycloak.md`](docs/01-identity-keycloak.md)

Backend **không có** `/login`, `/register`, `/refresh`, không giữ mật khẩu. Thấy ai thêm vào là
dấu hiệu ranh giới bị phá. Đăng nhập bằng Google/GitHub/Facebook cấu hình ở Keycloak, backend
không phải sửa gì.

Hồ sơ nội bộ được tạo **just-in-time** lần đầu một tài khoản Keycloak gọi API, liên kết qua
`users.external_id`.

---

## Database

> **`codementor-infra` sở hữu schema. Repo này chỉ đọc.**

Schema có **28 trigger, 5 hàm PL/pgSQL, 79 CHECK** đang giữ các bất biến (chống chu trình phụ
thuộc, cache tiến độ). **`prisma migrate` sẽ xoá sạch chúng** ngay lần chạy đầu.

| Việc | Cách làm |
| --- | --- |
| Đổi schema | Viết SQL migration trong `codementor-infra/database/postgres/migrations/` |
| Đồng bộ backend | `npm run db:sync` (= `db pull` + `generate`) |
| **Cấm** | `prisma migrate dev` / `migrate deploy` |

Ràng buộc vẫn ở CSDL; backend **không nhân bản** mà chỉ dịch SQLSTATE thành lỗi domain —
ví dụ `23514` + thông điệp cycle → `CircularDependencyError` → HTTP 422.

---

## Lệnh

| Lệnh | Việc |
| --- | --- |
| `npm run start:<tên>` | chạy 1 service NestJS ở chế độ watch (`core`, `learning`, `exercise`, `workspace`, `submission`, `realtime`, `notification`, `recommendation`) |
| `npm run ai:start` / `npm run judge:dev` | 2 service Python (uv) |
| `npm run judge:images` | build 6 image sandbox `codementor-runner-{python,cpp,java,node,go,php}:1.0` — bắt buộc trước khi chấm bài |
| `npm run build:all` | build 8 service NestJS |
| `npm run services start\|stop\|restart\|status` | chạy/dừng các service đã build, theo PID đang giữ cổng |
| `npm run smoke` | gọi HTTP qua gateway kiểm các luồng chính trên hạ tầng thật |
| `npm run lint` | lint + **kiểm tra ranh giới kiến trúc** |
| `npm test` | unit test |
| `npm run test:cov` | coverage (ngưỡng chỉ áp ở `domain/model`) |
| `npm run db:sync` | introspect schema + sinh Prisma client |

Coverage cố ý **chỉ đặt ngưỡng ở `domain/model`** — phần lớn foundation là wiring DI/HTTP, ép
coverage cao ở đó chỉ đẻ ra test vô nghĩa.

---

## Docker

`docker-compose.yml` chứa Kafka (KRaft, **không ZooKeeper**), Kafka UI, Kong, Keycloak dự phòng +
DB riêng, và các service. Một `Dockerfile` build tất cả app NestJS; compose chọn app bằng
`command` — build một lần thay vì tám lần. `ai-service` và `judge-service` có Dockerfile riêng.

```bash
docker compose up -d kafka kafka-ui kong       # hạ tầng local
docker compose up -d                           # thêm các service
```

### Ba cái bẫy của đường Docker — đã kiểm chứng 2026-09-16

Đường này chưa từng được chạy thật trước đó; mọi thứ vẫn lên bằng `npm run services`.

1. **Entrypoint lồng hai lần.** `nest build` biên dịch cả `apps/` lẫn `libs/`, nên rootDir chung
   là repo root và cây nguồn được giữ nguyên trong outDir. Đường thật là
   `dist/apps/<svc>/apps/<svc>/src/main.js`, **không** phải `dist/apps/<svc>/main.js`.
   `scripts/services.mjs` đã dùng đúng từ đầu; `Dockerfile` và `docker-compose.yml` thì sai —
   đã sửa. Chạy sai đường thì container chết ngay với
   `Error: Cannot find module '/app/dist/apps/core-service/main.js'`.

2. **`NODE_ENV` phải là `production` trong image.** `npm prune --omit=dev` xoá `pino-pretty`,
   nhưng `LoggingModule` vẫn yêu cầu transport ấy khi `NODE_ENV !== 'production'`. Truyền
   `--env-file .env` (file này có `NODE_ENV=development`) sẽ ghi đè `ENV` của Dockerfile và
   service chết với `unable to determine transport target for "pino-pretty"`. Trong compose,
   `environment:` thắng `env_file:` nên đã an toàn; chạy `docker run --env-file` thì phải
   truyền `-e NODE_ENV=production` kèm.

3. **`notification-service` chưa có trong `docker-compose.yml`** dù đã chạy thật ở cổng 3012.
   Phải thêm trước khi triển khai.

Kiểm chứng thực tế: với đường dẫn đúng + `NODE_ENV=production` + Kafka lên trước,
**9/9 service NestJS (khi đó còn `document-service`) chạy và trả `/api/v1/health` = 200**; `ai-service` 200; `judge-service` 200
tại `/api/v1/judge/health`.

`judge-service` **chết lúc import** nếu thiếu `/var/run/docker.sock`
(`docker.errors.DockerException`) — socket là bắt buộc, không phải tuỳ chọn.

---

## Tài liệu

| File | Nội dung |
| --- | --- |
| [`docs/02-service-architecture.md`](docs/02-service-architecture.md) | **bản chốt hiện hành** — service, Kafka topic, dependency, DB ownership |
| [`docs/01-identity-keycloak.md`](docs/01-identity-keycloak.md) | Keycloak: ai sở hữu gì, JIT provisioning, bật social login |
| [`docs/00-architecture-review.md`](docs/00-architecture-review.md) | review 3 repo + phân tích boundary bằng đếm FK thật. *Phần kiến trúc triển khai đã bị 02 thay thế* |

---

## Trạng thái

Cập nhật 2026-09-16. Mọi dòng dưới đây đều đã chạy thật, không phải suy đoán.

**Đã kiểm chứng**

- `npm run lint` — 0 error, 3 warning (ranh giới kiến trúc sạch)
- `npx jest` — **27 suite, 345 test, pass hết**
- Build Docker: 3 image đều `EXIT=0` — `node` 792 MB, `ai` 1,03 GB, `judge` 972 MB
- Chạy Docker: 9/9 NestJS health 200 (đo trước khi xoá `document-service`), `ai-service` 200, `judge-service` 200
- Prisma introspect **53 model**; `libs/contracts` khai báo **26 topic**
- `core-service` là mẫu DDD đầy đủ: value object, aggregate, port/adapter, use case, controller
- `libs/messaging`: Kafka client, EventBus, outbox, consumer khử trùng
- `judge-service`: 6 image sandbox, chạy bằng Docker-out-of-Docker, sống sót khi Kafka chết
- `ai-service`: agent Lecter trên LangGraph + AG-UI, RAG tài liệu trong MongoDB

**Chưa xong**

- **7 service NestJS chết khi Kafka không lên** — xem §Kafka. Cần quyết định fail-fast hay degrade
- `notification-service` thiếu trong `docker-compose.yml`
- `kong/kong.yml` thiếu route cho `realtime-service` (3009); mọi
  upstream còn trỏ `host.docker.internal` nên chỉ dùng được ở máy dev, chưa dùng được trên EC2
- `GRANT` theo service chưa viết — càng để lâu càng nhiều chỗ lỡ đọc bảng người khác
- Chưa có HTTP client thật cho `libs/contracts/clients` (mới có interface)
- Chưa có e2e test; chưa chạy luồng nộp-bài end-to-end trên hạ tầng triển khai thật
- Chưa có CI — không có `.github/workflows/` trong repo này
