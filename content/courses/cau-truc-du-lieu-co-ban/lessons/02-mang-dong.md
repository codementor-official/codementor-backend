---
title: Mảng và mảng động
summary: Mảng lưu phần tử liền nhau trong bộ nhớ nên truy cập theo chỉ số là O(1); mảng động (list của Python) tự lớn lên nhờ cấp phát gấp đôi, và vì sao chèn ở đầu lại đắt.
objectives:
  - Giải thích vì sao truy cập theo chỉ số trong mảng là O(1)
  - Mô tả cách mảng động tăng kích thước và chi phí khấu hao của append
  - Chọn thao tác trên list phù hợp để tránh chi phí O(n) ẩn
minutes: 25
---

Mảng là cấu trúc dữ liệu cơ bản nhất, và `list` của Python là thứ bạn đã dùng hàng ngày. Bài này nhìn vào bên trong nó để hiểu **vì sao** một số thao tác nhanh còn một số thao tác chậm. Hiểu điều đó, bạn sẽ chọn đúng cấu trúc dữ liệu trong các bài sau.

## Mảng: các ô liền nhau

Bộ nhớ máy tính giống một dãy ô rất dài, mỗi ô có một địa chỉ. Một **mảng** chiếm một đoạn ô **liền nhau**, mỗi phần tử một ô cùng kích thước.

Nhờ vậy, muốn lấy phần tử thứ `i`, máy chỉ cần một phép tính:

```text
địa chỉ(a[i]) = địa chỉ bắt đầu + i × kích thước một phần tử
```

Không cần duyệt từ đầu, không phụ thuộc mảng dài bao nhiêu: truy cập theo chỉ số là `O(1)`. Đây là siêu năng lực của mảng, và là lý do mảng có mặt ở khắp nơi.

Cái giá phải trả là tính **liền nhau**. Muốn chèn một phần tử vào giữa, ta phải dịch mọi phần tử phía sau sang phải một ô để lấy chỗ:

```python
a = [10, 20, 30, 40, 50]
a.insert(1, 15)    # 20, 30, 40, 50 đều phải dịch sang phải
print(a)           # [10, 15, 20, 30, 40, 50]
```

Chèn hay xóa ở vị trí `i` tốn `O(n - i)` bước: rẻ ở cuối mảng, đắt nhất ở đầu mảng.

## Mảng động: list tự lớn lên thế nào

Mảng "thuần" có kích thước cố định ngay khi tạo. Nhưng `list` của Python lại thêm phần tử thoải mái bằng `append`. Bí mật là **mảng động**: Python cấp phát sẵn một mảng **rộng hơn** số phần tử hiện có. `append` chỉ việc ghi vào ô trống tiếp theo, `O(1)`.

Khi hết ô trống, Python cấp phát một mảng mới **lớn hơn khoảng 1,125 tới 2 lần** (tùy cài đặt), chép toàn bộ phần tử sang, rồi bỏ mảng cũ. Lần `append` đó tốn `O(n)`.

Nghe có vẻ tệ, nhưng hãy đếm tổng chi phí khi `append` liên tiếp `n` phần tử với chiến lược gấp đôi: các lần chép xảy ra ở kích thước 1, 2, 4, 8, … tới `n`, tổng cộng khoảng `2n` lần chép. Chia đều cho `n` lần `append`, mỗi lần chỉ tốn trung bình `O(1)`. Ta gọi đây là chi phí **khấu hao** (amortized) `O(1)`.

Bạn có thể quan sát việc cấp phát dư này trực tiếp:

```python
import sys

a = []
truoc = sys.getsizeof(a)
for i in range(20):
    a.append(i)
    sau = sys.getsizeof(a)
    if sau != truoc:
        print(f"len={len(a):2d}: cấp phát lại, {sau} byte")
        truoc = sau
```

Kích thước bộ nhớ chỉ thay đổi ở vài mốc, không thay đổi sau mỗi lần `append`. Giữa các mốc, `append` chỉ ghi vào chỗ trống đã có sẵn.

## Bảng chi phí của list

- `a[i]`, `a[i] = x`, `len(a)`: `O(1)`.
- `a.append(x)`, `a.pop()`: `O(1)` khấu hao.
- `a.insert(i, x)`, `a.pop(i)`, `del a[i]`: `O(n - i)`, tức `O(n)` ở đầu mảng.
- `x in a`, `a.index(x)`, `a.count(x)`: `O(n)`.
- `a[i:j]`: `O(j - i)`, vì tạo một list mới.
- `a.sort()`: `O(n log n)`.

## Kỹ thuật hai con trỏ

Mảng đã sắp xếp mở ra một kỹ thuật rất mạnh: dùng **hai chỉ số** di chuyển có quy tắc để tránh thử mọi cặp. Ví dụ bài toán "đếm số cặp có tổng bằng K" trên mảng tăng dần:

```python
def dem_cap(a, k):
    trai, phai, dem = 0, len(a) - 1, 0
    while trai < phai:
        s = a[trai] + a[phai]
        if s < k:
            trai += 1          # tổng nhỏ quá: cần số lớn hơn ở bên trái
        elif s > k:
            phai -= 1          # tổng lớn quá: cần số nhỏ hơn ở bên phải
        else:
            dem += 1
            trai += 1
            phai -= 1
    return dem

print(dem_cap([1, 2, 3, 4, 5], 6))   # 2: (1, 5) và (2, 4)
```

Lập luận đúng đắn nằm ở dòng `trai += 1` khi tổng nhỏ hơn `K`: vì `a[phai]` đã là số lớn nhất còn lại mà vẫn chưa đủ, nên `a[trai]` không thể ghép cặp với bất kỳ số nào để đạt `K`, có thể bỏ nó đi một cách an toàn. Mỗi bước loại được một phần tử, tổng cộng `O(n)`.

Phiên bản trên giả định các phần tử phân biệt. Khi có phần tử trùng nhau, một cặp vị trí `(trai, phai)` có thể đại diện cho nhiều cặp chỉ số khác nhau. Bài tập của chương này yêu cầu bạn xử lý đúng trường hợp đó.

## Lỗi thường gặp

- **Dùng `insert(0, x)` hoặc `pop(0)` trong vòng lặp lớn**: biến lời giải `O(n)` thành `O(n²)`. Bài sau sẽ giới thiệu `deque` cho trường hợp này.
- **Cắt list trong vòng lặp**: `a[1:]` tạo một bản sao mới mỗi lần. Đệ quy kiểu `f(a[1:])` âm thầm tốn `O(n²)`.
- **Quên điều kiện "đã sắp xếp"** khi áp dụng hai con trỏ: thuật toán sai mà không báo lỗi.
- **Lệch chỉ số khi xử lý phần tử trùng**: luôn thử mảng có tất cả phần tử bằng nhau.

## Tóm tắt

- Mảng lưu liền nhau nên truy cập theo chỉ số là `O(1)`, nhưng chèn hay xóa ở giữa là `O(n)`.
- Mảng động cấp phát dư và mở rộng theo cấp số nhân, nên `append` là `O(1)` khấu hao.
- Biết bảng chi phí của list để tránh `O(n)` ẩn trong vòng lặp.
- Hai con trỏ trên mảng đã sắp xếp biến nhiều bài `O(n²)` thành `O(n)`.

## Tự kiểm tra

1. Vì sao `a.pop()` là `O(1)` còn `a.pop(0)` là `O(n)`?
2. Trong kỹ thuật hai con trỏ, nếu `a[trai] + a[phai] > K`, vì sao bỏ `a[phai]` là an toàn?
