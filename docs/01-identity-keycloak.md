# Identity với Keycloak

Quyết định: **Keycloak là nhà cung cấp danh tính**, backend là **resource server**.
Lý do: yêu cầu đăng nhập bằng nhiều mạng xã hội.

## 1. Ai sở hữu cái gì

| Thuộc về | Keycloak | CodeMentor (bảng `users`) |
| --- | --- | --- |
| Mật khẩu, MFA, khôi phục mật khẩu | ✅ | ❌ (cột `password_hash` đã bị bỏ) |
| Liên kết Google / GitHub / Facebook | ✅ | ❌ |
| Phát & ký access token | ✅ (RS256) | ❌ chỉ xác minh |
| Vai trò nền tảng (`learner` / `admin`) | ✅ realm role | mirror để join/truy vấn |
| Tên hiển thị, handle, bio | ❌ | ✅ |
| Trạng thái tài khoản trong sản phẩm | ❌ | ✅ (`status`) |
| Vai trò trong **nhóm học tập** | ❌ | ✅ `group_members` + ma trận quyền |

Vai trò nhóm **không** đưa vào Keycloak: nó theo ngữ cảnh từng nhóm và có ma trận quyền
ghi đè theo từng người — Keycloak group không diễn đạt được, và nó cũng thuộc nghiệp vụ
của ta chứ không phải của nhà cung cấp danh tính.

## 2. Luồng xác thực

```text
Frontend ──(1) redirect──▶ Keycloak  (đăng nhập / social / đăng ký)
Frontend ◀─(2) access token (RS256)──┘
Frontend ──(3) Authorization: Bearer ──▶ Backend
                                          │ (4) xác minh chữ ký qua JWKS
                                          │ (5) tra users theo external_id
                                          │ (6) chưa có → tạo hồ sơ nội bộ (JIT)
                                          ▼
                                     AuthenticatedUser
```

Backend **không có** endpoint `/login`, `/register`, `/refresh`. Nếu thấy ai đó thêm vào
thì đó là dấu hiệu ranh giới đã bị phá.

## 3. Just-in-time provisioning

Lần đầu một tài khoản Keycloak gọi API, `ProvisionUserUseCase` tạo bản ghi `users`
tương ứng. Không cần webhook từ Keycloak, không cần đồng bộ nền.

Các lần sau chỉ ghi khi claim thay đổi (`syncFromProvider` trả `true`) — nếu ghi mỗi
request thì mỗi lần gọi API sẽ kèm một lượt UPDATE vô ích.

## 4. Vì sao `external_id` chứ không dùng thẳng `sub` làm khoá chính

`users.id` vẫn là UUID do ta sinh; `sub` của Keycloak nằm ở `users.external_id` (unique).

- Mọi khoá ngoại trong 44 bảng đang trỏ tới `users.id`. Đổi khoá chính đồng nghĩa sửa 20 FK.
- Nếu sau này đổi nhà cung cấp danh tính (hoặc tự làm), chỉ một cột phải xử lý.
- Dữ liệu seed/demo không có tài khoản Keycloak vẫn tồn tại được với `external_id = NULL`
  — những hàng đó đơn giản là không đăng nhập được.

Migration: `codementor-infra/database/postgres/migrations/0014_external_identity.sql`.

## 5. Chạy thử

```bash
docker compose up -d keycloak-db keycloak     # realm được import tự động
# Console: http://localhost:8080  (admin/admin)
```

Realm `codementor` khai báo sẵn hai client:

| Client | Kiểu | Dùng cho |
| --- | --- | --- |
| `codementor-web` | public + PKCE | frontend Next.js |
| `codementor-api` | bearer-only | backend xác minh token |

### Bật đăng nhập social

`identityProviders` trong `keycloak/realm-codementor.json` đang để rỗng — **cố ý**, vì
client secret không được commit. Thêm provider qua Admin Console
(*Identity Providers → Google/GitHub/Facebook*), hoặc điền vào file rồi giữ secret trong
biến môi trường khi import.

Backend **không cần sửa gì** khi thêm provider mới: token vẫn cùng issuer, cùng shape.
Claim `identity_provider` cho biết người dùng đăng nhập bằng đâu nếu cần thống kê.

## 6. Điều đã thay đổi so với thiết kế ban đầu

| Trước | Sau |
| --- | --- |
| Argon2 băm mật khẩu trong backend | Đã gỡ — Keycloak giữ credential |
| `JWT_SECRET` đối xứng, backend tự ký | JWKS RS256, chỉ xác minh |
| `RegisterUserUseCase` + `POST /auth/register` | `ProvisionUserUseCase` chạy ngầm lúc xác thực |
| `users.password_hash` | Đã bỏ ở migration 0014 |

## 7. Việc còn lại

- [ ] Frontend tích hợp OIDC (`next-auth` hoặc `keycloak-js`) với client `codementor-web`
- [ ] Thêm identity provider thật (Google/GitHub) kèm secret qua biến môi trường
- [ ] `RolesGuard` cho các endpoint chỉ dành cho admin
- [ ] Cân nhắc cache kết quả provisioning để bớt một truy vấn mỗi request
