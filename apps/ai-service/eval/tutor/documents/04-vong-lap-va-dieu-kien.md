# Vòng lặp và câu lệnh điều kiện

## if, elif, else

Python dùng thụt lề (4 dấu cách theo PEP 8) để xác định khối lệnh, không dùng ngoặc nhọn. Thụt lề lẫn tab và dấu cách sẽ gây `TabError`.

```python
if diem >= 8:
    xep_loai = "Giỏi"
elif diem >= 6.5:
    xep_loai = "Khá"
else:
    xep_loai = "Trung bình"
```

Biểu thức điều kiện một dòng: `ket_qua = "Đạt" if diem >= 5 else "Trượt"`.

## Vòng lặp for và range

Vòng `for` của Python duyệt qua một đối tượng lặp được (list, chuỗi, dict, range...), không phải vòng đếm như C. `range(bat_dau, ket_thuc, buoc)` sinh dãy số từ bắt đầu đến **trước** kết thúc; `range(5)` cho 0, 1, 2, 3, 4.

Cần cả chỉ số lẫn giá trị thì dùng `enumerate`: `for i, x in enumerate(ds, start=1):`. Duyệt song song hai dãy dùng `zip(a, b)`; `zip` dừng ở dãy ngắn hơn.

## Vòng lặp while

`while dieu_kien:` lặp đến khi điều kiện sai. Quên cập nhật biến điều kiện sẽ thành vòng lặp vô hạn. Vòng `while True:` kết hợp `break` hay dùng khi đọc dữ liệu đến lúc gặp giá trị dừng.

## break, continue và else của vòng lặp

- `break` thoát ngay vòng lặp gần nhất.
- `continue` bỏ phần còn lại của lần lặp hiện tại, sang lần kế tiếp.
- Mệnh đề `else` gắn với `for` hoặc `while` chạy khi vòng lặp **kết thúc bình thường**, tức là không bị `break`. Đây là cách gọn để viết "tìm không thấy":

```python
for x in ds:
    if x == can_tim:
        print("Tìm thấy")
        break
else:
    print("Không có trong danh sách")
```

## match-case

Từ Python 3.10 có câu lệnh `match` để so khớp mẫu (structural pattern matching). Trường hợp mặc định viết `case _:`. `match` so khớp được cả cấu trúc, ví dụ `case (x, 0):` khớp mọi tuple hai phần tử có phần tử thứ hai bằng 0.

## Lỗi thường gặp

Sửa list trong khi đang duyệt chính nó bằng `for` có thể bỏ sót phần tử. Nên duyệt trên bản sao `for x in ds[:]` hoặc tạo list mới bằng comprehension.
