---
title: Các thuật toán sắp xếp
summary: Từ sắp xếp chèn O(n²) tới sắp xếp trộn O(n log n), tính ổn định, và cách dùng sorted với key cho sắp xếp nhiều tiêu chí trong công việc thật.
objectives:
  - Cài đặt sắp xếp chèn và giải thích vì sao nó O(n²)
  - Cài đặt sắp xếp trộn theo chia để trị và giải thích O(n log n)
  - Dùng sorted với key và tính ổn định để sắp xếp nhiều tiêu chí
minutes: 30
---

Sắp xếp là một trong những việc máy tính làm nhiều nhất: xếp hạng kết quả tìm kiếm, sắp đơn hàng theo thời gian, chuẩn bị dữ liệu cho tìm kiếm nhị phân. Trong công việc thật, bạn gần như luôn gọi `sorted`. Nhưng học cách các thuật toán sắp xếp hoạt động dạy bạn hai tư duy quan trọng: đánh giá độ phức tạp, và **chia để trị**.

## Sắp xếp chèn: cách bạn xếp bài trên tay

Khi xếp bài, bạn cầm từng lá mới và **chèn** nó vào đúng vị trí giữa các lá đã xếp. Sắp xếp chèn làm y như vậy:

```python
def sap_xep_chen(a):
    a = a[:]                        # không sửa list gốc
    for i in range(1, len(a)):
        x = a[i]
        j = i - 1
        while j >= 0 and a[j] > x:  # dịch các phần tử lớn hơn x sang phải
            a[j + 1] = a[j]
            j -= 1
        a[j + 1] = x
    return a

print(sap_xep_chen([5, 2, 9, 1, 5]))   # [1, 2, 5, 5, 9]
```

Ở trường hợp xấu nhất, khi mảng sắp xếp ngược, lá thứ `i` phải dịch qua `i` lá trước nó: tổng `1 + 2 + … + (n-1) ≈ n²/2` bước, tức `O(n²)`. Nhưng với mảng **gần như đã sắp xếp**, vòng `while` gần như không chạy và thuật toán chỉ còn `O(n)`. Đó là lý do sắp xếp chèn vẫn được dùng trong thực tế cho mảng nhỏ, kể cả bên trong thuật toán sắp xếp của Python.

Các thuật toán `O(n²)` khác bạn có thể gặp là sắp xếp nổi bọt và sắp xếp chọn. Chúng hữu ích để học, nhưng với một triệu phần tử, `n²` là một nghìn tỷ bước: không dùng được.

## Sắp xếp trộn: chia để trị

Ý tưởng **chia để trị** (divide and conquer) gồm ba bước:

1. **Chia**: cắt mảng làm hai nửa.
2. **Trị**: sắp xếp từng nửa (bằng chính thuật toán này, tức đệ quy).
3. **Kết hợp**: **trộn** hai nửa đã sắp xếp thành một mảng sắp xếp.

Bước trộn là chìa khóa. Hai mảng đã sắp xếp có thể trộn trong `O(n)` bằng hai con trỏ: liên tục so sánh hai phần tử đầu và lấy phần tử nhỏ hơn.

```python
def tron(trai, phai):
    ket_qua = []
    i = j = 0
    while i < len(trai) and j < len(phai):
        if trai[i] <= phai[j]:         # <= giữ tính ổn định
            ket_qua.append(trai[i]); i += 1
        else:
            ket_qua.append(phai[j]); j += 1
    ket_qua.extend(trai[i:])
    ket_qua.extend(phai[j:])
    return ket_qua

def sap_xep_tron(a):
    if len(a) <= 1:
        return a
    giua = len(a) // 2
    return tron(sap_xep_tron(a[:giua]), sap_xep_tron(a[giua:]))

print(sap_xep_tron([38, 27, 43, 3, 9, 82, 10]))   # [3, 9, 10, 27, 38, 43, 82]
```

Phân tích: mảng bị chia đôi liên tục cho tới khi còn một phần tử, tạo ra khoảng `log₂ n` **tầng**. Ở mỗi tầng, tổng công việc trộn của mọi đoạn là `O(n)`. Tổng cộng `O(n log n)`. Với một triệu phần tử, `n log n` khoảng 20 triệu, so với một nghìn tỷ của `O(n²)`.

Người ta đã chứng minh được rằng mọi thuật toán sắp xếp **chỉ dựa trên so sánh** đều cần ít nhất cỡ `n log n` phép so sánh trong trường hợp xấu. Vậy sắp xếp trộn đã tối ưu về mặt độ phức tạp.

