# Usecase: khôi phục nội dung đã gỡ

Kịch bản kiểm thử cho `restore` — đường ra khỏi `archived`, thêm ngày 2026-08-17.
Áp dụng cho cả ba loại nội dung: **lộ trình**, **khóa học**, **bài code**.

## Vì sao có usecase này

`archive` đưa nội dung về `archived`, nhưng `submit()` chỉ nhận
`draft | changes_requested | rejected`. Nội dung đã gỡ không có đường quay lại, và cách duy
nhất đưa nó về là `UPDATE` thẳng vào CSDL — đi vòng qua đúng tầng sinh ra để chặn.

Với `content_status` (khóa học, lộ trình) thì nặng hơn: enum không có `hidden`, nên **tác
giả tự gỡ cũng rơi vào `archived`**. Tác giả tự ẩn nội dung của mình mà không bật lại được
là bẫy, không phải luật.

## Luật

```
published ──(admin gỡ)──► archived ──(admin khôi phục)──► draft
                                                            │
                                    (tác giả gửi duyệt)─────┘
                                              ▼
                                       pending_review ──(admin duyệt)──► published
```

Ba điều cần đúng:

1. **`restore` về `draft`, không thẳng về `published`.** Nội dung bị gỡ thường vì có vấn
   đề; trả thẳng ra catalog là cửa sau vòng qua người kiểm duyệt.
2. **`published_at` không đổi.** Gỡ rồi đăng lại không phải lần phát hành mới.
3. **Chỉ admin.** `moderate` là `@Roles('admin')`, và admin là người đã gỡ. Đường của tác
   giả sẽ là `hidden` — trạng thái đó vẫn chưa có code, xem phần cuối.

## Cách chạy

Cần: Kong ở `:8000`, learning-service `:3002`, exercise-service `:3003`.
Tài khoản: `lecturer1@test.local`, `admin1@test.local`, mật khẩu `Test1234!`.

```bash
cd codementor-frontend && set -a && . ./apps/client/.env.local && set +a
K="$KEYCLOAK_INTERNAL_URL/realms/$KEYCLOAK_REALM/protocol/openid-connect/token"
tok() { curl -s -X POST "$K" -d grant_type=password \
  -d client_id="$KEYCLOAK_BFF_CLIENT_ID" --data-urlencode client_secret="$KEYCLOAK_BFF_CLIENT_SECRET" \
  -d username="$1" -d password='Test1234!' -d scope=openid \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])"; }

LEC=$(tok lecturer1@test.local); ADM=$(tok admin1@test.local)
G=http://localhost:8000/api/v1

# Đổi `roadmaps` thành `courses` hoặc `exercises` để kiểm hai loại còn lại.
ID=$(curl -s -H "Authorization: Bearer $LEC" "$G/roadmaps/mine?limit=50" \
  | python3 -c "import sys,json;[print(i['id']) for i in json.load(sys.stdin)['data']['items'] if i['slug']=='lo-trinh-frontend']")

status() { curl -s -H "Authorization: Bearer $LEC" "$G/roadmaps/$ID" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['status'])"; }
```

## Các bước và kết quả mong đợi

| # | Việc | Lệnh | Mong đợi |
|---|---|---|---|
| 1 | Trạng thái ban đầu | `status` | `published` |
| 2 | Admin gỡ | `POST /roadmaps/$ID/moderate {"decision":"archive"}` | `201`, status `archived` |
| 3 | Biến mất khỏi catalog | `GET /roadmaps` | không còn trong danh sách |
| 4 | **Tác giả gửi duyệt từ archived** | `POST /roadmaps/$ID/submit` | **422** — *"Không gửi duyệt được từ trạng thái archived"* |
| 5 | **Lecturer gọi restore** | `POST .../moderate {"decision":"restore"}` với token lecturer | **403** |
| 6 | Admin khôi phục | `POST .../moderate {"decision":"restore"}` | `201`, status **`draft`** (không phải `published`) |
| 7 | Khôi phục lần hai | lặp bước 6 | **422** — chỉ khôi phục được nội dung đã gỡ |
| 8 | Gửi duyệt lại | `POST /roadmaps/$ID/submit` | `201`, status `pending_review` |
| 9 | Admin duyệt | `POST .../moderate {"decision":"approve"}` | `201`, status `published` |
| 10 | **Ngày phát hành** | `SELECT published_at FROM roadmaps WHERE slug=...` | **không đổi** so với bước 1 |

Bước 4, 5, 7 và 10 là phần dễ hỏng nhất — chúng kiểm rằng `restore` không trở thành cửa
sau, và rằng lần phát hành đầu tiên vẫn là lần phát hành đầu tiên.

## Đã kiểm tới đâu

- **Lộ trình**: chạy đủ 10 bước trên stack thật, tất cả khớp.
- **Khóa học và bài code**: kiểm bằng spec ở tầng domain
  (`roadmap.spec.ts`, `course.spec.ts`, `exercise.spec.ts` — mục *"gỡ và khôi phục"*).
  Chưa chạy tay qua HTTP; đường đi giống hệt vì cùng một máy trạng thái.

```bash
cd codementor-backend && npx jest --testPathPatterns="(course|exercise|roadmap).spec"
```

## Chưa làm, cố ý

**Không có nút trên giao diện admin.** Màn hình kiểm duyệt chỉ liệt kê hàng chờ
(`pending_review`), còn nội dung `archived` không nằm ở đó. Muốn có nút thì phải liệt kê
được nội dung đã gỡ trước, mà hiện không endpoint nào làm được: `GET /…` khoá cứng
`publishedOnly`, `GET /…/moderation` khoá cứng `pendingOnly`. Cần thêm một hàng chờ
"đã gỡ" — việc riêng, không gộp vào bản vá này.

**`hidden` vẫn chưa tồn tại trong code.** Nó có trong enum `exercise_status` và trong sơ đồ
ở `codementor-content-model.md` §8.1, nhưng không service nào đặt được giá trị đó, và
`content_status` của khóa học/lộ trình còn không có nó. Đó là lý do tác giả tự gỡ hiện phải
đi qua `archived`. Lấp khoảng trống đó là một usecase khác.
