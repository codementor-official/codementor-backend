---
title: Làm việc với chuỗi
summary: Chỉ số và cắt chuỗi, các phương thức hay dùng (strip, split, join, replace, upper/lower) và vì sao chuỗi không sửa tại chỗ được.
objectives:
  - Truy cập ký tự và cắt chuỗi bằng chỉ số, kể cả chỉ số âm
  - Dùng các phương thức split, join, strip, replace, upper, lower
  - Hiểu chuỗi là bất biến và viết code tạo chuỗi mới đúng cách
minutes: 20
---

Phần lớn dữ liệu bạn xử lý ngoài đời là chữ: họ tên, địa chỉ email, nội dung tin nhắn, dòng trong file log. Python có bộ công cụ rất mạnh để làm việc với chuỗi, và thành thạo nó sẽ tiết kiệm cho bạn rất nhiều vòng lặp tự viết.

![Người đứng cạnh ô nhập văn bản: chuỗi là một dãy ký tự](illustration:text-field)

## Chỉ số và cắt chuỗi

Mỗi ký tự trong chuỗi có một **chỉ số** (index), bắt đầu từ `0`. Chỉ số âm đếm từ cuối: `-1` là ký tự cuối cùng.

```python
s = "CodeMentor"
print(s[0])     # C
print(s[4])     # M
print(s[-1])    # r
print(len(s))   # 10
```

**Cắt chuỗi** (slicing) lấy một đoạn con bằng cú pháp `s[bat_dau:ket_thuc:buoc]`. Giống `range`, vị trí `ket_thuc` **không** được lấy.

```python
s = "CodeMentor"
print(s[0:4])    # Code
print(s[4:])     # Mentor   (bỏ trống = tới hết)
print(s[:4])     # Code     (bỏ trống = từ đầu)
print(s[::-1])   # rotneMedoC  (bước -1: đảo ngược)
```

Cắt chuỗi không bao giờ báo lỗi vượt chỉ số: `s[5:100]` chỉ đơn giản lấy tới hết. Nhưng truy cập một ký tự đơn lẻ vượt chỉ số, như `s[100]`, thì báo `IndexError`.

## Chuỗi là bất biến

Bạn **không** thể sửa một ký tự của chuỗi tại chỗ:

```python
s = "hello"
# s[0] = "H"   → TypeError: 'str' object does not support item assignment
s = "H" + s[1:]
print(s)        # Hello
```

Mọi thao tác "sửa" chuỗi thực chất là **tạo chuỗi mới** rồi gán lại cho biến. Điều này có một hệ quả về hiệu năng: nối chuỗi bằng `+=` trong vòng lặp hàng chục nghìn lần sẽ chậm, vì mỗi lần nối lại sao chép toàn bộ chuỗi. Cách đúng là gom các mảnh vào danh sách rồi nối một lần bằng `join` (xem phần dưới).

## Các phương thức hay dùng

Phương thức là hàm gắn với một giá trị, gọi bằng dấu chấm. Vì chuỗi bất biến, các phương thức này đều **trả về chuỗi mới**, không đổi chuỗi gốc.

```python
s = "   Học Python, học mãi   "
print(s.strip())          # "Học Python, học mãi"   bỏ khoảng trắng hai đầu
print(s.lower())          # chữ thường
print(s.upper())          # CHỮ HOA
print(s.replace("học", "dạy"))   # chỉ thay chữ "học" viết thường
print(s.count("ọ"))       # đếm số lần xuất hiện
print(s.strip().startswith("Học"))  # True
```

Kiểm tra nội dung chuỗi:

- `s.isdigit()`: toàn chữ số.
- `s.isalpha()`: toàn chữ cái.
- `s.isalnum()`: chữ cái hoặc chữ số.
- `"Python" in s`: kiểm tra chuỗi con, trả về `True`/`False`.
- `s.find("x")`: vị trí xuất hiện đầu tiên, `-1` nếu không có.

## split và join: cặp đôi quan trọng nhất

`split` cắt chuỗi thành **danh sách** các mảnh; `join` làm điều ngược lại.

