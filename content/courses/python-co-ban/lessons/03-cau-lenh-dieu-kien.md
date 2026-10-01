---
title: Câu lệnh điều kiện if, elif, else
summary: Cho chương trình khả năng ra quyết định — biểu thức so sánh, toán tử logic, chuỗi if/elif/else và lỗi thứ tự điều kiện.
objectives:
  - Viết biểu thức so sánh và kết hợp chúng bằng and, or, not
  - Dùng if/elif/else để chọn đúng một nhánh trong nhiều nhánh
  - Sắp xếp thứ tự điều kiện để tránh nhánh không bao giờ chạy
minutes: 20
---

Cho tới giờ, chương trình của bạn luôn chạy mọi dòng theo đúng một con đường. Nhưng phần mềm thật phải **ra quyết định**: mật khẩu đúng thì cho vào, sai thì báo lỗi; giỏ hàng trên 500.000 đồng thì miễn phí giao hàng. Công cụ để làm điều đó là câu lệnh điều kiện.

## Biểu thức so sánh

Một điều kiện là biểu thức cho ra `True` hoặc `False`:

```python
diem = 7.5
print(diem >= 5)     # True
print(diem == 10)    # False  (hai dấu bằng là SO SÁNH)
print(diem != 10)    # True   (khác)
print(3 < diem <= 8) # True   (Python cho phép so sánh nối tiếp)
```

Phân biệt rõ `=` (gán) và `==` (so sánh bằng). Viết `if diem = 10:` là lỗi cú pháp ngay lập tức. Điều này tốt: Python chặn lỗi trước khi nó kịp gây hại.

Kết hợp nhiều điều kiện bằng toán tử logic:

- `a and b` đúng khi **cả hai** đúng.
- `a or b` đúng khi **ít nhất một** đúng.
- `not a` đảo ngược.

```python
tuoi = 20
co_ve = False
print(tuoi >= 18 and co_ve)   # False
print(tuoi >= 18 or co_ve)    # True
print(not co_ve)              # True
```

## if, elif, else

```python
so_tien = int(input())
if so_tien >= 500000:
    print("Miễn phí giao hàng")
elif so_tien >= 200000:
    print("Giảm 50% phí giao hàng")
else:
    print("Phí giao hàng 30.000 đồng")
```

Cách đọc: Python kiểm tra điều kiện từ **trên xuống**. Gặp điều kiện đầu tiên đúng thì chạy khối lệnh của nhánh đó và **bỏ qua tất cả các nhánh còn lại**. Nếu không điều kiện nào đúng thì chạy khối `else` (nếu có).

Hai chi tiết cú pháp:

- Cuối dòng `if`, `elif`, `else` luôn có dấu hai chấm `:`.
- Khối lệnh bên trong **thụt vào 4 dấu cách**. Python dùng thụt lề, không dùng ngoặc nhọn, để biết lệnh nào thuộc nhánh nào.

## Thứ tự điều kiện quan trọng

Vì Python dừng ở điều kiện đúng **đầu tiên**, thứ tự các nhánh quyết định kết quả. Đoạn code sau có lỗi logic dù cú pháp hoàn toàn đúng:

```python
diem = 9.5
if diem >= 5:
    print("Trung bình")
elif diem >= 8:
    print("Giỏi")        # không bao giờ chạy tới!
elif diem >= 9:
    print("Xuất sắc")
```

Với `diem = 9.5`, điều kiện `diem >= 5` đã đúng nên chương trình in "Trung bình". Hai nhánh sau trở thành code chết. Cách sửa: xét từ mức **cao nhất xuống thấp nhất**.

```python
if diem >= 9:
    print("Xuất sắc")
elif diem >= 8:
    print("Giỏi")
elif diem >= 5:
    print("Trung bình")
else:
    print("Yếu")
```

Một lợi ích nữa của thứ tự này: khi đã vào nhánh `elif diem >= 8`, bạn **biết chắc** `diem < 9` (vì nhánh trên đã sai), nên không cần viết `8 <= diem < 9`. Code ngắn hơn và ít chỗ để sai hơn.

## Kiểm tra dữ liệu không hợp lệ trước

