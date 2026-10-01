---
title: List và tuple
summary: Lưu nhiều giá trị trong một biến — thêm, xóa, sắp xếp list; list comprehension; tuple bất biến và bẫy hai biến cùng trỏ một list.
objectives:
  - Tạo, truy cập, thêm, xóa và sắp xếp phần tử trong list
  - Viết list comprehension thay cho vòng lặp đơn giản
  - Phân biệt list và tuple, hiểu bẫy hai tên cùng trỏ một list
minutes: 25
---

Khi cần lưu điểm của một học sinh, một biến là đủ. Khi cần lưu điểm của cả lớp 40 người, bạn cần một cấu trúc chứa **nhiều** giá trị. Trong Python, cấu trúc phổ biến nhất là **list**.

## Tạo và truy cập list

List viết trong ngoặc vuông, các phần tử cách nhau bởi dấu phẩy. Chỉ số và cắt hoạt động y hệt chuỗi:

```python
diem = [8, 6.5, 9, 7]
print(diem[0])      # 8
print(diem[-1])     # 7
print(diem[1:3])    # [6.5, 9]
print(len(diem))    # 4

diem[1] = 7.5       # khác chuỗi: list SỬA ĐƯỢC tại chỗ
print(diem)         # [8, 7.5, 9, 7]
```

Một list có thể chứa các kiểu khác nhau, thậm chí chứa list khác (list lồng nhau), nhưng trong thực tế bạn nên giữ các phần tử cùng một kiểu để code dễ đoán.

## Thêm, xóa, tìm

```python
gio_hang = ["sách", "bút"]
gio_hang.append("vở")          # thêm vào cuối
gio_hang.insert(0, "cặp")      # chèn vào vị trí 0
print(gio_hang)                # ['cặp', 'sách', 'bút', 'vở']

gio_hang.remove("bút")         # xóa phần tử có giá trị "bút" (lần đầu tiên)
cuoi = gio_hang.pop()          # lấy ra và xóa phần tử cuối
print(cuoi, gio_hang)          # vở ['cặp', 'sách']

print("sách" in gio_hang)      # True
print(gio_hang.index("sách"))  # 1
```

Chi phí khác nhau cần biết sớm: `append` và `pop()` ở **cuối** list rất nhanh. `insert(0, x)` và `pop(0)` ở **đầu** list phải dịch chuyển mọi phần tử phía sau, nên chậm dần khi list lớn. Kiểm tra `x in list` cũng phải duyệt từng phần tử. Khóa Cấu trúc dữ liệu sẽ giải thích vì sao, và giới thiệu cấu trúc phù hợp hơn.

## Duyệt list

```python
diem = [8, 6.5, 9, 7]
for d in diem:
    print(d)

for i, d in enumerate(diem):
    print(f"Học sinh {i + 1}: {d}")
```

`enumerate` cho cả chỉ số lẫn giá trị, gọn hơn `for i in range(len(diem))`.

Các hàm tổng hợp có sẵn giúp bạn khỏi tự viết vòng lặp:

```python
print(sum(diem), max(diem), min(diem))
print(sum(diem) / len(diem))    # điểm trung bình
```

## Sắp xếp

```python
so = [5, 2, 9, 1]
so.sort()                      # sắp xếp TẠI CHỖ, trả về None
print(so)                      # [1, 2, 5, 9]

trai_cay = ["banana", "Cherry", "apple"]
print(sorted(trai_cay))                  # ['Cherry', 'apple', 'banana'] chữ HOA xếp trước chữ thường
print(sorted(trai_cay, key=str.lower))   # ['apple', 'banana', 'Cherry'] không phân biệt hoa thường
print(sorted(so, reverse=True))       # [9, 5, 2, 1]
```

Phân biệt hai cách: `list.sort()` sửa chính list đó và trả về `None`; `sorted(x)` trả về **list mới**, giữ nguyên `x`. Lỗi rất phổ biến là viết `so = so.sort()`: sau dòng này `so` thành `None`.

Tham số `key` nhận một hàm, Python dùng kết quả của hàm đó để so sánh. Đây là công cụ cực mạnh: muốn sắp xếp theo nhiều tiêu chí, cho `key` trả về một tuple:

```python
hoc_sinh = [("An", 8), ("Bình", 9), ("Chi", 8)]
# điểm giảm dần, cùng điểm thì tên tăng dần
print(sorted(hoc_sinh, key=lambda hs: (-hs[1], hs[0])))
# [('Bình', 9), ('An', 8), ('Chi', 8)]
```

## List comprehension

Khi cần tạo list mới từ list cũ, Python có cú pháp gọn gọi là list comprehension:

