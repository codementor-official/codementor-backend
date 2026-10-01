---
title: Biến, kiểu dữ liệu và phép toán
summary: Biến là tên gắn với giá trị; mỗi giá trị có một kiểu. Học bốn kiểu cơ bản và các phép toán số học, đặc biệt là // và %.
objectives:
  - Tạo và cập nhật biến, đặt tên biến dễ đọc
  - Phân biệt int, float, str, bool và đổi kiểu giữa chúng
  - Dùng đúng các phép toán số học, đặc biệt chia nguyên // và chia lấy dư %
minutes: 20
---

Hầu như chương trình nào cũng cần **ghi nhớ** thứ gì đó: tên người dùng, số tiền trong giỏ hàng, số lần đã thử. Trong Python, ta ghi nhớ bằng **biến**.

## Biến là một cái tên

Một biến là **tên** gắn với một **giá trị**. Dấu `=` trong Python nghĩa là "gán": tính giá trị ở vế phải rồi gắn nó với tên ở vế trái.

```python
so_luong = 3
don_gia = 45000
thanh_tien = so_luong * don_gia
print(thanh_tien)   # 135000

so_luong = so_luong + 1   # gán lại: lấy giá trị cũ cộng 1
print(so_luong)     # 4
```

Dòng `so_luong = so_luong + 1` khiến nhiều người mới bối rối nếu đọc nó như một phương trình toán học. Hãy đọc từ phải sang trái: "lấy giá trị hiện tại của `so_luong`, cộng 1, rồi gắn kết quả lại cho tên `so_luong`". Python còn có cách viết gọn `so_luong += 1`.

Quy tắc đặt tên biến:

- Chỉ gồm chữ cái, chữ số và dấu gạch dưới `_`, không bắt đầu bằng chữ số.
- Phân biệt hoa thường: `tong` và `Tong` là hai biến khác nhau.
- Theo quy ước của Python, dùng chữ thường nối bằng gạch dưới: `diem_trung_binh`, không phải `DiemTrungBinh`.

Tên biến tốt cho biết **ý nghĩa** của giá trị. `t = 30` không nói gì; `thoi_gian_cho_phut = 30` thì tự giải thích.

## Bốn kiểu dữ liệu cơ bản

Mỗi giá trị trong Python có một **kiểu** (type). Kiểu quyết định giá trị đó làm được gì. Hàm `type` cho biết kiểu của một giá trị.

```python
print(type(42))        # <class 'int'>   số nguyên
print(type(3.14))      # <class 'float'> số thực
print(type("CodeMentor"))  # <class 'str'> chuỗi
print(type(True))      # <class 'bool'>  đúng/sai
```

- `int` là số nguyên, không giới hạn độ lớn. Python tính đúng cả `2 ** 100`.
- `float` là số thực. Nó có sai số nhỏ do cách máy tính lưu số: `0.1 + 0.2` cho ra `0.30000000000000004`. Vì vậy đừng so sánh hai số thực bằng `==` khi cần chính xác tuyệt đối.
- `str` là chuỗi ký tự, viết trong dấu nháy đơn hoặc nháy kép.
- `bool` chỉ có hai giá trị `True` và `False`. Ta sẽ dùng nhiều ở bài điều kiện.

Đổi kiểu bằng cách gọi tên kiểu như một hàm: `int("12")`, `float("2.5")`, `str(99)`. Nếu chuỗi không phải số hợp lệ, `int("abc")` báo lỗi `ValueError`.

## Phép toán số học

```python
a, b = 17, 5
print(a + b)    # 22
print(a - b)    # 12
print(a * b)    # 85
print(a / b)    # 3.4   chia thường, luôn ra float
print(a // b)   # 3     chia lấy phần nguyên
print(a % b)    # 2     chia lấy dư
print(a ** 2)   # 289   lũy thừa
```

Hai phép `//` và `%` là công cụ bạn sẽ dùng **liên tục**:

- `n % 2 == 0` kiểm tra số chẵn.
- `n % 10` lấy chữ số cuối cùng; `n // 10` bỏ chữ số cuối cùng.
- Đổi đơn vị: `phut = tong_giay // 60` và `giay = tong_giay % 60`.

