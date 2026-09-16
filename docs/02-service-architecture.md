# Kiến trúc Service-Based — thiết kế lại

Thay thế foundation modular-monolith trước đó. Mục tiêu: nhiều deployment unit, shared
PostgreSQL có logical ownership, Kafka cho async, HTTP/gRPC cho sync, WebSocket/SSE cho realtime.

> **Trạng thái tài liệu — 2026-09-16.** Bản thiết kế này viết khi hệ thống còn 9 service. Code
> hiện có **10 app**: 8 NestJS + `ai-service` + `judge-service` (Python). Hai service ra đời sau
> bản thiết kế — `notification-service` (3012) và `recommendation-service` (3013) — đã bổ sung
> vào §2. **`document-service` đã bị xoá (2026-09-16)** — thiết kế gộp `Document → Workspace`
> nêu ở §0 thực ra đã xảy ra trong code từ trước. Kafka là phụ thuộc cứng lúc khởi động. Số bảng trong tài liệu là **44**; Prisma introspect thực
> tế **53 model** trên **29 migration** — chênh lệch là các bảng thêm sau (notification, audit
> log, kiểm duyệt nội dung, nhắc lịch học, tag category). Chưa đếm lại từng dòng, nên đọc cột
> "Sở hữu" như ranh giới, đừng đọc như con số chốt.

---

## 0. Điều chỉnh so với danh sách của bạn

| # | Vấn đề | Xử lý |
| --- | --- | --- |
| 1 | **Thiếu Learning Service** | Danh sách 8 service không có chỗ cho `roadmaps → courses → chapters → lessons`, dependency graph, enrollment, progress — **19/44 bảng**. Đã bổ sung thành service thứ 9 |
| 2 | `Workspace` vs `Group` | Giữ tên **Workspace** — khớp route `/workspace` của frontend. Cùng một thứ |
| 3 | `exercise.generation.requested` là **command**, không phải event | Tách namespace `cmd.*` và `evt.*`. Xem §3.1 |
| 4 | Kafka từng bị loại ở yêu cầu trước | Bạn đã đổi ý — tôn trọng. Dùng **KRaft single-broker** (không ZooKeeper) để nhẹ. Xem §6.2 |
| 5 | `Exercise ↔ Workspace` FK hai chiều **vẫn chưa sửa** | Trước chỉ là mùi code. Giờ là **hai service khác nhau ghi chéo bảng của nhau** — phải sửa trước khi tách. Xem §5.4 |

**Nếu thời gian KLTN eo hẹp**, gộp được mà không phá thiết kế: `Document → Workspace`,
`Judge → Submission`. Còn **7 service**. Các service khác không nên gộp.

---

## 1. Cấu trúc project (NestJS + Python)

AI Service hiện chạy Python/FastAPI, không còn nằm trong `nest-cli.json`.
Workspace Service (NestJS) kiểm tra identity/membership/quyền đọc, sau đó gọi AI nội bộ
qua HTTP có `INTERNAL_SERVICE_TOKEN`. Python sở hữu trích xuất tài liệu, embedding,
retrieval và lịch sử hỏi đáp trong MongoDB; không đọc bảng PostgreSQL của Workspace.
Chi tiết chạy local và giới hạn: `apps/ai-service/README.md`.

```text
codementor-backend/
├── apps/                                   # mỗi thư mục = 1 deployment unit
│   ├── core-service/                       #  :3001
│   ├── learning-service/                   #  :3002
│   ├── exercise-service/                   #  :3003
│   ├── workspace-service/                  #  :3004
│   ├── submission-service/                 #  :3006
│   ├── judge-service/                      #  :3007  (không expose public)
│   ├── ai-service/                         #  :3008  (không expose public)
│   └── realtime-service/                   #  :3009  (WS/SSE)
│
├── libs/                                   # dùng chung, KHÔNG chứa business logic
│   ├── kernel/                             # Entity, AggregateRoot, ValueObject, Result, DomainError
│   ├── platform/                           # config, logging, prisma, mongo, http filter, auth Keycloak
│   ├── messaging/                          # Kafka producer/consumer, outbox, topic registry
│   └── contracts/                          # ⭐ hợp đồng giữa service — xem bên dưới
│
├── prisma/schema.prisma                    # 1 schema, introspect từ codementor-infra
├── docker-compose.yml
└── nest-cli.json                           # khai báo 9 app
```

