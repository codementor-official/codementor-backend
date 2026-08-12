# End-to-end test

Chưa có test nào ở đây. Cấu hình đã sẵn sàng cho khi bắt đầu viết:

```bash
npm run test:e2e
```

Đặt file `*.e2e-spec.ts` trong thư mục này hoặc cạnh service trong `apps/`.

E2E cần hạ tầng thật đang chạy (PostgreSQL, MongoDB, Kafka, Keycloak) — xem README ở gốc repo.
Hai luồng đáng viết trước:

1. **Xác thực + provisioning**: token Keycloak hợp lệ → `GET /api/v1/me` tạo hồ sơ nội bộ lần đầu,
   lần thứ hai không sinh thêm bản ghi.
2. **Nộp bài**: `cmd.judge.run` được ghi vào outbox trong cùng transaction với `submissions`,
   poller đẩy lên Kafka, consumer xử lý đúng một lần dù message được giao lại.
