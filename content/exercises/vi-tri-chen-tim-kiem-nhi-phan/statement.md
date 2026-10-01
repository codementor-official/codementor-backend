Bảng xếp hạng của một kỳ thi lưu điểm các thí sinh theo thứ tự tăng dần. Khi một thí sinh mới nộp bài với điểm `x`, hệ thống cần biết ngay **có bao nhiêu người điểm thấp hơn** họ, cũng là vị trí chèn `x` vào bảng mà vẫn giữ thứ tự.

Cho mảng `a` gồm `n` số nguyên đã sắp xếp không giảm và `q` truy vấn. Với mỗi truy vấn `x`, in ra **vị trí chèn trái nhất**: số phần tử của `a` nhỏ hơn hẳn `x`. Đây cũng là chỉ số (đếm từ 0) đầu tiên mà `a[i] ≥ x`.

## Đầu vào

- Dòng đầu gồm hai số nguyên `n` và `q`.
- Dòng thứ hai gồm `n` số nguyên của mảng `a`.
- `q` dòng tiếp theo, mỗi dòng một số nguyên `x`.

## Đầu ra

`q` dòng, mỗi dòng là vị trí chèn của truy vấn tương ứng.

## Ghi chú

Bài này cố ý không cho phép bạn dừng ở cách "đếm từng phần tử": với `3500` truy vấn trên mảng `3500` phần tử, cách đó cần hơn 12 triệu phép so sánh. Tìm kiếm nhị phân cắt đôi khoảng tìm kiếm sau mỗi bước, nên mỗi truy vấn chỉ cần khoảng 12 phép so sánh. Ở hệ thống thật với hàng triệu thí sinh, chênh lệch này là giữa vài mili giây và vài giờ. Hãy tự cài đặt thay vì gọi `bisect`, rồi đối chiếu kết quả với `bisect_left` để kiểm tra.