Bên trong **mỗi** app giữ nguyên cấu trúc DDD đã dựng:

```text
apps/learning-service/src/
├── main.ts                     # bootstrap riêng, port riêng, Swagger riêng
├── app.module.ts
├── contexts/                   # 1 service CÓ THỂ chứa nhiều bounded context
│   └── learning/
│       ├── domain/             # ⛔ không import NestJS/Prisma/Kafka
│       ├── application/
│       ├── infrastructure/
│       └── presentation/
│           ├── http/           # REST cho frontend
│           └── messaging/      # Kafka consumer
└── contexts/articles/          # context thứ hai trong cùng service
```

> **Bounded context ≠ service.** Service là đơn vị *triển khai*, context là ranh giới *mô hình*.
> Một service chứa 1–n context. Đây là điểm phân biệt Service-Based với Microservices.

### 1.1 `libs/contracts` — hợp đồng giữa service

Chỗ duy nhất được chia sẻ kiểu dữ liệu giữa các service. **Không** chia sẻ entity hay repository.

```text
libs/contracts/src/
├── events/
│   ├── envelope.ts              # cấu trúc chung mọi message
│   ├── document.events.ts       # DocumentUploadedV1, DocumentAnalyzedV1...
│   ├── exercise.events.ts
│   ├── submission.events.ts
│   ├── judge.events.ts
│   └── learning.events.ts
├── topics.ts                    # hằng số tên topic — cấm hard-code chuỗi
└── clients/                     # hợp đồng HTTP giữa service (không phải implementation)
    └── workspace-ai.ts          # workspace-service ↔ ai-service
```

> Bản thiết kế ban đầu còn `core-client.port.ts` và `exercise-client.port.ts`. Không service nào
> dùng tới nên cả hai đã bị bỏ (2026-09-16); phân giải người dùng đi qua `RemoteIdentityModule`
> trong `libs/platform`.

---

## 2. Chia service & sở hữu dữ liệu

| Service | Bounded context | Sở hữu bảng PostgreSQL | Mongo | Public? |
| --- | --- | --- | --- | --- |
| **core-service** | Identity, Catalog | `users`, `user_stats`, `learning_preferences`, `study_schedule_slots`, `technologies`, `tags`, `companies` — **7** | — | ✅ |
| **learning-service** | Learning, Articles | `roadmaps*`(4), `courses*`(4), `roadmap_courses`, `chapters`, `lessons`, 4 bảng `*_prerequisites`, `roadmap_enrollments`, `course_enrollments`, `lesson_progress`, `articles` — **19** | `lesson_contents`, `article_contents` | ✅ |
| **exercise-service** | Exercise | `exercises`, `exercise_tags/technologies/companies`, `exercise_sets`, `exercise_set_items`, `exercise_set_enrollments`, `exercise_prerequisites`, `exercise_progress` — **9** | `exercise_contents` | ✅ |
| **workspace-service** | Group, Document | `study_groups`, `group_members`, `group_role_permissions`, `group_member_permissions`, `group_exercises`, `assignments`, `group_activities`, `group_documents` — **8** | — | ✅ |
| **submission-service** | Submission | `submissions` — **1** | — | ✅ |
| **judge-service** | — | **0** bảng quan hệ | `submission_run_details` | ❌ nội bộ¹ |
| **ai-service** | — | **0** | `ai_conversations`, `ai_documents`, `ai_rag`, `ai_agent_sessions` | ❌ nội bộ² |
| **realtime-service** | — | **0** | — | ✅ WS/SSE |
| **notification-service** `:3012` | Notification | bảng `notifications*` | `notifications`, `notification_reads` | ✅ |
| **recommendation-service** `:3013` | Recommendation | **0** — chỉ đọc bảng của service khác | — | ✅ |

