---
title: Độ phức tạp thuật toán và ký hiệu Big-O
summary: Vì sao "chạy đúng" chưa đủ — đo chi phí bằng số bước theo kích thước dữ liệu, đọc ký hiệu O(1), O(log n), O(n), O(n²) và ước lượng trước khi viết code.
objectives:
  - Giải thích vì sao đo thời gian bằng đồng hồ không đủ để so sánh thuật toán
  - Xác định độ phức tạp Big-O của các đoạn code có vòng lặp
  - Ước lượng một lời giải có chạy kịp với giới hạn dữ liệu của đề hay không
minutes: 25
preview: true
---

Hai lời giải cho cùng một bài toán có thể đều cho kết quả **đúng**, nhưng một cái trả lời trong nháy mắt còn cái kia chạy cả tiếng. Khóa học này bắt đầu bằng công cụ để phân biệt chúng **trước khi** chạy: phân tích độ phức tạp.

![Người đứng cạnh đồng hồ đo tốc độ: Big-O đo thời gian chạy tăng nhanh thế nào khi dữ liệu lớn dần](illustration:speed-test)

## Vì sao không chỉ bấm giờ

Cách tự nhiên nhất để biết chương trình nhanh hay chậm là chạy thử và bấm giờ. Nhưng con số đó phụ thuộc vào quá nhiều thứ không liên quan tới thuật toán: máy nhanh hay chậm, ngôn ngữ nào, lúc đó máy có đang bận việc khác không. Quan trọng hơn, nó chỉ cho biết thời gian với **một** bộ dữ liệu. Thứ ta thực sự cần biết là: khi dữ liệu lớn gấp 10, gấp 1000 lần thì thời gian tăng thế nào?

Vì vậy ta đếm **số bước cơ bản** (một phép so sánh, một phép cộng, một lần truy cập phần tử) theo kích thước dữ liệu, thường gọi là `n`.

## Đếm bước trong một ví dụ

Bài toán: cho mảng `n` số, có tồn tại hai số có tổng bằng `K` không?

```python
def co_cap_tong_k_cach_1(a, k):
    n = len(a)
    for i in range(n):
        for j in range(i + 1, n):
            if a[i] + a[j] == k:
                return True
    return False
```

Vòng ngoài chạy `n` lần; với mỗi `i`, vòng trong chạy `n - i - 1` lần. Tổng số phép so sánh trong trường hợp xấu nhất là khoảng `n²/2`. Với `n = 10.000`, đó là 50 triệu phép so sánh. Với `n = 1.000.000`, con số là 500 tỷ — vài giờ chạy.

Nếu mảng đã được sắp xếp, có cách tốt hơn nhiều:

```python
def co_cap_tong_k_cach_2(a, k):   # a đã sắp xếp tăng dần
    trai, phai = 0, len(a) - 1
    while trai < phai:
        tong = a[trai] + a[phai]
        if tong == k:
            return True
        if tong < k:
            trai += 1
        else:
            phai -= 1
    return False
```

Mỗi lượt lặp, hoặc `trai` tăng hoặc `phai` giảm, nên tổng số lượt không quá `n`. Với một triệu phần tử, đó là một triệu bước — một phần nhỏ của giây.

## Ký hiệu Big-O

Ta không quan tâm tới hằng số chính xác (`n²/2` hay `3n²`) mà chỉ quan tâm **dạng tăng trưởng** khi `n` lớn. Ký hiệu Big-O diễn đạt đúng điều đó: cách 1 là `O(n²)`, cách 2 là `O(n)`.

Quy tắc rút gọn:

- Bỏ hằng số nhân: `3n` là `O(n)`.
- Chỉ giữ số hạng tăng nhanh nhất: `n² + 100n + 5000` là `O(n²)`, vì khi `n` lớn, `n²` lấn át mọi thứ.

Các lớp độ phức tạp bạn sẽ gặp nhiều nhất, xếp từ nhanh tới chậm:

