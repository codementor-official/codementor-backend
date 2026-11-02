---
excerpt: Thêm biểu đồ không làm sự cố ngắn đi. Log có cấu trúc, một id xuyên suốt request và mức log dùng đúng nghĩa mới giúp trả lời câu hỏi "vì sao".
takeaway: Một request phải truy được từ đầu tới cuối bằng một id duy nhất. Dashboard cho biết khi nào có chuyện, log cho biết vì sao.
---
Khi hệ thống có sự cố, phản xạ thường thấy là dựng thêm dashboard. Biểu đồ cho biết có chuyện xảy ra và xảy ra lúc nào — nhưng gần như không bao giờ cho biết vì sao. Câu trả lời nằm trong log, và log chỉ dùng được nếu đã chuẩn bị từ trước. Bài này đi qua bốn việc nên làm với log trước khi nghĩ tới biểu đồ.

## 1. Log có cấu trúc

Log dạng câu văn ghép chuỗi thì chỉ đọc được bằng mắt:

```text
2026-11-02 10:41:07 ERROR Payment failed for user 1842 order 99231 after 2304ms
```

Log dạng JSON có trường rõ ràng thì lọc được, đếm được, gom nhóm được:

```json
{"time":"2026-11-02T10:41:07Z","level":"error","msg":"payment failed",
 "userId":1842,"orderId":99231,"provider":"vnpay","durationMs":2304,
 "traceId":"7f3a9c2e"}
```

Khác biệt lộ ra đúng lúc ba giờ sáng, khi cần trả lời "lỗi này xảy ra với bao nhiêu người dùng, từ cổng thanh toán nào" mà không phải viết một biểu thức chính quy. Hầu hết thư viện log hiện đại (pino cho Node.js, Logback với encoder JSON cho Java, structlog cho Python) xuất JSON chỉ với một dòng cấu hình.

Quy tắc khi viết: `msg` là một câu cố định, giá trị thay đổi nằm ở trường riêng. Nhờ vậy gom nhóm theo `msg` cho ra đúng số lần lỗi đó xảy ra.

## 2. Một id đi hết vòng đời request

Đây là thứ đáng làm sớm nhất. Sinh một id ở cửa ngõ (gateway hoặc service đầu tiên), gắn vào mọi log của mọi service mà request đó đi qua, chuyển tiếp qua header, và trả nó về trong phản hồi lỗi:

```javascript
app.use((req, res, next) => {
  req.id = req.headers["x-request-id"] ?? crypto.randomUUID();
  res.setHeader("x-request-id", req.id);
  req.log = logger.child({ requestId: req.id });
  next();
});
```

Người dùng báo lỗi kèm id hiện trên màn hình lỗi, bạn lọc đúng id đó và thấy toàn bộ đường đi qua các service. Không có nó, mỗi lần điều tra là một lần ghép thủ công theo mốc thời gian giữa nhiều service — vừa chậm vừa hay ghép nhầm khi tải cao. Khi hệ thống lớn hơn, chuẩn OpenTelemetry làm việc này một cách đầy đủ với `traceId` và `spanId`.

## 3. Mức log dùng đúng nghĩa

- **ERROR** — cần người xử lý: thanh toán thất bại do hệ thống, mất kết nối cơ sở dữ liệu.
- **WARN** — bất thường nhưng hệ thống tự xoay xở được: thử lại thành công, dùng giá trị dự phòng.
- **INFO** — sự kiện nghiệp vụ đáng ghi: đơn được tạo, người dùng đăng nhập.
- **DEBUG** — chi tiết để phát triển, tắt trên production.

Một request hỏng vì người dùng nhập sai không phải ERROR — nó là chuyện bình thường, đáng ở mức INFO hoặc WARN. Đánh nhầm mức khiến cảnh báo kêu suốt, và cảnh báo kêu suốt thì chẳng ai nhìn nữa.

Thước đo đơn giản: **nếu thấy một dòng ERROR mà bạn không định làm gì cả, nó không phải ERROR.**

## 4. Ghi đủ ngữ cảnh, không ghi bí mật

Một dòng log tốt trả lời được: ai (`userId`), làm gì (`route`, `action`), với cái gì (`orderId`), kết quả ra sao (`status`, `durationMs`), và nếu lỗi thì lỗi gì (`error.message`, `error.stack`).

Đồng thời, log thường được giữ lâu và nhiều người đọc được. Không bao giờ ghi:

- Mật khẩu, token, khoá API, cookie phiên.
- Số thẻ, số tài khoản ngân hàng.
- Dữ liệu cá nhân nhạy cảm mà không cần thiết.

Cấu hình che (redact) ở tầng thư viện log để không phụ thuộc vào trí nhớ của từng người:

```javascript
const logger = pino({ redact: ["req.headers.authorization", "*.password", "*.token"] });
```

## Rồi mới tới dashboard

Khi log đã có cấu trúc, dashboard trở nên có ích thật: số lỗi theo `msg`, độ trễ theo `route` (p50, p95, p99), tỉ lệ lỗi theo `provider`. Mỗi biểu đồ nên dẫn tới log tương ứng chỉ bằng một cú bấm — thấy đường đỏ vọt lên, bấm vào, đọc đúng những dòng log của khoảng thời gian đó.

Và mỗi cảnh báo nên kèm một câu "cần làm gì khi nhận được". Cảnh báo không có hành động đi kèm là tiếng ồn.

## Checklist

- Log xuất JSON, `msg` cố định, giá trị ở trường riêng.
- Mọi request có `requestId`, truyền qua mọi service, trả về trong phản hồi lỗi.
- Mức log dùng đúng nghĩa; ERROR nghĩa là có người phải làm gì đó.
- Bí mật và dữ liệu nhạy cảm được che tự động.
- Dashboard dẫn tới log; cảnh báo kèm hướng xử lý.

## Tóm tắt

Dashboard cho biết khi nào có chuyện; log cho biết vì sao. Đầu tư vào log có cấu trúc, một id xuyên suốt request và mức log đúng nghĩa trước — rồi dashboard dựng trên nền đó mới thật sự rút ngắn thời gian xử lý sự cố.