¹ judge-service là **Python/FastAPI**, không phải NestJS — xem `apps/judge-service/README.md`.
Nó ghi `submission_run_details` (stdout/stderr từng test case) và trả `_id` qua
`evt.judge.completed.v1.runDetailRef`: đẩy nguyên chi tiết qua Kafka thì payload phình theo
số test case. Verdict trong postgres vẫn **chỉ** submission-service ghi. Judge cũng expose
`POST /api/v1/judge/run` để chạy thử đồng bộ, có kiểm JWT — dùng cho nút "Chạy thử" ở studio.

**Thiết kế: 44 bảng, không bảng nào có hai chủ, không bảng nào vô chủ.**

> **`document-service` đã xoá.** Nó chưa bao giờ vượt khỏi skeleton (health + wiring), còn
> `group_documents` từ đầu đã do `workspace-service` đọc ghi. Thiết kế giờ khớp code: bảng thuộc
> `workspace-service`. Các topic `evt.document.*` / `cmd.document.analyze.v1` ở §3 vẫn còn trong
> `libs/contracts` nhưng chưa service nào phát hay nghe.
>
> ⚠️ **`recommendation-service` không import `MessagingModule`** — cố ý: nó chỉ đọc PostgreSQL,
> không phát và không nghe event nào. Đây cũng là service NestJS duy nhất sống được khi Kafka chết.

² `ai-service` còn expose `/api/v1/ai/*` công khai có kiểm JWT Keycloak cho agent Lecter, không
thuần nội bộ như bản thiết kế ban đầu.

### 2.1 Vì sao Judge và AI không sở hữu bảng nào

Cả hai là **stateless worker**: nhận job từ Kafka, xử lý, phát kết quả. Chúng **không** ghi
thẳng vào `submissions` hay `exercises` — service sở hữu bảng mới là nơi quyết định lưu gì.

Nếu Judge ghi thẳng `submissions.verdict`, ta có hai service ghi chung một bảng và mất
điểm kiểm soát duy nhất về trạng thái bài nộp.

---

## 3. Kafka — topics & events

### 3.1 Quy ước đặt tên

```text
codementor.<namespace>.<tên>.v<n>

namespace:  evt  = sự việc ĐÃ xảy ra, quá khứ, nhiều consumer     (fan-out)
            cmd  = yêu cầu LÀM một việc, mệnh lệnh, đúng 1 consumer (point-to-point)
```

Tách `cmd`/`evt` vì hai loại này có ngữ nghĩa khác nhau: command có thể bị từ chối và chỉ
nên có một người xử lý; event là sự thật đã rồi, ai quan tâm thì nghe. Danh sách bạn đưa
gộp chung (`exercise.generation.requested` là command, `exercise.generated` là event).

### 3.2 Catalog đầy đủ

| Topic | Producer | Consumer | Ghi chú |
| --- | --- | --- | --- |
| `evt.user.provisioned.v1` | core | learning | tạo `learning_preferences` mặc định |
| `evt.document.uploaded.v1` | document | ai, realtime | kích hoạt tiền kiểm |
| `cmd.document.analyze.v1` | document | **ai** | command — 1 consumer group |
| `evt.document.analyzed.v1` | ai | document, realtime | trả `ai_verdict` |
| `evt.document.moderated.v1` | document | workspace, realtime | người duyệt đã quyết định |
| `cmd.exercise.generate.v1` | workspace, exercise | **ai** | sinh nháp bài tập |
| `evt.exercise.generated.v1` | ai | exercise, realtime | `exercises.source='ai'` |
| `evt.exercise.published.v1` | exercise | learning, workspace | bài tập vào catalog |
| `evt.submission.created.v1` | submission | realtime | đã nhận bài, chưa chấm |
| `cmd.judge.run.v1` | submission | **judge** | kèm source + test case |
| `evt.judge.started.v1` | judge | realtime | cập nhật UI "đang chấm" |
| `evt.judge.completed.v1` | judge | submission | **chỉ submission** ghi verdict |
| `evt.submission.evaluated.v1` | submission | exercise, core, workspace, realtime | fan-out sau khi đã lưu |
| `evt.lesson.completed.v1` | learning | core, realtime | cộng XP, streak |
| `evt.course.completed.v1` | learning | core, workspace, realtime | |
| `evt.assignment.created.v1` | workspace | realtime | báo thành viên |
| `evt.assignment.reviewed.v1` | workspace | realtime, core | |

**Luồng chấm bài — chú ý hướng mũi tên:**

