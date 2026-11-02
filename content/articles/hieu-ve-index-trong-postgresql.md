---
excerpt: Index không phải phép màu. Hiểu nó hoạt động thế nào thì biết luôn khi nào nó giúp, khi nào nó vô dụng và khi nào nó làm hệ thống chậm đi.
takeaway: Index tăng tốc đọc và làm chậm ghi. Mỗi index phải trả lời được nó phục vụ truy vấn nào — và EXPLAIN ANALYZE là cách duy nhất để biết chắc.
---
Cách hiểu index dễ nhất là nghĩ về mục lục cuối sách. Muốn tìm chữ "đệ quy" xuất hiện ở đâu, bạn không lật từng trang — bạn tra mục lục, nó chỉ tới trang 47. Cơ sở dữ liệu làm đúng vậy: thay vì đọc từng dòng của bảng (*sequential scan*), nó tra một cấu trúc phụ đã sắp sẵn để đi thẳng tới những dòng cần.

Và cũng như mục lục, nó có giá. Mỗi lần thêm một trang mới vào sách, mục lục phải cập nhật theo. Với cơ sở dữ liệu, mỗi `INSERT`, `UPDATE` hay `DELETE` trên cột có index đều phải ghi thêm vào index đó, và index chiếm thêm dung lượng đĩa lẫn bộ nhớ đệm. Bài này giúp bạn biết khi nào cái giá đó đáng trả.

## Một ví dụ để đo

Giả sử bảng `orders` có vài triệu dòng và màn hình "Đơn hàng của tôi" chạy truy vấn sau:

```sql
SELECT id, total, created_at
FROM orders
WHERE user_id = 42
ORDER BY created_at DESC
LIMIT 20;
```

Chưa có index, PostgreSQL phải đọc toàn bộ bảng, lọc ra đơn của người dùng 42, sắp xếp rồi mới lấy 20 dòng đầu. Xem kế hoạch thật bằng `EXPLAIN ANALYZE`:

```sql
EXPLAIN ANALYZE
SELECT id, total, created_at FROM orders
WHERE user_id = 42 ORDER BY created_at DESC LIMIT 20;
-- Limit  (actual time=1180.4..1180.5 rows=20)
--   ->  Sort  (actual time=1180.4..1180.4 rows=20)
--         ->  Seq Scan on orders  (actual time=0.03..1175.9 rows=318)
```

Thêm một index phù hợp rồi chạy lại:

```sql
CREATE INDEX idx_orders_user_created ON orders (user_id, created_at DESC);
-- Limit  (actual time=0.05..0.09 rows=20)
--   ->  Index Scan using idx_orders_user_created on orders
```

Từ hơn một giây xuống dưới một phần mười mili giây — và để ý là bước `Sort` đã biến mất, vì đọc index theo thứ tự là đã có sẵn kết quả sắp xếp.

## B-tree, loại index bạn dùng 90% thời gian

Mặc định của PostgreSQL là B-tree, giữ khoá theo thứ tự đã sắp. Nhờ thứ tự đó nó phục vụ được nhiều hơn một kiểu truy vấn:

- So sánh bằng: `WHERE email = $1`.
- So sánh lớn/nhỏ và khoảng giá trị: `WHERE created_at >= now() - interval '7 days'`.
- Sắp xếp: `ORDER BY created_at DESC` khi thứ tự khớp với index.
- Tiền tố chuỗi: `WHERE slug LIKE 'react%'` (với collation `C` hoặc toán tử `text_pattern_ops`).

Các loại khác có việc riêng: GIN cho mảng, JSONB và tìm kiếm toàn văn; GiST cho dữ liệu không gian và khoảng; BRIN cho bảng rất lớn mà dữ liệu được ghi theo thứ tự thời gian. Người mới nên thành thạo B-tree trước — nó giải quyết gần hết bài toán hằng ngày.

## Ba lý do index bị bỏ qua

Bạn đã tạo index mà `EXPLAIN` vẫn báo `Seq Scan`? Gần như luôn là một trong ba lý do sau.

**Kiểu dữ liệu hai bên khác nhau.** Cột `varchar` so với tham số kiểu số buộc PostgreSQL ép kiểu từng dòng, và một cột đã bị ép kiểu thì index trên cột đó không dùng được nữa. Hãy truyền tham số đúng kiểu với cột.