## Thuật toán của Python

`sorted` và `list.sort` dùng **Timsort**, một thuật toán lai giữa sắp xếp trộn và sắp xếp chèn. Nó tìm các đoạn **đã sắp xếp sẵn** trong dữ liệu thật (dữ liệu ngoài đời thường có những đoạn như vậy) rồi trộn chúng lại. Kết quả là `O(n log n)` trong trường hợp xấu và gần `O(n)` với dữ liệu gần như đã sắp xếp.

## Tính ổn định và sắp xếp nhiều tiêu chí

Một thuật toán sắp xếp **ổn định** giữ nguyên thứ tự tương đối của các phần tử bằng nhau. Timsort ổn định, và điều đó cho phép sắp xếp nhiều tiêu chí theo hai cách:

```python
hoc_sinh = [("An", "10A", 8), ("Bình", "10B", 9), ("Chi", "10A", 9), ("Dũng", "10B", 8)]

# Cách 1: key trả về tuple. Điểm giảm dần, cùng điểm thì tên tăng dần
print(sorted(hoc_sinh, key=lambda h: (-h[2], h[0])))

# Cách 2: sắp xếp nhiều lần, tiêu chí PHỤ trước, tiêu chí CHÍNH sau
theo_ten = sorted(hoc_sinh, key=lambda h: h[0])
theo_lop = sorted(theo_ten, key=lambda h: h[1])   # cùng lớp vẫn giữ thứ tự tên
print(theo_lop)
```

Cách 2 đúng **chỉ vì** sắp xếp ổn định: khi sắp theo lớp, những học sinh cùng lớp giữ nguyên thứ tự theo tên của lần sắp trước. Cách 1 thường gọn hơn. Cách 2 hữu ích khi một tiêu chí không đảo dấu được, ví dụ cần chuỗi giảm dần.

## Khi giá trị nhỏ: sắp xếp đếm

Giới hạn `n log n` chỉ áp dụng cho thuật toán **dựa trên so sánh**. Nếu biết các giá trị nằm trong một khoảng nhỏ, ta làm nhanh hơn được bằng cách **đếm** thay vì so sánh. Ví dụ sắp xếp điểm thi là số nguyên từ 0 tới 10:

```python
def sap_xep_dem(diem, lon_nhat=10):
    dem = [0] * (lon_nhat + 1)
    for d in diem:
        dem[d] += 1
    ket_qua = []
    for gia_tri, so_lan in enumerate(dem):
        ket_qua.extend([gia_tri] * so_lan)
    return ket_qua

print(sap_xep_dem([7, 3, 10, 3, 0, 7, 7]))   # [0, 3, 3, 7, 7, 7, 10]
```

Chi phí là `O(n + k)` với `k` là độ rộng khoảng giá trị. Với một triệu điểm thi trong khoảng 0–10, đây là thuật toán nhanh nhất có thể. Nhưng nếu giá trị trải từ 0 tới một tỷ, mảng đếm sẽ cần một tỷ ô, và lựa chọn này trở nên vô lý. Không có thuật toán sắp xếp tốt nhất cho mọi trường hợp; có thuật toán phù hợp với dữ liệu của bạn.

## Lỗi thường gặp

- **Tự viết sắp xếp `O(n²)`** cho dữ liệu lớn khi `sorted` có sẵn.
- **So sánh `<` thay vì `<=`** trong bước trộn: thuật toán mất tính ổn định.
- **Sắp xếp nhiều lần theo sai thứ tự**: tiêu chí phụ phải sắp **trước**.
- **Sắp xếp lại trong vòng lặp**: gọi `sorted` mỗi lượt biến `O(n log n)` thành `O(n² log n)`.

## Tóm tắt

- Sắp xếp chèn `O(n²)` nhưng nhanh với mảng nhỏ hoặc gần như đã sắp xếp.
- Sắp xếp trộn chia để trị: chia đôi, sắp từng nửa, trộn trong `O(n)`, tổng `O(n log n)`.
- `sorted` dùng Timsort: ổn định, `O(n log n)`.
- Sắp xếp nhiều tiêu chí bằng `key` trả về tuple, hoặc sắp nhiều lần nhờ tính ổn định.

## Tự kiểm tra

1. Đếm số lần dịch phần tử khi sắp xếp chèn mảng `[4, 3, 2, 1]`.
2. Sắp xếp danh sách từ theo độ dài **giảm dần**, cùng độ dài thì theo thứ tự chữ cái **tăng dần**.