```text
submission ──cmd.judge.run──▶ judge ──evt.judge.started──▶ realtime
                               │
                               └──evt.judge.completed──▶ submission
                                                            │ ghi verdict vào bảng mình sở hữu
                                                            └──evt.submission.evaluated──┬─▶ exercise (exercise_progress)
                                                                                          ├─▶ core (user_stats: XP, streak)
                                                                                          └─▶ realtime (đẩy kết quả về UI)
```

Judge **không** phát `submission.evaluated` — nó không biết gì về nghiệp vụ tiến độ.
Submission là chủ sở hữu trạng thái nên nó mới là nơi công bố "đã đánh giá xong".

### 3.3 Envelope chuẩn

Mọi message cùng một vỏ để trace và versioning không phải làm lại từng topic:

```jsonc
{
  "eventId": "uuid",            // idempotency key cho consumer
  "eventName": "evt.judge.completed.v1",
  "occurredAt": "2026-08-11T10:00:00Z",
  "correlationId": "uuid",      // xuyên suốt 1 luồng nghiệp vụ (submission → judge → progress)
  "causationId": "uuid",        // message nào gây ra message này
  "actor": { "userId": "uuid" }, // ai kích hoạt, phục vụ audit
  "payload": { }
}
```

- **`eventId`**: consumer lưu lại đã xử lý → xử lý trùng không gây hậu quả. Kafka đảm bảo
  *at-least-once*, nên trùng là chuyện bình thường phải chuẩn bị.
- **`correlationId`**: bấm "Nộp bài" sinh ra 5 message qua 4 service — không có nó thì
  debug bằng cách đọc log 4 chỗ.

### 3.4 Partition key

| Topic | Key | Vì sao |
| --- | --- | --- |
| `cmd.judge.run`, `evt.judge.*` | `submissionId` | mọi bước của một bài nộp giữ đúng thứ tự |
| `evt.submission.evaluated` | `userId` | XP/streak của một người không bị cộng sai thứ tự |
| `evt.document.*` | `documentId` | |
| `evt.lesson.completed` | `userId` | tiến độ của một người xử lý tuần tự |

Sai partition key là lỗi khó thấy: hệ thống chạy đúng lúc tải thấp, sai khi có nhiều partition.

---

## 4. Dependency giữa các service

### 4.1 Sync (HTTP) — chỉ khi cần trả lời ngay

```text
frontend ──▶ core          (hồ sơ, danh mục)
frontend ──▶ learning ──▶ core       (tên người dùng)
                  └────▶ exercise    (bài tập gắn với lesson)
frontend ──▶ exercise ──▶ core
frontend ──▶ workspace ──▶ core
                   └────▶ exercise   (thông tin bài được giao)
frontend ──▶ document ──▶ workspace  (kiểm tra quyền upload)
frontend ──▶ submission ──▶ exercise (giới hạn, test case)
                     └───▶ core
frontend ──▶ realtime  (WS/SSE, chỉ xác thực qua core)
```

**Không có chu trình.** Thứ tự phụ thuộc: `core` ← `exercise` ← `learning`/`workspace`/`submission` ← `document`.
`judge` và `ai` **không gọi sync ai cả** — nhận đủ dữ liệu trong payload.

Quy tắc: **service chỉ được gọi service đứng trước nó trong thứ tự trên.** Muốn gọi ngược
thì dùng Kafka. Đây là cách chặn chu trình phụ thuộc mà không cần tranh luận từng ca.

### 4.2 Async (Kafka) — mọi thứ còn lại

Dùng Kafka khi: (a) nhiều consumer quan tâm, (b) xử lý lâu, (c) không cần trả lời ngay,
(d) muốn hai bên độc lập triển khai.

Ví dụ điển hình: cộng XP sau khi chấm bài **không** được là HTTP call từ submission sang
core — core sập thì không chấm được bài nữa. Qua Kafka thì core sập chỉ làm XP cộng chậm.

### 4.3 gRPC — chưa cần

HTTP/JSON đủ cho lưu lượng KLTN. gRPC đáng cân nhắc nếu sau này `submission → exercise`
(lấy test case, gọi mỗi lần nộp) trở thành điểm nghẽn. Thiết kế hiện tại không cản việc đổi.