```python
so = [1, 2, 3, 4, 5, 6]
binh_phuong = [x * x for x in so]            # [1, 4, 9, 16, 25, 36]
so_chan = [x for x in so if x % 2 == 0]      # [2, 4, 6]
```

Đọc như câu tiếng Anh: "lấy `x * x` cho mỗi `x` trong `so`". Dùng nó cho biến đổi đơn giản; khi logic dài hơn một dòng, vòng lặp `for` thông thường dễ đọc hơn.

## Tuple: list không sửa được

Tuple viết trong ngoặc tròn và **bất biến** như chuỗi:

```python
toa_do = (10, 20)
x, y = toa_do          # "mở gói" tuple vào hai biến
print(x, y)
# toa_do[0] = 5        → TypeError
```

Dùng tuple cho dữ liệu có **cấu trúc cố định** mà không nên bị sửa: tọa độ, cặp (tên, điểm), kết quả trả về nhiều giá trị từ một hàm. Bạn đã dùng tuple mà không biết: `a, b = b, a` để hoán đổi hai biến chính là tạo rồi mở gói một tuple.

## Bẫy: hai tên cùng một list

```python
a = [1, 2, 3]
b = a          # b KHÔNG phải bản sao, mà là tên thứ hai của cùng một list
b.append(4)
print(a)       # [1, 2, 3, 4]  ← a cũng đổi!

c = a.copy()   # bản sao thật sự
c.append(5)
print(a)       # [1, 2, 3, 4]
```

Phép gán không sao chép list, nó chỉ gắn thêm một cái tên. Muốn bản sao độc lập, dùng `a.copy()` hoặc `a[:]`.

## Ví dụ thực hành: thống kê điểm một lớp

Cho điểm của cả lớp trên một dòng. Hãy in điểm trung bình (làm tròn hai chữ số), điểm cao nhất kèm **số thứ tự** của những học sinh đạt điểm đó, và số học sinh dưới trung bình (dưới 5).

Hãy chia bài toán thành các câu hỏi nhỏ, mỗi câu một công cụ đã học: trung bình dùng `sum` và `len`; điểm cao nhất dùng `max`; tìm những vị trí đạt điểm đó dùng `enumerate` trong một list comprehension; đếm dưới trung bình cũng dùng comprehension.

```python
diem = list(map(float, input().split()))

trung_binh = sum(diem) / len(diem)
cao_nhat = max(diem)
vi_tri = [i + 1 for i, d in enumerate(diem) if d == cao_nhat]
duoi_tb = len([d for d in diem if d < 5])

print(f"Trung bình: {trung_binh:.2f}")
print(f"Cao nhất: {cao_nhat} (học sinh số {', '.join(map(str, vi_tri))})")
print(f"Dưới trung bình: {duoi_tb}")
```

Với đầu vào `7 9 4.5 9 6`, chương trình in trung bình `7.10`, cao nhất `9.0` ở học sinh số `2, 4`, và một học sinh dưới trung bình. Để ý ta cộng `1` vào chỉ số vì người dùng đếm từ 1, còn Python đếm từ 0. Lệch một đơn vị ở chỗ này là lỗi rất dễ mắc khi hiển thị kết quả cho người dùng.

Một câu hỏi đáng suy nghĩ: nếu danh sách điểm rỗng thì sao? `sum(diem) / len(diem)` sẽ chia cho 0. Đề bài nói luôn có ít nhất một học sinh thì không sao; còn trong chương trình thật, bạn phải kiểm tra trường hợp này trước.

## Lỗi thường gặp

- **`so = so.sort()`**: làm mất list vì `sort()` trả về `None`.
- **Truy cập chỉ số không tồn tại**: list 4 phần tử không có `diem[4]`.
- **Tưởng `b = a` là sao chép** và sửa nhầm dữ liệu gốc.
- **Xóa phần tử khi đang duyệt chính list đó**: tạo list mới bằng comprehension thay vì xóa.

## Tóm tắt

- List là dãy có thứ tự, sửa được; tuple giống list nhưng bất biến.
- `append`/`pop()` ở cuối nhanh, thao tác ở đầu chậm.
- `sorted(x, key=...)` trả list mới; `x.sort()` sắp xếp tại chỗ và trả `None`.
- Gán list cho tên khác không sao chép; dùng `.copy()`.

## Tự kiểm tra

1. Viết list comprehension lấy các từ có độ dài lớn hơn 3 từ `words`.
2. Sắp xếp danh sách các cặp `(ten, tuoi)` theo tuổi tăng dần, cùng tuổi thì theo tên.
