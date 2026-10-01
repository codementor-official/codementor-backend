---
title: Vòng lặp for và while
summary: Lặp lại công việc mà không chép code — for với range và danh sách, while với điều kiện dừng, break/continue và cách tránh vòng lặp vô hạn.
objectives:
  - Dùng for với range để lặp một số lần xác định
  - Dùng while khi chỉ biết điều kiện dừng
  - Điều khiển vòng lặp bằng break, continue và nhận biết vòng lặp vô hạn
minutes: 25
---

Giả sử bạn cần tính tổng các số từ 1 tới 100. Viết 100 phép cộng là điều không ai muốn làm. Máy tính sinh ra để làm việc lặp lại, và vòng lặp là cách bạn ra lệnh cho nó.

![Danh sách phát đang lặp lại: vòng lặp chạy cùng một khối lệnh nhiều lần](illustration:playlist)

## Vòng lặp for với range

`for` lặp qua **từng phần tử** của một dãy. Hàm `range` tạo ra dãy số:

```python
for i in range(5):
    print(i)          # 0 1 2 3 4 (mỗi số một dòng)

tong = 0
for i in range(1, 101):
    tong += i
print(tong)           # 5050
```

Ba dạng của `range`:

- `range(n)`: từ `0` tới `n - 1`, tổng cộng `n` số.
- `range(a, b)`: từ `a` tới `b - 1`. Đầu mút `b` **không** được tính.
- `range(a, b, buoc)`: nhảy theo `buoc`; bước âm để đếm ngược, ví dụ `range(10, 0, -2)` cho `10 8 6 4 2`.

Quy ước "không tính đầu mút cuối" thoạt đầu có vẻ lạ, nhưng nó giúp `range(n)` có đúng `n` phần tử, và `range(0, 5)` nối với `range(5, 10)` liền mạch không trùng lặp.

`for` không chỉ dùng với số. Nó lặp được qua chuỗi, danh sách và nhiều kiểu khác:

```python
for ky_tu in "Hello":
    print(ky_tu, end=" ")   # H e l l o

for ten in ["An", "Bình", "Chi"]:
    print("Chào", ten)
```

## Mẫu "biến tích lũy"

Phần lớn vòng lặp tính toán đều theo một khuôn: khởi tạo một biến **trước** vòng lặp, cập nhật nó **trong** vòng lặp, dùng kết quả **sau** vòng lặp.

```python
n = int(input())
dem_chan = 0
lon_nhat = None
for _ in range(n):
    x = int(input())
    if x % 2 == 0:
        dem_chan += 1
    if lon_nhat is None or x > lon_nhat:
        lon_nhat = x
print(dem_chan, lon_nhat)
```

Dấu gạch dưới `_` là tên biến quy ước khi bạn **không dùng** đến giá trị của biến lặp. Khởi tạo `lon_nhat = None` thay vì `0` để chương trình vẫn đúng khi mọi số đều âm.

## Vòng lặp while

`while` lặp **chừng nào** điều kiện còn đúng. Dùng nó khi bạn không biết trước số lần lặp:

```python
n = int(input())
so_chu_so = 0
while n > 0:
    so_chu_so += 1
    n //= 10
print(so_chu_so)
```

Mỗi lượt lặp bỏ đi một chữ số cuối của `n` cho tới khi `n` bằng 0. Đây là kỹ thuật tách chữ số bạn sẽ dùng trong bài tập của chương này. Nhưng hãy để ý: với `n = 0`, điều kiện `n > 0` sai ngay từ đầu, vòng lặp không chạy lần nào, và chương trình in `0` thay vì `1`. Luôn tự hỏi: **trường hợp nhỏ nhất** có đi qua vòng lặp đúng không?

## break và continue

- `break` thoát khỏi vòng lặp ngay lập tức.
- `continue` bỏ qua phần còn lại của lượt hiện tại, chuyển sang lượt tiếp theo.

```python
# Tìm số chia hết cho 7 đầu tiên lớn hơn 100
n = 101
while True:
    if n % 7 == 0:
        break
    n += 1
print(n)   # 105

# In các số lẻ từ 1 tới 9
for i in range(10):
    if i % 2 == 0:
        continue
    print(i, end=" ")   # 1 3 5 7 9
```