---

## 5. Shared database ownership

### 5.1 Cưỡng chế bằng quyền của PostgreSQL, không chỉ bằng quy ước

Đây là điểm mạnh nhất của shared-database khi làm cho tử tế: mỗi service **một DB user riêng**,
chỉ được GRANT trên bảng mình sở hữu.

```sql
CREATE ROLE learning_service LOGIN PASSWORD '...';

-- Sở hữu: toàn quyền
GRANT SELECT, INSERT, UPDATE, DELETE ON
  roadmaps, courses, chapters, lessons, lesson_progress, course_enrollments /* ... */
  TO learning_service;

-- KHÔNG cấp gì trên users, exercises, submissions...
-- Cố tình SELECT cũng nhận "permission denied for table users".
```

ESLint chặn được lập trình viên vô ý. Quyền CSDL chặn được **cả khi cố tình**, cả script
chạy tay, cả migration lỗi.

### 5.2 Đọc dữ liệu service khác: view, không phải bảng

Có lúc gọi HTTP là quá tốn (join danh sách 50 người dùng để hiển thị bảng xếp hạng nhóm).
Khi đó cấp quyền đọc trên **view**, không phải bảng gốc:

```sql
CREATE VIEW v_user_summary AS
  SELECT id, display_name, avatar_url, role
  FROM users WHERE status <> 'deleted';

GRANT SELECT ON v_user_summary TO workspace_service, learning_service;
```

View là **hợp đồng đọc ổn định**: core đổi cấu trúc bảng `users` mà giữ nguyên view thì
không service nào vỡ. Cấp quyền thẳng trên bảng thì mọi thay đổi cột đều là breaking change.

> Quy tắc: **đọc qua view/HTTP, ghi chỉ chủ sở hữu.** Không service nào được `UPDATE`
> bảng của service khác — kể cả khi "chỉ một cột thôi".

### 5.3 Migration vẫn thuộc `codementor-infra`

Không đổi so với quyết định trước: infra sở hữu SQL migration (28 trigger + 5 hàm PL/pgSQL),
mọi service chỉ `prisma db pull`. Thêm một migration mới cho phần GRANT ở §5.1.

Với 9 service dùng chung một `schema.prisma`, mỗi service chỉ *sử dụng* phần model của mình —
Prisma không chặn được điều đó, nên quyền CSDL ở §5.1 mới là lớp bảo vệ thật.

### 5.4 Phải sửa trước khi tách: `exercises.owner_group_id`

```text
exercises.owner_group_id     → study_groups   exercise-service ghi bảng của workspace?
group_exercises.exercise_id  → exercises      workspace-service ghi bảng của exercise?
```

Khi còn 1 tiến trình thì đây chỉ là mùi thiết kế. Khi tách thành 2 service, FK này khiến
**không thể cấp GRANT sạch** — và sẽ vỡ ngay khi tách database thật.

Sửa: bỏ `exercises.owner_group_id`, thêm `exercises.visibility ('public' | 'group')`.
Câu hỏi "nhóm nào sở hữu" do `group_exercises` (workspace-service) trả lời.
→ Phụ thuộc còn một chiều `workspace → exercise`, khớp thứ tự ở §4.1.

### 5.5 Transactional outbox

Vấn đề: ghi DB xong rồi publish Kafka — nếu chết giữa hai bước thì mất event vĩnh viễn.
Nộp bài lưu rồi mà `cmd.judge.run` không phát → bài treo mãi ở trạng thái `pending`.

Cách xử lý: ghi event vào bảng `outbox` **trong cùng transaction** với dữ liệu nghiệp vụ,
một poller đọc và đẩy lên Kafka.

```sql
CREATE TABLE outbox (
  id            uuid PRIMARY KEY,
  topic         text NOT NULL,
  partition_key text NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);
CREATE INDEX ON outbox (created_at) WHERE published_at IS NULL;
```

Chi phí: 1 bảng + 1 background job trong `libs/messaging`. **Đáng làm cho luồng nộp bài**
(mất event = mất bài của người dùng). Các luồng ít nghiêm trọng hơn có thể publish trực tiếp
lúc đầu, thêm outbox sau — vì port `EventBus` đã che khác biệt này.

