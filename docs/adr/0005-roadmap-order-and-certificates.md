# 0005. Học lộ trình theo thứ tự (khóa mềm) và chứng chỉ hoàn thành

- Status: accepted, implemented 2026-11-06 on branch `feat/roadmap-order-certificates` in backend,
  frontend and infra — **not deployed** (DB changes 0047–0049 and the Mongo validator are already
  on production; the code that uses them is not). See "Implementation" at the end.
- Scope: `apps/learning-service` (enrollment, context `certificate` mới), `apps/notification-service`,
  `apps/ai-service/app/lecter`, `codementor-infra` migration, frontend `client` + `lecturer` +
  `packages/ui`

## Context

**Thứ tự khóa trong lộ trình hiện không có tác dụng.** `findRoadmapProgress` tính `isAvailable`
bằng `fn_course_available AND fn_roadmap_course_available`. Cả 7 lộ trình trên prod đều ở
`progression_mode = 'graph'`, và chế độ này đọc `roadmap_course_prerequisites`, một bảng không
có ai ghi. Vì vậy mọi khóa đều mở. Nhãn UI (`MODE_LABELS.graph`) ghi "Tuần tự — mở dần theo
thứ tự", nhưng ở cấp lộ trình thì không đúng. Chỉ ở cấp bài học là đúng, vì
`lesson_prerequisites` được `saveCurriculum` tự sinh. Nhánh `linear` của
`fn_roadmap_course_available` thì khóa cứng thật, nhưng không lộ trình nào dùng.

**Hai hàm đó đã bị DROP trong repo.** Migration `codementor-infra/.../0021_drop_unused_prerequisite_graph.sql`
xóa cả hai, nhưng prod chưa áp 0021 (sổ migration lệch). Code vẫn gọi chúng. Ai áp 0021 thì
`GET /roadmaps/:id/progress` sẽ trả 500.

**Hoàn thành đã được ghi nhận đầy đủ, chỉ chưa có gì để trao.**

- `course_enrollments.status = 'completed'` do trigger tiến độ (0012) ghi.
- `fn_refresh_roadmap_progress` đặt `roadmap_enrollments.status = 'completed'` khi mọi khóa
  không `is_optional` đều xong. Lộ trình quay về `active` nếu giảng viên thêm khóa bắt buộc mới.
- notification-service đã gửi email `COURSE_COMPLETED` qua outbox → `ReminderSourceChanged`.
  Lộ trình thì chưa có email nào.

**Lecter ghi dữ liệu qua trình duyệt.** Server tool (Python) chỉ đọc. Tool ghi là HITL trong
`apps/lecturer/src/features/lecter/hitl-*.tsx`, giảng viên bấm xác nhận rồi trình duyệt gọi API.
Khóa học và lộ trình đã có bộ tool riêng theo mẫu này.

## Decision

### A. Thứ tự lộ trình là khóa mềm

- Lộ trình có `progression_mode <> 'free'` là **có thứ tự**. Không migrate dữ liệu: `graph` và
  `linear` cùng nghĩa là "có thứ tự, cảnh báo khi bỏ qua"; `free` là không cảnh báo.
- Backend không chặn. Từ trước đến nay `enroll` cũng chưa từng chặn theo thứ tự lộ trình.
  `findRoadmapProgress` bỏ hai hàm SQL đã bị DROP. Mỗi khóa trả về thêm
  `blockedBy: { courseId, position, title }[]`: các khóa đứng trước, không `is_optional`, chưa
  `completed`. Danh sách được tính trong TypeScript từ chính các hàng truy vấn ra.
  `isAvailable` giữ lại cho client cũ và luôn là `true`.
- **Cảnh báo chỉ hiện ở bước bắt đầu học.** Khi học viên bấm vào khóa N mà `blockedBy` không
  rỗng và họ **chưa ghi danh** khóa N, hiện hộp xác nhận:
  "Bạn chưa hoàn thành khóa 1 “…”. Xác nhận bỏ qua để học khóa 2?",
  với hai nút [Học khóa 1] / [Bỏ qua, học khóa 2].
  Khi đã ghi danh, lần vào sau không hỏi lại. Nhờ vậy không cần lưu trạng thái "đã xác nhận bỏ
  qua".
