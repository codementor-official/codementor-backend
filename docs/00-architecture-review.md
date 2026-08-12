# Review & Đề xuất kiến trúc Backend

Viết **trước khi code**, sau khi rà soát `codementor-frontend`, `codementor-infra` (44 bảng
PostgreSQL + 4 collection MongoDB) và bộ tài liệu phân tích actor/use-case.

---

## 1. Hiện trạng ba repo

| Repo | Trạng thái | Ảnh hưởng tới backend |
| --- | --- | --- |
| `codementor-frontend` | Gần hoàn thiện, chạy bằng mock. Các `lib/*/*-service.ts` được viết *"shaped like a future REST/GraphQL client"* | Đây là **hợp đồng API không chính thức** — backend nên bám shape này để frontend chỉ việc thay mock bằng `fetch` |
| `codementor-infra` | **Schema đã hoàn chỉnh và đã kiểm chứng**: 44 bảng, 75 FK, 79 CHECK, 28 trigger, 5 hàm availability, 15 test pass | Backend **không được** tự sinh schema. Xem §5 |
| `codementor-backend` | Rỗng (chỉ `README.md`) | Greenfield |

**Điểm mấu chốt:** database có trước, và **đã chứa business logic** — trigger chống chu trình phụ
thuộc, `fn_lesson_available`, trigger cập nhật cache tiến độ. Backend phải *tôn trọng* lớp này,
không nhân bản cũng không bỏ qua.

---

## 2. Phân tích boundary bằng dữ liệu, không bằng cảm tính

Đếm khoá ngoại cắt ngang các boundary đề xuất (chạy script trên catalog thật của database):

| Chiều phụ thuộc | Số FK | Đánh giá |
| --- | --- | --- |
| `group → identity` | 7 | OK — chỉ tham chiếu `user_id` |
| `learning → identity` | 7 | OK |
| `exercise → identity` | 4 | OK |
| `exercise → taxonomy` | 3 | Taxonomy **chưa có chủ** trong đề xuất |
| `learning → taxonomy` | 2 | như trên |
| `content → identity/taxonomy` | 2 | `articles` **chưa có chủ** |
| `learning → exercise` | 1 | OK — một chiều |
| `submission → exercise/group/identity` | 3 | OK — một chiều |
| **`exercise → group`** | 1 | **Phụ thuộc hai chiều** |
| **`group → exercise`** | 1 | **Phụ thuộc hai chiều** |

### 2.1 Vấn đề nghiêm trọng nhất: `Exercise ↔ Group` phụ thuộc hai chiều

```text
exercises.owner_group_id     → study_groups(id)    Exercise phải biết Group tồn tại
group_exercises.exercise_id  → exercises(id)       Group phải biết Exercise tồn tại
```

Vòng phụ thuộc này khiến **không thể tách service nào ra trước** — đúng thứ mà mục tiêu
*"sau này tách service mà không rewrite"* muốn tránh.

**Đề xuất sửa** (một migration nhỏ, nên làm sớm khi chưa có dữ liệu thật):

```text
ALTER TABLE exercises DROP COLUMN owner_group_id;
ALTER TABLE exercises ADD COLUMN visibility exercise_visibility NOT NULL DEFAULT 'public';
```

`public` = catalog chung, `group` = riêng tư. Câu hỏi *"nhóm nào sở hữu"* do `group_exercises`
trả lời. Sau đó phụ thuộc chỉ còn **một chiều `Group → Exercise`**.

### 2.2 `technologies` / `tags` / `companies` không có chủ

6 FK trỏ tới từ hai service khác nhau. Đây là **Shared Kernel** kinh điển:

| Cách | Đánh giá |
| --- | --- |
| Nhét vào Learning | Exercise phải gọi Learning chỉ để lấy danh sách tag |
| Service "Catalog" riêng | Đúng lý thuyết, nhưng 3 bảng read-mostly thành 1 service là over-engineer |
| **Shared Kernel module** *(chọn)* | Bounded context nhỏ, **chỉ đọc** với mọi service, chỉ Admin được ghi |

Shared Kernel là pattern DDD hợp lệ — miễn là **ghi rõ ai được ghi**.

### 2.3 `articles` không có chủ

Một bảng, vòng đời độc lập với phân cấp học tập, không ai FK tới nó.
**Đề xuất:** đưa vào `Learning` như module tách biệt. Sau này tách ra rẻ vì không có FK đến.

---

## 3. Danh sách service chốt