Mẫu `while True` + `break` hữu ích khi điều kiện dừng nằm ở **giữa** thân vòng lặp chứ không ở đầu.

## Vòng lặp lồng nhau

Một vòng lặp có thể nằm trong vòng lặp khác. Vòng trong chạy trọn vẹn cho **mỗi** lượt của vòng ngoài:

```python
for hang in range(1, 4):
    for cot in range(1, 4):
        print(hang * cot, end="\t")
    print()
```

Kết quả là bảng cửu chương 3×3. Lưu ý chi phí: hai vòng lồng nhau, mỗi vòng `n` lần, thực hiện tổng cộng `n × n` lượt. Với `n = 100.000` đó là 10 tỷ lượt, chậm tới mức không chạy nổi. Bạn sẽ học cách đánh giá điều này kỹ hơn ở khóa Cấu trúc dữ liệu.

## Vòng lặp vô hạn

Nếu điều kiện của `while` không bao giờ sai, chương trình chạy mãi:

```python
i = 0
while i < 10:
    print(i)
    # quên i += 1  → in 0 mãi mãi
```

Trên trang luyện tập, hệ thống chấm sẽ dừng chương trình khi quá thời gian và báo lỗi **Quá thời gian**. Khi gặp lỗi này, việc đầu tiên là kiểm tra mọi vòng `while`: biến trong điều kiện có thực sự thay đổi sau mỗi lượt không?

## Ví dụ thực hành: tiết kiệm bao lâu thì đủ

Bạn gửi tiết kiệm 10 triệu đồng với lãi suất 6% mỗi năm, lãi nhập gốc. Sau bao nhiêu năm thì số tiền vượt 15 triệu đồng?

Ta không biết trước số năm, nên đây là việc của `while`: lặp **chừng nào** chưa đủ tiền, mỗi lượt cộng lãi của một năm và đếm thêm một năm.

```python
tien = 10_000_000
nam = 0
while tien < 15_000_000:
    tien = tien * 106 // 100   # cộng lãi 6%, làm tròn xuống đồng
    nam += 1
print(nam, tien)              # 7 15036301
```

Có ba điều đáng học từ đoạn code ngắn này. Thứ nhất, dấu gạch dưới trong `10_000_000` chỉ để dễ đọc, Python bỏ qua nó. Thứ hai, biến trong điều kiện (`tien`) **chắc chắn tăng** sau mỗi lượt, nên vòng lặp chắc chắn dừng; nếu lãi suất là 0 thì vòng lặp sẽ chạy mãi, và đó là trường hợp bạn nên tự kiểm tra trước. Thứ ba, ta tính bằng số nguyên để tránh sai số, cùng thói quen như ở bài trước.

## Lỗi thường gặp

- **Lệch một (off-by-one)**: dùng `range(1, n)` khi cần cả số `n`. Muốn tính tới `n` thì viết `range(1, n + 1)`.
- **Khởi tạo biến tích lũy bên trong vòng lặp**: `tong = 0` đặt trong thân `for` sẽ reset tổng ở mỗi lượt.
- **Sửa danh sách khi đang lặp qua chính nó**: xóa phần tử trong lúc `for` duyệt danh sách đó sẽ bỏ sót phần tử. Hãy tạo danh sách mới.
- **Quên trường hợp biên**: số 0, danh sách rỗng, chỉ một phần tử.

## Tóm tắt

- `for` lặp qua từng phần tử; `range(a, b)` không tính `b`.
- `while` lặp khi chưa biết số lần; luôn đảm bảo điều kiện sẽ có lúc sai.
- Mẫu tích lũy: khởi tạo trước, cập nhật trong, dùng sau vòng lặp.
- `break` thoát vòng lặp, `continue` sang lượt kế tiếp.

## Tự kiểm tra

1. Viết vòng lặp in các số từ 20 xuống 1, chỉ những số chia hết cho 3.
2. Đoạn `while n > 0: n //= 10` cần bao nhiêu lượt với `n = 1000`? Với `n = 0`?