- Đi thẳng từ /courses, ngoài ngữ cảnh lộ trình, thì không cảnh báo. Đó là phần học tự do.
- Thẻ khóa bị bỏ qua có dòng gợi ý "Nên học sau khóa 1". Trạng thái "Đang khóa" bỏ khỏi trang
  lộ trình.

### B. Chứng chỉ: mẫu do giảng viên thiết kế, học viên nhận một lần

**Dữ liệu** (migration mới ở `codementor-infra`):

```sql
CREATE TYPE certificate_subject AS ENUM ('course', 'roadmap');

certificate_templates (
  id uuid PK, owner_id uuid NULL REFERENCES users,   -- NULL = mẫu mặc định của nền tảng
  name text, subject certificate_subject NULL,       -- NULL = dùng được cho cả hai
  design jsonb NOT NULL, archived_at timestamptz NULL, created_at, updated_at)

ALTER TABLE courses  ADD certificate_template_id uuid NULL REFERENCES certificate_templates;
ALTER TABLE roadmaps ADD certificate_template_id uuid NULL REFERENCES certificate_templates;

certificates (
  id uuid PK, code text UNIQUE,                      -- 10 ký tự base32, dùng để xác thực công khai
  user_id uuid, subject certificate_subject, subject_id uuid,
  recipient_name text, data jsonb, design jsonb,     -- ẢNH CHỤP lúc cấp
  issued_at, revoked_at NULL, revoke_reason NULL)
CREATE UNIQUE INDEX ON certificates (user_id, subject, subject_id) WHERE revoked_at IS NULL;
```

- **Ảnh chụp, không tham chiếu.** Sau này giảng viên sửa mẫu hoặc đổi tên khóa thì chứng chỉ đã
  cấp vẫn giữ nguyên.
- **"Một lần" do CSDL đảm bảo**, bằng unique index. Hai tab bấm xác nhận cùng lúc thì một tab
  nhận 409. Sửa tên in sai thì admin thu hồi (`revoked_at`), sau đó học viên nhận lại.
- Khóa/lộ trình chưa gắn mẫu thì dùng mẫu mặc định của nền tảng (seed trong migration). Như vậy
  học viên luôn có chứng chỉ, còn giảng viên chỉ tùy biến nếu muốn.
- Chứng chỉ được giữ nguyên khi lộ trình quay về `active`. Học viên đã thật sự hoàn thành tại
  thời điểm nhận.

**`design` v1 là form, không phải canvas tự do:**

```ts
{ version: 1, layout: 'classic' | 'modern' | 'minimal', accent: <màu trong bảng cho sẵn>,
  logoKey?: string, signatureKey?: string, signerName: string, signerTitle?: string,
  heading: string, body: string,                    // có placeholder
  fields: { label: string; value: string }[] }      // tối đa 6, value có placeholder
```

Placeholder theo danh sách cố định: `{{learnerName}} {{subjectTitle}} {{instructorName}}
{{startedAt}} {{completedAt}} {{durationHours}} {{issuedAt}} {{certificateCode}}`.
Placeholder lạ bị từ chối ở cả ba nơi kiểm: form giảng viên, API, Lecter. Ảnh logo/chữ ký
upload bằng presign của `ObjectStorage` có sẵn (giống ảnh bìa), prefix
`certificates/templates/{id}/`.

**Một bộ vẽ dùng chung:** `CertificateView` trong `packages/ui`, khổ A4 ngang, HTML/SVG. Màn
soạn của giảng viên, màn xem trước của học viên và trang chứng chỉ đều dùng nó, nên xem trước
giống hệt bản thật. Tải PDF bằng CSS in (`window.print`). Chưa render PDF phía server.

**API** (learning-service, context `certificate`):