Một thói quen tốt: loại bỏ các trường hợp **không hợp lệ** ngay ở nhánh đầu tiên. Phần còn lại của chương trình khi đó được làm việc với dữ liệu sạch.

```python
diem = float(input())
if diem < 0 or diem > 10:
    print("Điểm không hợp lệ")
elif diem >= 9:
    print("Xuất sắc")
# ... các mức còn lại
```

## Biểu thức điều kiện một dòng

Khi chỉ cần chọn giữa hai giá trị, Python có cách viết gọn:

```python
n = int(input())
loai = "chẵn" if n % 2 == 0 else "lẻ"
print(n, "là số", loai)
```

Chỉ dùng cách này cho lựa chọn đơn giản. Nếu phải lồng nhiều tầng, hãy quay về `if/elif/else` cho dễ đọc.

## Giá trị "đúng" và "sai" ngầm định

Trong điều kiện, Python coi một số giá trị là sai: `0`, `0.0`, chuỗi rỗng `""`, danh sách rỗng `[]`, và `None`. Mọi giá trị khác đều đúng.

```python
ten = input().strip()
if not ten:
    print("Bạn chưa nhập tên")
```

`if not ten:` đọc tự nhiên hơn `if ten == "":`, và hoạt động với mọi kiểu "rỗng".

## Ví dụ thực hành: phí giao hàng nhiều điều kiện

Một cửa hàng miễn phí giao hàng cho đơn từ 500.000 đồng; với đơn nhỏ hơn, phí là 30.000 đồng, nhưng khách hàng thành viên được giảm một nửa phí. Đơn có giá trị âm là dữ liệu lỗi.

Có ba yếu tố cùng quyết định kết quả: giá trị đơn hợp lệ hay không, đơn có đủ ngưỡng miễn phí không, và khách có phải thành viên không. Cách tổ chức gọn nhất là xử lý trường hợp lỗi trước, rồi trường hợp miễn phí, cuối cùng mới tính phí cho phần còn lại:

```python
gia_tri = int(input())
thanh_vien = input().strip() == "co"

if gia_tri < 0:
    print("Đơn hàng không hợp lệ")
elif gia_tri >= 500000:
    print("Phí giao hàng: 0")
else:
    phi = 30000
    if thanh_vien:
        phi //= 2
    print("Phí giao hàng:", phi)
```

Hãy để ý khối `if thanh_vien:` lồng **bên trong** nhánh `else`. Ưu đãi thành viên chỉ có ý nghĩa khi có phí để giảm, nên đặt nó ở đó vừa đúng nghiệp vụ vừa tránh phải lặp lại điều kiện. Khi viết điều kiện lồng nhau, hãy tự hỏi: điều kiện bên trong có thật sự phụ thuộc vào điều kiện bên ngoài không? Nếu không, hãy kéo nó ra cho phẳng.

## Lỗi thường gặp

- **Viết `=` thay cho `==`** trong điều kiện: lỗi cú pháp.
- **Thứ tự điều kiện sai**: điều kiện rộng đứng trước điều kiện hẹp làm nhánh sau không bao giờ chạy.
- **Quên dấu hai chấm hoặc thụt lề không đều**: trộn tab và dấu cách gây `IndentationError` rất khó nhìn ra.
- **So sánh chuỗi số**: `"10" > "9"` là `False`, vì chuỗi được so theo từng ký tự. Đổi sang số trước khi so.

## Tóm tắt

- Điều kiện là biểu thức `True`/`False`; kết hợp bằng `and`, `or`, `not`.
- `if/elif/else` chạy **đúng một** nhánh: nhánh đầu tiên có điều kiện đúng.
- Xét từ trường hợp hẹp/cao xuống rộng/thấp; loại dữ liệu không hợp lệ ngay từ đầu.
- `0`, `""`, `[]`, `None` được coi là sai trong điều kiện.

## Tự kiểm tra

1. Viết điều kiện kiểm tra một năm `y` là năm nhuận: chia hết cho 4 nhưng không chia hết cho 100, **hoặc** chia hết cho 400.
2. Với `x = 0`, câu lệnh `if x:` in `"A"` ở nhánh đúng và `"B"` ở nhánh `else`. Chương trình in ra chữ nào? Vì sao?