| # | Service | Bounded context | Sở hữu |
| --- | --- | --- | --- |
| 1 | **Identity** | Hồ sơ người dùng, cá nhân hoá. **Xác thực do Keycloak** — xem [01-identity-keycloak.md](01-identity-keycloak.md) | `users`, `user_stats`, `learning_preferences`, `study_schedule_slots` |
| 2 | **Catalog** *(shared kernel)* | Từ vựng dùng chung | `technologies`, `tags`, `companies` |
| 3 | **Learning** | Lộ trình → khoá → chương → bài, phụ thuộc, ghi danh, tiến độ, bài viết | 18 bảng `roadmap*`, `course*`, `chapters`, `lessons`, `*_prerequisites`, `*_enrollments`, `lesson_progress`, `articles` |
| 4 | **Exercise** | Bài tập, bộ bài tập, phụ thuộc, trạng thái luyện tập | `exercises`, `exercise_*` — 9 bảng |
| 5 | **Group** | Nhóm, thành viên, phân quyền nhóm, tài liệu, giao bài | `study_groups`, `group_*`, `assignments` — 8 bảng |
| 6 | **Submission** | Bài nộp, điều phối chấm | `submissions` |
| 7 | **AI** | Tích hợp AI: hỏi đáp, phân tích lỗi, tiền kiểm tài liệu | *(chưa có bảng — §3.2)* |

### 3.1 Điều chỉnh so với đề xuất ban đầu

| Đề xuất của bạn | Điều chỉnh | Lý do |
| --- | --- | --- |
| 6 service | **7** (thêm Catalog) | Taxonomy có 6 FK cắt ngang mà không ai sở hữu |
| Submission gồm *"Code Execution"* | Code Execution là **port ra ngoài**, không nằm trong service | Chạy code không tin cậy là sandbox riêng biệt. Submission chỉ *điều phối*. Khớp actor "Hệ thống chấm bài" |
| AI là service ngang hàng | AI là **thin integration + anti-corruption layer** | Theo phân tích actor, AI **không bao giờ tự khởi xướng**. Đừng dựng aggregate/domain service cho thứ chỉ gọi API ngoài |
| Group gồm *"Group Owner"* | Owner là **vai trò**, không phải entity | Đã phân tích ở tài liệu actor |

### 3.2 Lỗ hổng: AI chưa có nơi lưu dữ liệu

Frontend có `/ai-tutor` với hội thoại, schema có `ai_verdict` cho tài liệu — nhưng **không có
bảng/collection nào lưu hội thoại hoặc ngữ cảnh AI**. Cần bổ sung ở MongoDB (shape đổi theo provider):

```text
ai_conversations  { userId, contextType, contextId, messages[], model, createdAt }
ai_analyses       { targetType, targetId, verdict, findings[], model, promptVersion }
```

---

## 4. Ranh giới được cưỡng chế bằng gì?

Nói "có service boundary" mà không có cơ chế chặn thì vài tháng sau sẽ có `import` xuyên context.
Ba lớp:

| Lớp | Cơ chế |
| --- | --- |
| **Compile-time** | ESLint `import/no-restricted-paths`: cấm import chéo `contexts/*` trừ qua `*.public.ts` |
| **Kiến trúc** | `domain/` không được import NestJS / Prisma / Mongoose — cũng bằng ESLint zone |
| **Runtime** | Mỗi context chỉ inject repository của chính nó. Ghi dữ liệu context khác **chỉ qua domain event** |

### 4.1 Ghi chéo service — dùng domain event, không gọi thẳng

Schema hiện tại có hai chỗ ghi chéo:

| Bảng | Chủ sở hữu | Ai kích hoạt ghi | Giải pháp |
| --- | --- | --- | --- |
| `exercise_progress` | Exercise | Submission (khi chấm đạt) | Submission phát `SubmissionAccepted` → Exercise xử lý |
| `user_stats` | Identity | Submission (XP, streak) | Cùng event, Identity là handler thứ hai |

> **Đã thay đổi:** tài liệu này viết khi kiến trúc còn là modular monolith với in-process
> event bus. Sau đó đã chuyển sang **9 service + Kafka** —
> xem [`02-service-architecture.md`](02-service-architecture.md) là bản chốt hiện hành.
> Phần phân tích boundary (§2) và quyết định về migration (§5) vẫn còn hiệu lực.

---

## 5. Quyết định quan trọng: ai sở hữu migration?

> **`codementor-infra` sở hữu schema. Backend chỉ đọc.**

Schema đã có 28 trigger, 5 hàm PL/pgSQL, 79 CHECK và bộ `verify.sql` 15 test. Prisma Migrate
**không diễn đạt được** những thứ này — lần `migrate dev` đầu tiên sẽ **xoá sạch trigger và hàm**.

| Việc | Cách làm |
| --- | --- |
| Đổi schema | Viết SQL migration trong `codementor-infra/database/postgres/migrations/` |
| Backend đồng bộ | `prisma db pull` (introspect) → `prisma generate` |
| CI | Chạy `verify.sql` sau migration; `db pull --print` để phát hiện schema lệch |
| **Cấm** | `prisma migrate dev` / `migrate deploy` trong repo backend |

Bất biến vẫn nằm ở CSDL (đúng nguyên tắc của `04-design-decisions.md`); backend **không nhân bản**
chúng, chỉ dịch SQLSTATE thành lỗi domain dễ hiểu — ví dụ `23514` → `CircularDependencyError`.