---

## 6. Hạ tầng

### 6.1 Bổ sung so với hiện tại

| Thành phần | Mục đích | Ghi chú |
| --- | --- | --- |
| **Kafka (KRaft)** | async giữa service | 1 broker, **không ZooKeeper** — nhẹ hơn nhiều |
| **Kafka UI** | xem topic/message khi debug | vô giá lúc demo và bảo vệ |
| **Redis** | Socket.IO adapter khi realtime chạy >1 instance | có thể bỏ nếu chỉ 1 instance |
| Keycloak | đã có | mọi service xác minh cùng JWKS |

### 6.2 Vì sao KRaft single-broker

Kafka bản đầy đủ (3 broker + ZooKeeper) tốn ~3GB RAM và không thêm giá trị nào cho KLTN.
KRaft bỏ ZooKeeper, chạy 1 broker vẫn đủ mọi tính năng cần: topic, partition, consumer
group, offset. Đổi sang cluster thật sau này chỉ là đổi config, không đụng code.

*Redpanda là lựa chọn nhẹ hơn nữa (tương thích Kafka API, 1 binary Go, ~200MB) — cân nhắc
nếu máy dev yếu.*

---

## 7. Realtime Service

Không sở hữu bảng, không có business logic. Nhiệm vụ duy nhất: **cầu nối Kafka → client**.

```text
Kafka ──▶ realtime-service ──WS/SSE──▶ frontend
```

| Việc | Cách làm |
| --- | --- |
| Xác thực | cùng JWKS Keycloak; lấy `userId` từ token lúc handshake |
| Định tuyến | mỗi client vào room `user:<id>` và `group:<id>` theo nhóm đang tham gia |
| Lọc | **chỉ đẩy event mà người dùng có quyền thấy** — realtime là một bề mặt rò rỉ dữ liệu rất dễ bị bỏ quên |
| Consumer group | riêng, để không tranh message với service nghiệp vụ |
| Chọn WS hay SSE | WS cho `/workspace` (hai chiều); **SSE** cho tiến trình chấm bài (một chiều, tự reconnect, đơn giản hơn nhiều) |

---

## 8. Thứ tự triển khai đề xuất

| Giai đoạn | Nội dung | Kết quả kiểm chứng được |
| --- | --- | --- |
| 1 | Monorepo + `libs/*` + tách `core-service` | 1 service chạy, health OK |
| 2 | `learning-service` + HTTP client sang core | 2 tiến trình gọi nhau qua mạng |
| 3 | Kafka + `libs/messaging` + `evt.user.provisioned` | 1 event chạy hết vòng |
| 4 | `exercise-service`, `workspace-service` | |
| 5 | `submission` + `judge` + outbox | luồng chấm bài đầy đủ |
| 6 | `ai-service` (tài liệu nhóm nằm luôn trong `workspace-service`; `document-service` đã bỏ) | |
| 7 | `realtime-service` | UI cập nhật trực tiếp |
| 8 | GRANT theo service (§5.1) | service khác `permission denied` |

Giai đoạn 8 nên làm **sớm hơn nếu có thể** — càng để lâu càng nhiều chỗ lỡ đọc bảng người khác.

---

## 9. Rủi ro cần biết trước

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| 9 service cho KLTN là nhiều | Thời gian dựng + debug phân tán | Gộp `document→workspace`, `judge→submission` còn 7 nếu chậm tiến độ |
| Kafka at-least-once ⇒ xử lý trùng | Cộng XP hai lần, chấm hai lần | `eventId` + bảng `processed_events` mỗi consumer |
| Shared DB ⇒ mất ACID xuyên service | Dữ liệu không nhất quán tạm thời | Chấp nhận eventual consistency; giữ ACID **trong** service |
| Không có transaction phân tán | Nộp bài lưu rồi mà không chấm | Outbox §5.5 cho luồng quan trọng |
| Vẫn 1 database ⇒ vẫn 1 điểm chết chung | Toàn hệ thống dừng | Đã chấp nhận ở giai đoạn này; tách DB là bước sau |
| Debug xuyên 4 service | Tốn thời gian | `correlationId` bắt buộc trong mọi message + log |
