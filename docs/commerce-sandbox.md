# Khóa học trả phí — bản thử nghiệm

Không chuyển tiền thật. Các thao tác thương mại bị chặn khi `NODE_ENV=production`.
Không triển khai migration hoặc thay đổi IAM/S3 trên production trong đợt triển khai này.

## Kiến trúc

- Learning Service sở hữu context `commerce`, API `/api/v1/commerce`, transaction PostgreSQL và job kiểm tra mỗi phút.
- Giá, người hưởng doanh thu, tỷ lệ chia và thời gian giữ tiền được chụp lại khi tạo đơn. VND dùng số nguyên; phần giảng viên làm tròn xuống, phần hệ thống nhận phần còn lại.
- `course_access_grants` phân biệt legacy/free/purchase/manual. Migration giữ quyền của enrollment hiện có. Hoàn tiền chỉ thu hồi grant của đơn tương ứng.
- Journal và entries cân đối, bất biến bằng trigger database. Số dư tính từ ledger; advisory lock bảo vệ ví và checkout, unique constraint bảo vệ idempotency.
- Thanh toán thành công, quyền học, doanh thu và notification outbox được ghi cùng transaction. Notification Service nhận `COMMERCE_UPDATED`.
- Adapter thu tiền VNPAY/MoMo độc lập với MockPayoutAdapter. Không dùng API hoàn tiền làm API rút tiền.
- Timeout giữ tiền; chỉ giải phóng sau thất bại chắc chắn. Callback trùng không ghi thêm doanh thu/chi trả. Thanh toán thành công đến muộn hoặc trùng quyền sở hữu chuyển `review`, không cấp quyền lần nữa.
- Hoàn tiền sau chi trả tạo khoản debt; thu nhập tương lai bù debt trước khi khả dụng. Không sửa lịch sử chi trả.

## Cấu hình và migration

1. Dùng database local hoặc database sandbox riêng. Không dùng database ứng dụng đã deploy để thử.
2. Thêm các biến từ `.env.commerce.example` vào môi trường local; mặc định `COMMERCE_MODE=mock`, không cần credential.
3. Áp dụng baseline migration của infra theo hướng dẫn repository, sau đó lần lượt các migration commerce từ `database/postgres/migrations/0032_course_commerce.sql` đến `0035_course_promotion_approval.sql`.
4. Runner tùy chọn: đặt `DATABASE_URL` trong môi trường shell rồi chạy `node scripts/migrate-commerce.mjs`. Runner không tự đọc `.env`, cần `psql` trên PATH, từ chối remote mặc định và production; các migration đã có bảng đích sẽ được bỏ qua an toàn.
5. Áp dụng schema notification Mongo theo cơ chế migration hiện có (`scripts/migrate-notification-schema.mjs`), gồm enum `COMMERCE_UPDATED`.
6. Khởi động Learning Service, Notification Service, outbox/infra và frontend như bình thường. Gateway phải có route commerce mới.

Trước khi áp dụng trên EC2: tạo snapshot PostgreSQL, xác nhận database đích chưa có bảng
`commerce_orders`, chạy thử hai migration trên bản sao schema, sau đó mới mở maintenance window.
Không chạy runner local với `--allow-remote-sandbox` vào database production.

Lưu ý baseline infra hiện có migration workspace phụ thuộc cột do script migrate-workspace-content tạo; không áp dụng mù toàn bộ chuỗi vào database trống. Kiểm thử commerce sử dụng baseline tương thích và migration 0030 trên PostgreSQL local riêng.

## Demo mock từ mua đến rút

Chạy `scripts/seed-commerce-demo.sql` trên đúng database local `commerce_test` để tạo ba
khóa 99.000đ, 199.000đ và 349.000đ. Script chạy lặp lại an toàn; nếu đã có
`lecturer1@test.local` thì các khóa được gắn vào tài khoản đó để kiểm tra trực tiếp danh
sách học viên và doanh thu trên Lecturer, nếu chưa có thì dùng giảng viên demo nội bộ.

1. Admin mở `/commerce`, tab Chính sách: để demo ngay có thể đặt thời gian giữ bằng 0 ngày **trước khi tạo đơn**. Mặc định thực tế thử nghiệm là 7 ngày, chia 80/20, rút tối thiểu 100.000đ và cần duyệt.
2. Giảng viên đặt giá 200.000đ trong studio của khóa nháp rồi gửi duyệt theo luồng hiện có. Admin duyệt khóa.
3. Học viên khác mở khóa, bấm mua, tới `/purchases/[orderId]`, chọn kết quả mock thành công. Kiểm tra quyền học và lịch sử `/purchases`.
4. Admin chạy job thử nghiệm hoặc chờ job. Thu nhập giảng viên 160.000đ chuyển từ chờ sang khả dụng khi đủ điều kiện. Phần hệ thống 40.000đ không bao gồm tiền phải trả giảng viên.
5. Giảng viên mở `/earnings`, lưu người nhận thử nghiệm với mã `TEST-DEMO`, tạo yêu cầu rút 100.000đ. Chọn success/failure/pending/timeout để kiểm tra.
6. Admin duyệt tại `/commerce`; job thực hiện mock payout. Với pending/timeout, tiền vẫn giữ; admin dùng điều khiển kết quả mock để kết thúc. Thử callback lặp không làm thay đổi số dư lần hai.
7. Admin mở chi tiết đơn và hoàn toàn bộ, nhập lý do. Kiểm tra quyền học, bút toán bù trừ và debt nếu tiền đã chi trả.

