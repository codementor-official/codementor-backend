# Biến và kiểu dữ liệu trong Python

## Biến là gì

Trong Python, biến là một cái tên gắn với một đối tượng trong bộ nhớ. Câu lệnh `x = 5` không "đổ" số 5 vào một ô nhớ tên x như trong C, mà tạo đối tượng số nguyên 5 rồi gắn tên `x` vào đối tượng đó. Vì vậy hai biến có thể cùng trỏ tới một đối tượng: sau `a = [1, 2]` và `b = a`, sửa `b.append(3)` thì `a` cũng thấy phần tử 3.

Python là ngôn ngữ kiểu động: một biến có thể lần lượt gắn với số, chuỗi, rồi danh sách mà không cần khai báo kiểu. Kiểu thuộc về đối tượng, không thuộc về tên biến. Hàm `type(x)` cho biết kiểu của đối tượng mà `x` đang trỏ tới.

## Quy ước đặt tên của nhóm A+ Python

Nhóm A+ Python thống nhất quy ước đặt tên biến theo kiểu snake_case, ví dụ `so_luong_sinh_vien`, và tên hằng viết HOA toàn bộ, ví dụ `SO_LAN_THU_TOI_DA`. Tên lớp dùng PascalCase như `SinhVien`. Bài nộp đặt tên sai quy ước bị trừ 0,5 điểm phong cách.

Tên biến không được bắt đầu bằng chữ số, không trùng từ khoá như `class`, `for`, `lambda`, và phân biệt chữ hoa chữ thường: `Diem` và `diem` là hai biến khác nhau.

## Các kiểu dữ liệu cơ bản

- `int`: số nguyên. Số nguyên trong Python không giới hạn độ lớn, chỉ bị giới hạn bởi bộ nhớ máy, nên `2 ** 1000` vẫn tính chính xác.
- `float`: số thực dấu phẩy động 64 bit theo chuẩn IEEE 754. Vì biểu diễn nhị phân, `0.1 + 0.2` cho ra `0.30000000000000004` chứ không đúng bằng `0.3`. Khi so sánh số thực nên dùng `math.isclose(a, b)`.
- `bool`: chỉ có hai giá trị `True` và `False`. `bool` là lớp con của `int`, nên `True + True` bằng 2.
- `str`: chuỗi ký tự Unicode, bất biến. Mọi phép "sửa" chuỗi đều tạo ra chuỗi mới.
- `NoneType`: chỉ có một giá trị là `None`, dùng để biểu thị "không có giá trị".

## Ép kiểu

Hàm `int("42")` đổi chuỗi sang số nguyên, `float("3.5")` sang số thực, `str(10)` sang chuỗi. Ép một chuỗi không hợp lệ như `int("abc")` sẽ ném lỗi `ValueError`. Hàm `int(3.9)` cắt bỏ phần thập phân và cho 3, không làm tròn; muốn làm tròn thì dùng `round(3.9)`.

Hàm `input()` luôn trả về chuỗi, nên đọc số từ bàn phím phải viết `n = int(input())`.

## Giá trị đúng sai của đối tượng

Khi đặt một đối tượng vào điều kiện `if`, Python xét "giá trị chân lý" của nó. Các giá trị được coi là sai gồm: `False`, `None`, số 0, chuỗi rỗng `""`, danh sách rỗng `[]`, tuple rỗng, dict rỗng và set rỗng. Mọi giá trị khác được coi là đúng.

## So sánh `==` và `is`

Toán tử `==` so sánh giá trị, còn `is` kiểm tra hai tên có trỏ tới cùng một đối tượng hay không. Quy tắc của nhóm: chỉ dùng `is` để so với `None` (`if x is None:`), mọi trường hợp khác dùng `==`.
