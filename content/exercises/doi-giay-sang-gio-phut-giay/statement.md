Đồng hồ bấm giờ của một cuộc thi chạy chỉ ghi lại **tổng số giây** mà vận động viên đã chạy. Ban tổ chức muốn in kết quả theo dạng quen thuộc `HH:MM:SS` để khán giả dễ đọc.

Viết chương trình đọc một số nguyên `n` là số giây, rồi in ra khoảng thời gian đó dưới dạng giờ, phút, giây.

## Đầu vào

Một dòng chứa số nguyên `n` — tổng số giây.

## Đầu ra

Một dòng dạng `HH:MM:SS`:

- `MM` và `SS` luôn có đúng hai chữ số (thêm số 0 ở đầu nếu cần).
- `HH` có ít nhất hai chữ số. Nếu số giờ từ 100 trở lên thì in đầy đủ, **không** cắt bớt.

## Ghi chú

Bài này luyện hai phép toán bạn sẽ dùng rất nhiều: chia lấy phần nguyên `//` và chia lấy dư `%`. Hãy thử giải mà không dùng thư viện xử lý thời gian.