Các màn Client/Lecturer/Admin đã có ảnh bìa (kèm fallback), tìm kiếm, lọc, sắp xếp,
phân trang dùng chung, xuất CSV và modal chi tiết. Lecturer có thể thiết lập ngân hàng,
MoMo hoặc VNPAY; số tài khoản chỉ hiển thị bốn số cuối ngoài form chỉnh sửa.

Không có quyền học từ return URL. Frontend luôn đọc kết quả backend.

## Sandbox nhà cung cấp

Chỉ phương thức đủ cấu hình mới hiện. Đặt `COMMERCE_MODE=sandbox`, URL client local và HTTPS tunnel tới gateway local trong `COMMERCE_PUBLIC_API_URL` (kèm `/api/v1`).

- VNPAY cần `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`; IPN GET `/api/v1/commerce/webhooks/vnpay`.
- MoMo cần `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY`; IPN POST `/api/v1/commerce/webhooks/momo`.
- Hoàn tiền sandbox chỉ bật với `COMMERCE_SANDBOX_REFUNDS=true` khi tài khoản đối tác có quyền tương ứng.
- Chỉ gọi endpoint sandbox cố định. Chưa kiểm thử kết nối merchant thật do không có credential sandbox; mock không chứng minh cấu hình nhà cung cấp hoạt động.

Nguồn chính thức dùng xây adapter: [VNPAY thanh toán](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html), [VNPAY truy vấn/hoàn tiền](https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr%26refund.html), [MoMo thanh toán](https://developers.momo.vn/v3/vi/docs/payment/api/wallet/onetime/), [MoMo truy vấn](https://developers.momo.vn/v3/vi/docs/payment/api/payment-api/query/), [MoMo hoàn tiền](https://developers.momo.vn/v3/docs/payment/api/payment-api/refund/).

## Kiểm thử

`COMMERCE_TEST_DATABASE_URL` chỉ chấp nhận database `commerce_test` trên localhost; không fallback DATABASE_URL. Sau khi tạo schema local, chạy:

```powershell
$env:COMMERCE_TEST_DATABASE_URL='postgresql://commerce_test@127.0.0.1:55439/commerce_test'
npx jest --runInBand --testPathPatterns=commerce.integration
npx tsc --noEmit --incremental false
npm run lint
npm run build:all
```

Frontend: `pnpm lint`, `pnpm typecheck`, `pnpm build`.
HTTP E2E dùng controller, RolesGuard, validation và transaction PostgreSQL thật; chỉ identity boundary được stub trong module kiểm thử. Đây không phải kiểm thử đăng nhập Keycloak hoặc browser.

## Giới hạn trước vận hành tiền thật

- Chưa có payout thật, partial refund, retry refund đã thất bại cuối cùng, subscription hoặc kế toán thuế.
- Nếu ví còn payout giữ tiền, yêu cầu hoàn tiền bị chặn cho tới khi đối soát payout; không tự thu hồi một payout chưa rõ kết quả.
- Phí nhà cung cấp chưa xác định được hiển thị là chưa xác định; không coi ledger clearing là số dư ngân hàng. Dashboard đối soát là kiểm tra trạng thái và ledger nội bộ, chưa đối soát sao kê ngoài hệ thống.
- Sandbox merchant, IPN tunnel, trường hợp trả lỗi thực tế và quyền hoàn tiền cần kiểm thử với đối tác trước phát hành.
- Video trả phí phải nằm trong prefix private, anonymous GET bị chặn; chỉ đặt `COMMERCE_PRIVATE_MEDIA_READY=true` sau khi xác minh bucket/CDN. Không tự thay đổi IAM. Nội dung public đã phát hành trước đây không thể được bảo mật chỉ bằng ẩn nút; cần chuyển nguồn tài nguyên public sang private và rà soát liên kết nhúng.
- Đã kiểm thử browser local có session cho ba vai trò với database commerce cô lập. Trước production vẫn cần smoke test lại trên bản sao dữ liệu EC2 và credential sandbox của nhà cung cấp.