| Ai | Endpoint |
|---|---|
| Giảng viên | `GET/POST/PATCH/DELETE /lecturer/certificate-templates`, `POST …/:id/assets` (presign) |
| Giảng viên | `PUT /courses/:id/certificate-template`, `PUT /roadmaps/:id/certificate-template` — chỉ chủ sở hữu |
| Học viên | `courseProgress` / `roadmapProgress` trả thêm `certificate: { status: 'locked' \| 'claimable' \| 'issued', preview?, certificate? }` |
| Học viên | `POST /certificates { subject, subjectId, recipientName }` → 201 / 409 / 422 (chưa hoàn thành) |
| Học viên | `GET /certificates/mine` |
| Công khai | `GET /certificates/:code` — trang xác thực |

`recipientName` được chuẩn hóa: trim, gộp khoảng trắng, dài 2–80 ký tự, chỉ chữ Unicode và
`space . ' -`, theo luật validate input đã chốt. Ô nhập điền sẵn `displayName`.

**Luồng của học viên** (mục "Chứng chỉ" trên trang chi tiết khóa học và lộ trình):

1. `locked`: hiện "Hoàn thành X% để nhận chứng chỉ" cùng ảnh mẫu mờ.
2. `claimable`: nhập tên → xem trước bằng `CertificateView` → hộp xác nhận
   "Tên trên chứng chỉ không sửa được sau khi nhận".
3. `issued`: hiện chứng chỉ, mã, ngày cấp, các nút [Xem / In PDF] [Sao chép liên kết xác thực].

Ngoài ra có trang công khai `/certificates/[code]` (không cần đăng nhập) và mục
"Chứng chỉ của tôi" trong tài khoản.

**Email** (notification-service):

- `COURSE_COMPLETED`: đổi nút thành "Nhận chứng chỉ" → `/courses/:id#certificate`.
- `ROADMAP_COMPLETED` (mới): thêm trigger `reminder_source` trên `roadmap_enrollments`, cùng
  mẫu email.
- `CERTIFICATE_ISSUED` (mới): `POST /certificates` ghi outbox `learning.certificate.issued.v1`
  trong cùng transaction. notification-service tạo thông báo trong app và gửi email chúc mừng
  kèm liên kết xác thực. Category `learning`, nên tôn trọng opt-out.

### C. Lecter thiết kế chứng chỉ

Theo đúng mẫu của khóa học và lộ trình:

- Server tool: `list_certificate_templates`, `read_certificate_template`,
  `validate_certificate_design` (Python thuần, cùng luật placeholder/độ dài với API).
- HITL trình duyệt: `save_certificate_template` (tạo/sửa, thẻ xác nhận có ảnh xem trước
  `CertificateView`) và `attach_certificate_template` (gắn vào khóa học hoặc lộ trình của giảng
  viên).
- Lecter không upload ảnh. Ô logo/chữ ký để trống, giảng viên tự tải lên.

## Phases

Mỗi phase deploy độc lập, phase sau không làm hỏng phase trước.

| # | Nội dung | Repo |
|---|---|---|
| 1 | **Thứ tự mềm.** `blockedBy` + bỏ gọi hàm đã DROP; hộp xác nhận bỏ qua trên trang lộ trình; sửa nhãn `MODE_LABELS` cho đúng nghĩa. | backend, frontend/client, packages/types |
| 2 | **Mẫu chứng chỉ.** Migration (bảng, cột, seed mẫu mặc định); CRUD + presign + gắn mẫu; `CertificateView`; màn "Chứng chỉ" ở lecturer + ô chọn mẫu trong studio khóa học/lộ trình. | infra, backend, frontend/lecturer, packages/ui |
| 3 | **Học viên nhận chứng chỉ.** `certificate` trong progress; `POST /certificates` + outbox; mục Chứng chỉ ở trang khóa học/lộ trình; trang xác thực công khai; "Chứng chỉ của tôi". | backend, frontend/client |
| 4 | **Email.** `CERTIFICATE_ISSUED`, `ROADMAP_COMPLETED`, đổi CTA `COURSE_COMPLETED`. | infra (trigger), backend |
| 5 | **Lecter.** 3 server tool + 2 HITL + prompt + test validate. | backend/ai-service, frontend/lecturer |
| 6 | (Tùy chọn) Admin thu hồi/cấp lại; thống kê tỉ lệ bỏ qua thứ tự cho giảng viên. | backend, admin |