Python còn có hàm `divmod(a, b)` trả về cả hai cùng lúc:

```python
gio, con_lai = divmod(3725, 3600)
phut, giay = divmod(con_lai, 60)
print(gio, phut, giay)   # 1 2 5
```

Thứ tự ưu tiên giống toán học: lũy thừa trước, rồi nhân chia, rồi cộng trừ. Khi không chắc, hãy thêm ngoặc. Ngoặc thừa không làm chậm chương trình mà còn giúp người đọc hiểu nhanh hơn.

## Định dạng kết quả với f-string

Để in số đẹp, dùng **f-string**: đặt chữ `f` trước dấu nháy và viết biểu thức trong ngoặc nhọn.

```python
ten = "An"
diem = 8.456
print(f"{ten} đạt {diem:.2f} điểm")     # An đạt 8.46 điểm
print(f"{7:02d}:{5:02d}")               # 07:05
print(f"{1234567:,}")                   # 1,234,567
```

`:.2f` làm tròn hai chữ số thập phân, `:02d` thêm số 0 ở đầu cho đủ hai chữ số. Đây chính là thứ bạn cần trong bài tập đổi giây sang giờ, phút, giây ngay sau bài này.

## Ví dụ thực hành: tính tiền taxi

Một hãng taxi tính giá như sau: 12.000 đồng cho km đầu tiên, 15.000 đồng cho mỗi km tiếp theo, và làm tròn quãng đường **lên** km nguyên gần nhất. Hãy viết chương trình nhận quãng đường (số thực, đơn vị km) và in số tiền phải trả.

Trước khi gõ code, hãy nghĩ bằng lời: đầu tiên làm tròn quãng đường lên; nếu không quá 1 km thì trả giá mở cửa; nếu nhiều hơn thì trả giá mở cửa cộng phần km còn lại nhân đơn giá. Viết như vậy giúp bạn phát hiện câu hỏi cần trả lời trước khi code: quãng đường bằng 0 thì sao? Ở đây ta coi khách đã lên xe là trả ít nhất km đầu tiên.

```python
import math

km = float(input())
km_tron = max(1, math.ceil(km))
tien = 12000 + (km_tron - 1) * 15000
print(f"{tien:,} đồng")
```

Với `km = 3.2`, `math.ceil` cho `4`, tiền là `12000 + 3 * 15000 = 57000`, in ra `57,000 đồng`. Chú ý ta tính tiền hoàn toàn bằng **số nguyên** (đồng), nên không dính sai số của `float`. Đây là thói quen nên có mỗi khi làm việc với tiền: lưu và tính bằng đơn vị nhỏ nhất, chỉ đổi sang dạng hiển thị ở bước in.

## Lỗi thường gặp

- **Dùng `/` khi cần số nguyên**: `7 / 2` là `3.5`, không phải `3`. Cần phần nguyên thì dùng `//`.
- **So sánh float bằng `==`**: `0.1 + 0.2 == 0.3` là `False`. Hãy so độ chênh lệch với một sai số nhỏ, hoặc làm việc bằng số nguyên (ví dụ tính tiền bằng đồng, không bằng nghìn đồng có phần lẻ).
- **Đặt tên trùng hàm có sẵn**: `input = 5` hay `print = "x"` sẽ che mất hàm gốc, và các dòng sau gọi `input()` sẽ lỗi rất khó hiểu.
- **Biến chưa tạo đã dùng**: dùng `tong` trước dòng `tong = 0` sẽ báo `NameError`.

## Tóm tắt

- Biến là tên gắn với giá trị; `=` là phép gán, đọc từ phải sang trái.
- Bốn kiểu cơ bản: `int`, `float`, `str`, `bool`. Đổi kiểu bằng `int()`, `float()`, `str()`.
- `//` chia nguyên, `%` chia lấy dư, `divmod` trả cả hai.
- f-string định dạng kết quả: `:.2f` cho số thực, `:02d` cho số có số 0 ở đầu.

## Tự kiểm tra

1. Với `n = 1234`, viết biểu thức lấy chữ số hàng chục (số `3`) chỉ bằng `//` và `%`.
2. Vì sao `int(input()) / 2` có thể in ra `2.0` thay vì `2`? Sửa thế nào để in ra `2`?
