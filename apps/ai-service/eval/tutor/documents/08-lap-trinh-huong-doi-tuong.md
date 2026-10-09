# Lập trình hướng đối tượng

## Lớp và đối tượng

```python
class SinhVien:
    truong = "CodeMentor"          # thuộc tính của lớp, dùng chung

    def __init__(self, ten, diem):
        self.ten = ten             # thuộc tính của từng đối tượng
        self.diem = diem

    def xep_loai(self):
        return "Giỏi" if self.diem >= 8 else "Khá"
```

`__init__` là hàm khởi tạo, chạy khi tạo đối tượng `SinhVien("An", 9)`. Tham số đầu tiên `self` là chính đối tượng đang gọi; Python tự truyền nó, người gọi không truyền.

Thuộc tính khai báo trong thân lớp là thuộc tính của lớp, mọi đối tượng dùng chung. Gán `self.x = ...` tạo thuộc tính riêng của đối tượng.

## Kế thừa

```python
class SinhVienCaoHoc(SinhVien):
    def __init__(self, ten, diem, de_tai):
        super().__init__(ten, diem)
        self.de_tai = de_tai
```

`super()` gọi phương thức của lớp cha. Lớp con có thể ghi đè (override) phương thức của lớp cha.

Python hỗ trợ đa kế thừa. Thứ tự tìm phương thức gọi là MRO (Method Resolution Order), tính bằng thuật toán C3; xem bằng `TenLop.__mro__` hoặc `TenLop.mro()`.

## Đóng gói

Python không có `private` thật sự. Quy ước: tên bắt đầu bằng một dấu gạch dưới `_x` là "nội bộ, đừng dùng từ ngoài". Hai dấu gạch dưới `__x` kích hoạt name mangling thành `_TenLop__x` để tránh trùng tên với lớp con.

`@property` biến một phương thức thành thuộc tính chỉ đọc, kèm `@ten.setter` để kiểm tra giá trị khi gán.

## Phương thức đặc biệt (dunder)

- `__str__` quyết định kết quả của `print(obj)` và `str(obj)`.
- `__repr__` là biểu diễn cho lập trình viên, hiện trong REPL.
- `__eq__` định nghĩa phép so sánh `==`.
- `__len__` cho phép gọi `len(obj)`.
- `__lt__` cho phép sắp xếp các đối tượng.

## Phương thức lớp và phương thức tĩnh

`@classmethod` nhận lớp (`cls`) thay vì đối tượng, hay dùng làm hàm tạo thay thế như `SinhVien.tu_chuoi("An,9")`. `@staticmethod` không nhận cả `self` lẫn `cls`, chỉ là hàm thường đặt trong lớp cho gọn.

## dataclass

`@dataclasses.dataclass` tự sinh `__init__`, `__repr__`, `__eq__` từ các trường khai báo kiểu, giảm mã lặp cho lớp chủ yếu chứa dữ liệu.
