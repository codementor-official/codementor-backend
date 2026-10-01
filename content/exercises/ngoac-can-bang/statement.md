Trình soạn thảo code nào cũng cần một tính năng cơ bản: phát hiện **ngoặc không cân bằng** và chỉ cho người dùng vị trí sai. Bạn sẽ viết phần kiểm tra đó.

Một chuỗi được gọi là cân bằng nếu mỗi ngoặc mở `(`, `[`, `{` đều có đúng một ngoặc đóng **cùng loại** tương ứng ở phía sau, và các cặp ngoặc lồng nhau đúng thứ tự: `([])` hợp lệ, nhưng `([)]` thì không. Các ký tự không phải ngoặc được bỏ qua.

## Đầu vào

Một dòng chứa chuỗi cần kiểm tra.

## Đầu ra

- Nếu chuỗi cân bằng, in `YES`.
- Nếu không, in `NO p`, với `p` là vị trí (đếm từ 1) xác định lỗi:
  - Nếu gặp một ngoặc đóng không hợp lệ (không có ngoặc mở nào đang chờ, hoặc ngoặc mở đang chờ khác loại), `p` là vị trí của **ngoặc đóng đầu tiên** như vậy.
  - Nếu đọc hết chuỗi mà vẫn còn ngoặc mở chưa đóng, `p` là vị trí của ngoặc mở **mở gần nhất** chưa được đóng.

## Ghi chú

Ngăn xếp (vào sau ra trước) khớp hoàn hảo với bài toán: ngoặc mở **gần nhất** chưa đóng chính là ngoặc phải được đóng **đầu tiên**. Lưu cả vị trí cùng với ký tự ngoặc khi đẩy vào ngăn xếp để báo lỗi chính xác.
