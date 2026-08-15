# codementor-backend

Backend của **CodeMentor** — nền tảng tự học lập trình. Kiến trúc **Service-Based**: 9 service
triển khai độc lập, dùng chung một PostgreSQL nhưng có **logical ownership rõ ràng**, giao tiếp
bất đồng bộ qua **Kafka** và đồng bộ qua **HTTP**.

Thiết kế đầy đủ: [`docs/02-service-architecture.md`](docs/02-service-architecture.md)

---

## Yêu cầu

| | Phiên bản | Ghi chú |
| --- | --- | --- |
| Node.js | ≥ 22 (khuyến nghị 24) | |
| Docker | có | cho Kafka + Keycloak |
| `codementor-infra` | đã chạy | **PostgreSQL và MongoDB do repo đó quản lý** |

> Schema database **không** thuộc repo này. Xem [§Database](#database) trước khi chạy migration.

## Chạy lần đầu

```bash
# 1. Database (ở repo codementor-infra)
cd ../codementor-infra/database && docker compose up -d && make -f Makefile init && make -f Makefile seed

# 2. Kafka + Keycloak
cd ../../codementor-backend
cp .env.example .env          # sinh JWT/secret nếu cần
docker compose up -d kafka kafka-ui keycloak

# 3. Sinh Prisma client từ schema thật (introspect, KHÔNG migrate)
npm install
npm run db:sync

# 4. Chạy service muốn phát triển
npm run start:core            # hoặc start:learning, start:exercise...
```

| Giao diện | URL |
| --- | --- |
| Swagger từng service | `http://localhost:<port>/api/docs` |
| Kafka UI | http://localhost:8081 |
| Keycloak Admin | http://localhost:8080 — `admin` / `admin` |

---

## 9 service

| Service | Port | Sở hữu (PostgreSQL) | MongoDB | Truy cập |
| --- | --- | --- | --- | --- |
| `core-service` | 3001 | `users`, `user_stats`, `learning_preferences`, `study_schedule_slots`, `technologies`, `tags`, `companies` — **7** | — | công khai |
| `learning-service` | 3002 | `roadmaps*`, `courses*`, `chapters`, `lessons`, 4 bảng `*_prerequisites`, `*_enrollments`, `lesson_progress`, `articles` — **19** | `lesson_contents`, `article_contents` | công khai |
| `exercise-service` | 3003 | `exercises`, `exercise_sets`, `exercise_prerequisites`, `exercise_progress`… — **9** | `exercise_contents` | công khai |
| `workspace-service` | 3004 | `study_groups`, `group_members`, quyền nhóm, `assignments` — **7** | — | công khai |
| `document-service` | 3005 | `group_documents` — **1** | — | công khai |
| `submission-service` | 3006 | `submissions` — **1** | `submission_run_details` | công khai |
| `judge-service` | 3007 | **0** — stateless | — | nội bộ |
| `ai-service` | 3008 | **0** — stateless | `ai_conversations`, `ai_analyses` | nội bộ |
| `realtime-service` | 3009 | **0** — chỉ cầu nối Kafka → WS/SSE | — | công khai |

**Tổng 44 bảng, không bảng nào có hai chủ, không bảng nào vô chủ** *(có script kiểm chứng)*.

`judge` và `ai` là **stateless worker**: nhận việc qua Kafka, không map cổng ra ngoài, không ghi
thẳng vào bảng của service khác. Nếu judge tự ghi `submissions.verdict` thì hai service cùng
công bố trạng thái bài nộp — mất điểm kiểm soát duy nhất.

---

## Cấu trúc

```text
apps/                       9 deployment unit
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
ra (fan-out). Tất cả tên topic khai báo tại `libs/contracts/src/events/topics.ts` — **cấm
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
| `npm run start:<tên>` | chạy 1 service ở chế độ watch (`core`, `learning`, `exercise`, `workspace`, `document`, `submission`, `judge`, `ai`, `realtime`) |
| `npm run build:all` | build cả 9 service |
| `npm run services start\|stop\|restart\|status` | chạy/dừng 9 service đã build, theo PID đang giữ cổng |
| `npm run smoke` | gọi HTTP qua gateway kiểm các luồng chính trên hạ tầng thật |
| `npm run lint` | lint + **kiểm tra ranh giới kiến trúc** |
| `npm test` | unit test |
| `npm run test:cov` | coverage (ngưỡng chỉ áp ở `domain/model`) |
| `npm run db:sync` | introspect schema + sinh Prisma client |

Coverage cố ý **chỉ đặt ngưỡng ở `domain/model`** — phần lớn foundation là wiring DI/HTTP, ép
coverage cao ở đó chỉ đẻ ra test vô nghĩa.

---

## Docker

`docker-compose.yml` chứa Kafka (KRaft, **không ZooKeeper**), Kafka UI, Keycloak + DB riêng, và
9 service. Một `Dockerfile` build tất cả app; compose chọn app bằng `command` — build một lần
thay vì chín lần.

```bash
docker compose up -d kafka kafka-ui keycloak   # chỉ hạ tầng
docker compose up -d                           # thêm cả 9 service
```

---

## Tài liệu

| File | Nội dung |
| --- | --- |
| [`docs/02-service-architecture.md`](docs/02-service-architecture.md) | **bản chốt hiện hành** — service, Kafka topic, dependency, DB ownership |
| [`docs/01-identity-keycloak.md`](docs/01-identity-keycloak.md) | Keycloak: ai sở hữu gì, JIT provisioning, bật social login |
| [`docs/00-architecture-review.md`](docs/00-architecture-review.md) | review 3 repo + phân tích boundary bằng đếm FK thật. *Phần kiến trúc triển khai đã bị 02 thay thế* |

---

## Trạng thái

**Đã có và đã kiểm chứng**

- 9/9 service build được; lint sạch; 28 unit test pass
- Prisma introspect **46 bảng** từ schema thật
- `core-service` là mẫu DDD đầy đủ: value object, aggregate, port/adapter, use case, controller
- `libs/messaging`: Kafka client, EventBus, outbox, consumer khử trùng
- `libs/contracts`: 17 topic, envelope, payload typed theo topic

**Chưa có**

- 8 service mới là skeleton (module + bootstrap + health), chưa có domain logic
- **Chưa chạy end-to-end với Kafka thật** — verify hiện dừng ở build/lint/test + migration trên PostgreSQL thật
- `GRANT` theo service chưa viết — nên làm sớm, càng để lâu càng nhiều chỗ lỡ đọc bảng người khác
- Chưa có HTTP client thật cho `libs/contracts/clients` (mới có interface)
- Chưa có e2e test