```python
dong = "an,binh,chi"
ten = dong.split(",")
print(ten)                 # ['an', 'binh', 'chi']

cau = "  nhiều    khoảng   trắng  "
print(cau.split())         # ['nhiều', 'khoảng', 'trắng']

print("-".join(["2026", "10", "01"]))   # 2026-10-01
```

Chú ý sự khác nhau quan trọng: `split()` **không có tham số** tách theo mọi loại khoảng trắng liên tiếp và tự bỏ các mảnh rỗng. Còn `split(" ")` tách theo **đúng một** dấu cách, nên hai dấu cách liền nhau sinh ra mảnh rỗng `''`. Khi đọc dữ liệu do người dùng gõ, gần như luôn dùng `split()`.

Mẫu đọc nhiều số trên một dòng bạn sẽ gặp ở hầu hết bài tập:

```python
a, b, c = map(int, input().split())
```

`input().split()` cho danh sách chuỗi, `map(int, ...)` đổi từng phần tử sang số nguyên.

## Ví dụ hoàn chỉnh: viết hoa chữ cái đầu mỗi từ

```python
ho_ten = input()
cac_tu = ho_ten.split()
chuan = []
for tu in cac_tu:
    chuan.append(tu[0].upper() + tu[1:].lower())
print(" ".join(chuan))
```

Với đầu vào `"  nGUYEN   van  an "`, chương trình in `Nguyen Van An`: `split()` lo khoảng trắng thừa, cắt chuỗi lo viết hoa chữ đầu, `join` ghép lại với đúng một dấu cách. Python có sẵn `str.title()` làm việc gần giống, nhưng nó viết hoa cả chữ ngay sau dấu nháy đơn (như `"o'neil"` thành `"O'Neil"`), nên tự viết giúp bạn kiểm soát quy tắc chính xác.

## Ví dụ thực hành: kiểm tra mật khẩu

Một trang đăng ký yêu cầu mật khẩu dài ít nhất 8 ký tự, có cả chữ và số, và không được chứa dấu cách. Viết chương trình in ra các yêu cầu **chưa** đạt, hoặc `Hợp lệ` nếu đạt hết.

```python
mk = input()
loi = []
if len(mk) < 8:
    loi.append("cần ít nhất 8 ký tự")
if not any(c.isalpha() for c in mk):
    loi.append("cần có chữ cái")
if not any(c.isdigit() for c in mk):
    loi.append("cần có chữ số")
if " " in mk:
    loi.append("không được có dấu cách")
print("Hợp lệ" if not loi else "; ".join(loi))
```

Có hai điểm mới ở đây. Hàm `any(...)` trả về `True` nếu **ít nhất một** phần tử thỏa điều kiện, và dừng ngay khi tìm thấy, nên không phải duyệt hết chuỗi. Thứ hai, thay vì dừng ở lỗi đầu tiên, chương trình **gom mọi lỗi** vào một list rồi in một lần bằng `join`. Người dùng sửa được tất cả trong một lần, thay vì đoán mò từng điều kiện một.

## Lỗi thường gặp

- **Quên rằng phương thức trả về chuỗi mới**: gọi `s.strip()` mà không gán lại thì `s` vẫn nguyên khoảng trắng.
- **Dùng `split(" ")` với dữ liệu người dùng gõ**: sinh ra phần tử rỗng khi có nhiều dấu cách.
- **So sánh không chuẩn hóa**: `"Python" == "python"` là `False`. So sánh `s.lower()` của cả hai vế.
- **Nối chuỗi trong vòng lặp lớn bằng `+=`**: dùng danh sách và `join`.

## Tóm tắt

- Chỉ số bắt đầu từ 0, chỉ số âm đếm từ cuối; `s[a:b]` không lấy vị trí `b`.
- Chuỗi bất biến: mọi phương thức trả về chuỗi mới.
- `split()` không tham số là cách an toàn để tách từ; `join` để ghép.
- `in`, `find`, `count`, `isdigit` dùng để kiểm tra nội dung.

## Tự kiểm tra

1. Viết biểu thức kiểm tra một chuỗi có đọc xuôi ngược như nhau không (ví dụ `"level"`).
2. `"a  b".split(" ")` và `"a  b".split()` cho kết quả khác nhau thế nào?