---

## 6. Tech stack chốt

| Thành phần | Chọn | Ghi chú |
| --- | --- | --- |
| Runtime | Node 24 | máy đang chạy v24.12 |
| Framework | **NestJS 11** + **Fastify 5** | mới nhất ổn định |
| Ngôn ngữ | TypeScript 5, `strict` | |
| PostgreSQL | **Prisma 6.19.x** *(không phải 7)* | xem §6.1 |
| MongoDB | **Mongoose 9** | |
| API doc | `@nestjs/swagger` 11 | |
| Validation | `class-validator` ở biên HTTP, **zod** cho config | |
| Xác thực | **Keycloak 26** (OIDC, RS256 qua JWKS) | hỗ trợ đăng nhập nhiều mạng xã hội |
| Log | `nestjs-pino` | structured, có request-id |
| Test | Jest + Supertest | |
| Event | `@nestjs/event-emitter` | **không Kafka** giai đoạn này |

### 6.1 Vì sao Prisma 6 chứ không phải 7 (bản mới nhất)

Prisma 7 vừa phát hành và đang **thay đổi mô hình cấu hình**: chuyển từ `schema.prisma` + `env()`
sang `prisma.config.ts`, driver adapters, song song đó là dòng "Prisma Next" đang phát triển.
Với bối cảnh KLTN:

- Ta **không dùng** Prisma Migrate (điểm mạnh chính của v7), chỉ cần introspection + client
  type-safe — phần này v6 đã ổn định nhiều năm.
- Tài liệu/ví dụ tích hợp NestJS hiện chủ yếu cho v5/v6.
- Rủi ro gặp breaking change giữa kỳ làm luận văn không đáng đánh đổi.

Nâng lên v7 sau này rẻ, vì `domain/` không biết Prisma tồn tại — chỗ cần đổi chỉ nằm trong
`shared/database/`. **Nếu bạn muốn v7 ngay, nói một tiếng.**

---

## 7. Cấu trúc thư mục đề xuất

```text
src/
├── main.ts
├── app.module.ts
│
├── shared/                     # hạ tầng dùng chung — KHÔNG chứa business logic
│   ├── kernel/                 # building block DDD, thuần TypeScript
│   │   ├── entity.ts, aggregate-root.ts, value-object.ts
│   │   ├── domain-event.ts, result.ts, domain-error.ts
│   │   └── repository.port.ts
│   ├── config/                 # env validate bằng zod
│   ├── database/
│   │   ├── prisma/             # PrismaService + ánh xạ lỗi SQLSTATE
│   │   └── mongo/              # kết nối Mongoose
│   ├── http/                   # exception filter, response interceptor, pipe
│   ├── logging/
│   ├── events/                 # EventBus port + adapter in-process
│   └── auth/                   # JWT strategy, guard, decorator
│
├── contexts/
│   ├── identity/
│   │   ├── domain/             # KHÔNG import NestJS/Prisma
│   │   │   ├── model/          # User, Email, Password (value object)
│   │   │   ├── event/
│   │   │   └── port/           # UserRepository (interface)
│   │   ├── application/        # use case — không phụ thuộc HTTP
│   │   ├── infrastructure/     # PrismaUserRepository, hashing adapter
│   │   ├── presentation/       # controller v1 + DTO
│   │   ├── identity.public.ts  # hợp đồng DUY NHẤT cho context khác
│   │   └── identity.module.ts
│   └── catalog/ learning/ exercise/ group/ submission/ ai/
│
└── test/
```

**Quy tắc vàng:** context khác **chỉ được** import từ `<context>.public.ts`. Mọi thứ còn lại là
nội bộ. Khi tách microservice, `*.public.ts` chính là chỗ đổi từ gọi hàm sang gọi HTTP/gRPC.

---

## 8. Tóm tắt điểm cần điều chỉnh

| # | Vấn đề | Mức độ | Đề xuất |
| --- | --- | --- | --- |
| 1 | `Exercise ↔ Group` phụ thuộc hai chiều | **Cao** | Bỏ `exercises.owner_group_id`, thêm `visibility` |
| 2 | Taxonomy không có chủ | Vừa | Lập shared-kernel context `catalog` |
| 3 | `articles` không có chủ | Thấp | Đưa vào Learning |
| 4 | AI chưa có nơi lưu dữ liệu | Vừa | Thêm 2 collection MongoDB |
| 5 | `companies`/`exercise_companies` không use case nào dùng | Thấp | Bỏ hoặc bổ sung use case |
| 6 | Ghi chéo `exercise_progress`, `user_stats` | Vừa | Domain event thay vì gọi thẳng |
| 7 | Prisma Migrate sẽ xoá trigger/function | **Cao** | Cấm migrate ở backend; infra sở hữu schema |

**Chỉ #1 và #7 cần chốt trước khi code.** Còn lại xử lý dần.