Phase 1 nên làm trước tiên vì nó gỡ một lỗi 500 tiềm ẩn. Phase 2→3 là đường găng của chứng chỉ.
Phase 4 và 5 làm song song được sau phase 3.

## Consequences

- Áp migration prod bằng `psql` từng file rồi tự ghi sổ. Không chạy `migrate-postgres.sh`, vì
  sổ migration đang lệch.
- Sau phase 1 thì áp được 0021 mà không làm hỏng trang lộ trình.
- `CourseCard state="locked"` không còn chỗ nào dùng. Xóa ở phase 1.
- Giá trị của chứng chỉ chỉ bằng độ tin cậy của tiến độ. Tua video vẫn được tính là đã xem, nên
  "hoàn thành" không có nghĩa là đã nắm bài. Chưa xử lý trong ADR này.
- Trang công khai lộ tên học viên và tên khóa cho ai có mã. Mã 10 ký tự base32 (~50 bit) không
  đoán được. Cho học viên ẩn chứng chỉ thì để sau.
- Không làm trong v1: canvas kéo thả tự do, PDF phía server, chứng chỉ có điểm số/xếp loại.

## Implementation (2026-11-06)

Quyết định đã chốt với người dùng: mọi khóa học/lộ trình mặc định có chứng chỉ (mẫu nền tảng),
có trang xác thực công khai, sửa tên in sai = admin thu hồi rồi học viên nhận lại. Bổ sung
**phase báo cáo học tập** (không có trong bản đề xuất), nên thứ tự cuối là:

| # | Nội dung | backend | frontend | infra |
|---|---|---|---|---|
| 1 | Thứ tự mềm | `03107a4` | `2a9c3f4` | `f8e71a5` (0047) |
| 2 | Mẫu chứng chỉ | `3b37ef3` | `9597f2e` | `b01841c` (0048) |
| 3 | Nhận / xác thực / thu hồi | `f371e6a` | `a417a0f` | — |
| 4 | Email + thông báo | `1814ced` | `3e750f4` | `50f5b42` (0049 + Mongo) |
| 5 | Báo cáo học tập | `a1b91b2` | `428f527` | — |
| 6 | Lecter | `eb3c170` | `a7e3b60` | — |

Lệch so với thiết kế ở trên, và vì sao:

- Trạng thái chứng chỉ là endpoint riêng `GET /certificates/status/:subject/:id`, không nhúng
  vào `courseProgress`/`roadmapProgress`: context `certificate` không phải phụ thuộc vào context
  `learning`.
- `POST /certificates` trả `{ status: 'issued', certificate }`, không trả thẳng chứng chỉ:
  response interceptor coi mọi body có khóa `data` là đã bọc sẵn, mà chứng chỉ có trường `data`.
- Không bắt buộc `{{learnerName}}` trong nội dung: mọi bố cục tự in tên cỡ lớn.
- "Chứng chỉ của tôi" ở `/my-certificates` (route `/certificates/[code]` là trang công khai).
- Thu hồi lưu `revoked_by`/`revoke_reason` trên hàng chứng chỉ, không ghi `audit_logs` (bảng của
  core-service).
- `MODE_LABELS` giữ nguyên: nhãn đó đúng ở cấp bài học, còn studio lộ trình không có ô chọn chế độ.
- Báo cáo: một endpoint `GET /learning-reports?days` (tổng hợp + theo khóa + theo lộ trình
  + phễu), **chỉ admin**, toàn nền tảng — người dùng bỏ trang báo cáo bên lecturer. Giảng viên
  chỉ thấy thêm 2 KPI ở dashboard (ngưng học, chứng chỉ đã cấp). `STALLED_DAYS = 14`.
- Lecter: model gửi id của mẫu MẶC ĐỊNH khi được bảo "tạo mẫu mới" dù prompt cấm; thẻ xác nhận
  tự đọc mẫu và chuyển thành tạo mới.
- Kong thêm `/certificate-templates`, `/certificates`, `/learning-reports` — phải restart Kong khi
  deploy.

Deploy cần: build lại learning, notification, ai (và core/recommendation vì `libs/contracts`
đổi), restart Kong; frontend client/lecturer/admin.