- `O(1)`: hằng số, không phụ thuộc `n`. Ví dụ truy cập `a[i]`, tra cứu trong `dict`.
- `O(log n)`: mỗi bước loại bỏ một nửa dữ liệu, như tìm kiếm nhị phân. Với một tỷ phần tử chỉ cần khoảng 30 bước.
- `O(n)`: duyệt qua dữ liệu một lần.
- `O(n log n)`: các thuật toán sắp xếp tốt như sắp xếp trộn, hay `sorted` của Python.
- `O(n²)`: hai vòng lặp lồng nhau trên cùng dữ liệu.
- `O(2^n)`: thử mọi tập con. Chỉ dùng được với `n` rất nhỏ, khoảng dưới 25.

## Ước lượng trước khi viết code

Một quy tắc thực hành hữu ích: máy tính thông thường làm được khoảng **10^7 tới 10^8 bước đơn giản mỗi giây** với C++, và ít hơn vài chục lần với Python. Ghép giới hạn của đề vào độ phức tạp, bạn biết ngay lời giải có khả thi không:

- `n ≤ 20`: `O(2^n)` vẫn được.
- `n ≤ 5.000`: `O(n²)` là khoảng 25 triệu bước, ổn với C++, sát giới hạn với Python.
- `n ≤ 200.000`: cần `O(n log n)` hoặc `O(n)`.
- `n ≤ 10^9`: chỉ còn `O(log n)` hoặc `O(1)`, nghĩa là phải có công thức.

Đọc giới hạn dữ liệu **trước** khi nghĩ lời giải là thói quen của mọi lập trình viên giỏi giải thuật. Nó cho bạn biết ngay lời giải cần nhắm tới độ phức tạp nào.

## Độ phức tạp của thao tác có sẵn

Một dòng code Python không phải lúc nào cũng là `O(1)`. Bạn cần biết chi phí của những thao tác hay dùng:

```python
a = list(range(1_000_000))
a.append(5)        # O(1)
a[500_000]         # O(1)
5 in a             # O(n): phải duyệt
a.insert(0, 5)     # O(n): dịch mọi phần tử
a.pop(0)           # O(n)
sorted(a)          # O(n log n)

s = set(a)
5 in s             # O(1) trung bình
```

Rất nhiều lời giải "đúng nhưng chậm" có vòng lặp `O(n)` bên ngoài và một thao tác `O(n)` ẩn bên trong, như `x in list` hay `list.pop(0)`, khiến tổng thành `O(n²)` mà người viết không nhận ra.

## Bộ nhớ cũng là chi phí

Big-O cũng dùng để đo **bộ nhớ**. Cách 2 ở trên chỉ dùng thêm hai biến, nên bộ nhớ là `O(1)`. Một lời giải dùng `set` lưu mọi phần tử đã gặp tốn thêm `O(n)` bộ nhớ. Thường ta chấp nhận đánh đổi bộ nhớ lấy thời gian, nhưng hãy làm điều đó một cách có ý thức.

## Lỗi thường gặp

- **Chỉ thử với dữ liệu nhỏ**: lời giải `O(n²)` chạy tức thì với 100 phần tử, rồi quá thời gian với 100.000.
- **Bỏ qua chi phí ẩn**: `x in list`, `list.pop(0)`, nối chuỗi trong vòng lặp.
- **Nhầm vòng lặp lồng nhau luôn là O(n²)**: hai vòng lồng nhau trên hai mảng khác cỡ là `O(n·m)`; vòng trong chạy số lần cố định là `O(n)`.
- **Tối ưu quá sớm**: với `n ≤ 1000`, lời giải `O(n²)` rõ ràng thường tốt hơn lời giải `O(n)` rắc rối.

## Tóm tắt

- Đo chi phí bằng số bước theo kích thước dữ liệu, không bằng đồng hồ.
- Big-O giữ dạng tăng trưởng, bỏ hằng số và số hạng nhỏ.
- `O(1) < O(log n) < O(n) < O(n log n) < O(n²) < O(2^n)`.
- Đọc giới hạn của đề để biết cần độ phức tạp nào; để ý chi phí ẩn của thao tác có sẵn.

## Tự kiểm tra

1. Đoạn code có vòng `for i in range(n)` bên ngoài, bên trong là `while j < 10: j += 1`. Độ phức tạp là gì?
2. Đề cho `n ≤ 10^5`. Lời giải `O(n²)` viết bằng Python có chạy kịp trong 1 giây không? Vì sao?
