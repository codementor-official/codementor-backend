---
excerpt: Phần lớn truy vấn chậm không sửa được bằng index, vì gốc rễ nằm ở cách bảng được thiết kế. Vài quyết định ở ngày đầu tiết kiệm nhiều tháng chữa cháy.
takeaway: Ràng buộc đặt ở cơ sở dữ liệu thì không có đường vòng nào lách qua được. Thiết kế đúng trước, tối ưu sau.
---
Truy vấn chậm hay được chữa bằng cách thêm index. Nhiều lần có tác dụng. Nhưng nếu phải thêm index thứ năm cho cùng một bảng, vấn đề thường không nằm ở index — nó nằm ở chỗ bảng đó đang gánh nhiều việc hơn một bảng nên gánh. Bài này đi qua những quyết định thiết kế nên làm trước khi viết câu `SELECT` đầu tiên.

## Bắt đầu từ câu hỏi nghiệp vụ, không phải từ màn hình

Thiết kế theo màn hình ("trang đơn hàng cần những cột gì") cho ra những bảng phẳng, trùng lặp, gắn chặt với giao diện hôm nay. Thiết kế theo nghiệp vụ hỏi: có những thực thể nào, quan hệ giữa chúng là một-một, một-nhiều hay nhiều-nhiều, và điều gì luôn phải đúng?

Ví dụ một cửa hàng nhỏ: một người dùng có nhiều đơn hàng, một đơn hàng có nhiều dòng sản phẩm, một sản phẩm xuất hiện trong nhiều đơn. Ba câu đó đã quyết định gần hết cấu trúc:

```sql
CREATE TABLE users (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id),
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'paid', 'cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  order_id    bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  bigint NOT NULL REFERENCES products(id),
  quantity    integer NOT NULL CHECK (quantity > 0),
  unit_price  integer NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (order_id, product_id)
);
```

Để ý `unit_price` nằm ở `order_items` chứ không chỉ ở `products`: giá sản phẩm sẽ đổi, nhưng đơn đã đặt phải giữ giá lúc đặt. Đây là loại quyết định chỉ thấy được khi nghĩ về nghiệp vụ.

## Ràng buộc thuộc về cơ sở dữ liệu

Khóa ngoại, `NOT NULL`, `UNIQUE`, `CHECK` — đặt được ở tầng dữ liệu thì đặt ở đó. Kiểm tra trong mã ứng dụng chỉ có tác dụng với đường đi qua đúng đoạn mã ấy; còn seed script, migration chạy tay, một service khác viết sau này thì không.

Dữ liệu sống lâu hơn mã. Một ràng buộc trong cơ sở dữ liệu vẫn còn hiệu lực sau khi tầng ứng dụng đã viết lại lần thứ ba. Và ràng buộc còn là tài liệu: đọc `CHECK (quantity > 0)` là biết ngay quy tắc, không cần tìm trong mã.

Hai ràng buộc người mới hay quên:

- `UNIQUE` cho cặp cột có ý nghĩa nghiệp vụ, ví dụ một người chỉ đánh giá một khoá học một lần: `UNIQUE (user_id, course_id)`. Thiếu nó, hai request gửi cùng lúc sẽ tạo hai đánh giá.
- Khóa ngoại kèm hành vi khi xoá: `ON DELETE CASCADE` cho dữ liệu phụ thuộc hoàn toàn, mặc định (chặn xoá) cho dữ liệu cần giữ lịch sử.

## Chọn kiểu dữ liệu đúng

- Tiền: số nguyên theo đơn vị nhỏ nhất (đồng, xu) hoặc `numeric`. Không bao giờ dùng `float` — `0.1 + 0.2` không bằng `0.3`.
- Thời gian: `timestamptz`, không phải `timestamp`. Lưu thời điểm tuyệt đối, đổi múi giờ khi hiển thị.
- Trạng thái: `text` kèm `CHECK` hoặc kiểu `enum`, thay vì số nguyên bí ẩn `status = 3`.
- Định danh: `bigint` tự tăng hoặc `uuid`. `integer` hết chỗ ở khoảng 2,1 tỉ — nghe xa nhưng bảng log hay sự kiện chạm tới rất nhanh.

## Chuẩn hóa tới đâu

Bắt đầu ở chuẩn hóa, chỉ phi chuẩn hóa khi đo được là cần. Ngược lại rất khó sửa: dữ liệu trùng lặp sẽ lệch nhau, và lúc phát hiện ra thì không còn biết bản nào đúng.

Ngoại lệ hợp lý nhất là các cột đếm — số lượt ghi danh, số thành viên. Chúng được đọc liên tục và đếm lại mỗi lần thì tốn; nhưng phải có một đường rõ ràng để dựng lại từ dữ liệu gốc khi lệch:

```sql
UPDATE courses c
SET enrollment_count = (SELECT count(*) FROM enrollments e WHERE e.course_id = c.id);
```

Viết sẵn câu lệnh này ngay khi tạo cột đếm. Ngày nó lệch, bạn sẽ cần nó.

## Nghĩ trước về index cho khóa ngoại

PostgreSQL tự tạo index cho khoá chính và `UNIQUE`, nhưng **không** tự tạo cho khóa ngoại. Cột `orders.user_id` mà không có index thì mỗi lần lấy đơn của một người dùng là một lần quét bảng, và mỗi lần xoá người dùng là một lần quét `orders` để kiểm tra ràng buộc.

```sql
CREATE INDEX idx_orders_user ON orders (user_id, created_at DESC);
```

## Kiểm bằng dữ liệu thật

Truy vấn nào cũng nhanh trên một trăm dòng. Ba thứ chỉ lộ ra ở quy mô thật: quét toàn bảng, join nhân bản số dòng, và index không được dùng vì kiểu dữ liệu hai bên khác nhau. Sinh dữ liệu thử đủ lớn bằng `generate_series`:

```sql
INSERT INTO orders (user_id, status, created_at)
SELECT (random() * 10000)::int + 1, 'paid', now() - (random() * interval '365 days')
FROM generate_series(1, 1000000);
```

`EXPLAIN ANALYZE` trên dữ liệu như vậy là cách rẻ nhất để thấy cả ba vấn đề, và rẻ hơn nhiều so với phát hiện chúng lúc đang có sự cố.

## Checklist thiết kế một bảng mới

- Mỗi bảng mô tả một thực thể; tên cột nói đúng nghĩa nghiệp vụ.
- Khoá chính rõ ràng; khoá ngoại có index.
- `NOT NULL` là mặc định, chỉ bỏ khi giá trị thật sự có thể không có.
- `UNIQUE` và `CHECK` cho mọi quy tắc "luôn phải đúng".
- Kiểu dữ liệu đúng cho tiền và thời gian.
- Cột phi chuẩn hóa nào cũng có câu lệnh dựng lại.

## Tóm tắt

Thiết kế bảng là quyết định khó đổi nhất trong một hệ thống, nên đáng dành thời gian nhất. Bắt đầu từ nghiệp vụ, để cơ sở dữ liệu giữ các quy tắc, chọn kiểu dữ liệu cẩn thận, và kiểm bằng dữ liệu có quy mô thật. Index giúp truy vấn nhanh hơn — nhưng chỉ khi bảng bên dưới đã được thiết kế đúng.