**Hàm bọc quanh cột.** `WHERE lower(email) = $1` không dùng được index trên `email`. Cần một index trên chính biểu thức đó:

```sql
CREATE INDEX idx_users_email_lower ON users (lower(email));
```

**Truy vấn lấy quá nhiều dòng.** Cần 80% số dòng của bảng thì quét tuần tự nhanh hơn đi vòng qua index rồi quay lại bảng cho từng dòng. Bộ tối ưu biết điều này và cố tình bỏ qua index — đó là quyết định đúng, không phải lỗi.

## Index tổ hợp và thứ tự cột

Index trên `(user_id, created_at)` phục vụ được truy vấn lọc theo `user_id`, và cả lọc theo `user_id` rồi sắp theo `created_at`. Nhưng truy vấn chỉ lọc theo `created_at` thì không — giống như danh bạ sắp theo họ rồi mới tới tên: tra theo tên thì vô dụng.

Quy tắc thực dụng: cột dùng để so sánh bằng đứng trước, cột dùng cho khoảng giá trị và sắp xếp đứng sau. Và đừng tạo thêm index trên `(user_id)` khi đã có `(user_id, created_at)` — index tổ hợp đã phục vụ luôn trường hợp đó.

## Hai kỹ thuật đáng biết sớm

**Index một phần (partial index).** Nếu màn hình chỉ quan tâm đơn chưa thanh toán, đừng index cả bảng:

```sql
CREATE INDEX idx_orders_pending ON orders (created_at) WHERE status = 'pending';
```

Index nhỏ hơn nhiều, ghi nhanh hơn, và vừa khít với truy vấn có cùng điều kiện `WHERE`.

**Index bao phủ (covering index).** Khi index chứa đủ mọi cột truy vấn cần, PostgreSQL có thể trả lời chỉ từ index (*index-only scan*) mà không chạm vào bảng:

```sql
CREATE INDEX idx_orders_user_cover ON orders (user_id, created_at DESC) INCLUDE (total);
```

## Cái giá của index

Mỗi index làm chậm ghi và chiếm chỗ. Một bảng nhận nhiều ghi mà mang tám index thì mỗi `INSERT` thực chất là chín lần ghi. Định kỳ kiểm tra index nào không được dùng:

```sql
SELECT relname AS table_name, indexrelname AS index_name, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY relname;
```

Index có `idx_scan = 0` sau một thời gian chạy thật là ứng viên để xoá (trừ index phục vụ ràng buộc `UNIQUE` hay khoá chính). Trên bảng đang phục vụ người dùng, tạo index bằng `CREATE INDEX CONCURRENTLY` để không khoá việc ghi.

## Cách kiểm tra, không phải cách đoán

`EXPLAIN ANALYZE` trước mỗi truy vấn đáng quan tâm. Thấy `Seq Scan` trên bảng lớn là dấu hiệu đáng xem lại; thấy `Index Scan` hay `Index Only Scan` là index đang có tác dụng. Con số `rows` mà bộ tối ưu ước lượng lệch xa thực tế thường có nghĩa thống kê đã cũ — chạy `ANALYZE ten_bang`.

## Checklist trước khi thêm một index

- Truy vấn nào sẽ dùng nó? Viết truy vấn đó ra và chạy `EXPLAIN ANALYZE` trước và sau.
- Thứ tự cột đã đúng chưa: so sánh bằng trước, khoảng giá trị và sắp xếp sau.
- Đã có index nào bao trùm trường hợp này chưa?
- Bảng nhận nhiều ghi không? Nếu có, cái giá ghi có chấp nhận được không?
- Trên production, tạo bằng `CONCURRENTLY`.

## Tóm tắt

Index là mục lục: tra cứu nhanh hơn, đổi lại mỗi lần ghi chậm đi một chút. B-tree giải quyết phần lớn nhu cầu, thứ tự cột trong index tổ hợp quan trọng ngang việc có index hay không, và ba lý do kinh điển khiến index bị bỏ qua là lệch kiểu, hàm bọc cột và lấy quá nhiều dòng. Đo bằng `EXPLAIN ANALYZE`, đừng đoán.
