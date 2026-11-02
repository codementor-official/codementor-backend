---
excerpt: Bốn nguyên nhân giải thích gần hết các truy vấn chậm gặp trong dự án thật — và cả bốn đều nhìn ra được bằng một lệnh EXPLAIN ANALYZE.
takeaway: Đo trước khi sửa. EXPLAIN ANALYZE trả lời được câu hỏi mà đọc mã không trả lời nổi.
---
Truy vấn chậm hiếm khi chậm vì lý do lạ. Bốn nguyên nhân dưới đây giải thích gần hết những gì người mới gặp trong dự án thật, và cả bốn đều nhìn ra được bằng một lệnh. Bài này đi qua từng nguyên nhân với ví dụ cụ thể, cách nhận ra và cách sửa.

## Bắt đầu bằng EXPLAIN ANALYZE

`EXPLAIN` cho biết kế hoạch bộ tối ưu định chạy. Thêm `ANALYZE` thì nó chạy thật và báo lại thời gian từng bước cùng số dòng thực tế. Thêm `BUFFERS` để biết mỗi bước đọc bao nhiêu trang dữ liệu:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT a.id, a.title, u.display_name
FROM articles a JOIN users u ON u.id = a.author_id
WHERE a.status = 'published'
ORDER BY a.published_at DESC
LIMIT 20;
```

Thứ đáng nhìn đầu tiên không phải tổng thời gian, mà là chỗ **ước lượng lệch xa thực tế** nhất: dòng có `rows=10` trong kế hoạch nhưng `actual rows=50000`. Bộ tối ưu chọn kế hoạch dựa trên ước lượng; ước lượng sai thì kế hoạch sai, và mọi thứ sau đó đều sai theo. Thống kê cũ là nguyên nhân hay gặp — chạy `ANALYZE ten_bang` rồi đo lại.

> Lưu ý: `EXPLAIN ANALYZE` chạy thật câu lệnh. Với `UPDATE` hay `DELETE`, hãy bọc trong `BEGIN; … ROLLBACK;`.

## 1. Vấn đề N+1

Lấy 100 bài viết rồi lặp qua từng bài để lấy tác giả là 101 lượt đi lại cơ sở dữ liệu:

```javascript
const articles = await db.query('SELECT * FROM articles LIMIT 100');
for (const article of articles) {
  // 100 truy vấn nữa, mỗi truy vấn một lượt mạng
  article.author = await db.query('SELECT * FROM users WHERE id = $1', [article.author_id]);
}
```

Mỗi lượt chỉ vài mili giây nên trên máy cá nhân không ai thấy gì; qua mạng thật, với độ trễ 2–5 ms mỗi lượt, thành vài trăm mili giây. Cách nhận ra: log truy vấn cho thấy cùng một câu SQL lặp lại hàng chục lần với tham số khác nhau.

Sửa bằng một `JOIN`, hoặc một truy vấn thứ hai lấy tất cả cùng lúc:

```sql
SELECT id, display_name FROM users WHERE id = ANY($1);  -- $1 là mảng author_id
```

Đây là loại lỗi hay đến từ ORM chứ không từ SQL viết tay. Hầu hết ORM có cách nạp trước quan hệ (eager loading) — hãy dùng nó khi biết chắc sẽ cần.

## 2. Join làm nhân số dòng

Join sang một bảng quan hệ một-nhiều rồi tính tổng trên cột của bảng gốc sẽ cộng lặp:

```sql
-- SAI: mỗi đơn hàng bị nhân lên theo số dòng order_items
SELECT sum(o.total)
FROM orders o JOIN order_items i ON i.order_id = o.id
WHERE o.created_at >= '2026-10-01';
```

Thường lộ ra ở chỗ con số tổng cộng sai gấp mấy lần, hoặc truy vấn trả về nhiều dòng hơn bảng gốc có. Khi chỉ cần lọc hay lấy một con số từ bảng bên kia, dùng `EXISTS`, truy vấn con tương quan hoặc `LATERAL`:

```sql
SELECT sum(o.total)
FROM orders o
WHERE o.created_at >= '2026-10-01'
  AND EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id);
```

## 3. Lấy nhiều hơn thứ cần

`SELECT *` trên bảng có cột văn bản dài kéo cả nội dung đó qua mạng cho mỗi dòng, kể cả khi màn hình chỉ hiện tiêu đề. Liệt kê đúng cột cần không chỉ giảm dữ liệu truyền đi mà còn cho phép PostgreSQL dùng *index-only scan* — trả lời hoàn toàn từ index, không chạm vào bảng.

Cùng nhóm này là việc lọc ở tầng ứng dụng: tải 10.000 dòng về rồi `filter` trong JavaScript. Cơ sở dữ liệu lọc nhanh hơn và không phải gửi 9.980 dòng thừa qua mạng. Đẩy điều kiện vào `WHERE`, đẩy giới hạn vào `LIMIT`.

## 4. Phân trang bằng OFFSET lớn

`OFFSET 10000` buộc cơ sở dữ liệu dựng đủ 10.000 dòng đầu rồi vứt đi. Trang càng sâu càng chậm, một cách tuyến tính.

Phân trang theo con trỏ giữ tốc độ như nhau ở mọi trang, vì nó luôn bắt đầu từ đúng chỗ cần:

```sql
-- trang đầu
SELECT id, title, created_at FROM articles
ORDER BY created_at DESC, id DESC LIMIT 20;

-- trang sau: truyền created_at và id của dòng cuối trang trước
SELECT id, title, created_at FROM articles
WHERE (created_at, id) < ($1, $2)
ORDER BY created_at DESC, id DESC LIMIT 20;
```

Cột `id` đi kèm để thứ tự luôn xác định khi hai dòng trùng `created_at`. Kết hợp với index trên `(created_at DESC, id DESC)`, trang thứ 500 nhanh như trang đầu.

## Quy trình sửa một truy vấn chậm

1. Lấy câu SQL thật (từ log hoặc công cụ theo dõi), kèm tham số thật.
2. Chạy `EXPLAIN (ANALYZE, BUFFERS)` trên dữ liệu có quy mô giống production.
3. Tìm bước tốn thời gian nhất và chỗ ước lượng lệch nhất.
4. Đối chiếu với bốn nguyên nhân ở trên; phần lớn trường hợp rơi vào một trong số đó.
5. Sửa một thứ, đo lại, ghi lại con số trước và sau.

Thay đổi nhiều thứ cùng lúc thì không biết cái nào có tác dụng — và cái không có tác dụng vẫn ở lại trong mã.

## Tóm tắt

N+1, join nhân dòng, lấy thừa dữ liệu và `OFFSET` sâu là bốn thủ phạm quen thuộc nhất. Cả bốn đều hiện rõ trong `EXPLAIN ANALYZE` và log truy vấn. Đo trước, sửa đúng chỗ, đo lại — thứ tự đó tiết kiệm nhiều thời gian hơn bất kỳ mẹo tối ưu nào.
