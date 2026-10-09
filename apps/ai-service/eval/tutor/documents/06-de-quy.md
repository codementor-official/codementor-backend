# Đệ quy

## Hàm đệ quy là gì

Hàm đệ quy là hàm gọi lại chính nó để giải một bài toán con nhỏ hơn cùng dạng. Mọi hàm đệ quy cần hai phần: **trường hợp cơ sở** (dừng, không gọi lại) và **bước đệ quy** (gọi lại với đầu vào nhỏ hơn và tiến dần về trường hợp cơ sở).

## Ví dụ: giai thừa

```python
def giai_thua(n):
    if n <= 1:
        return 1
    return n * giai_thua(n - 1)
```

Thiếu trường hợp cơ sở, hoặc bước đệ quy không làm bài toán nhỏ đi, hàm sẽ gọi mãi đến khi tràn ngăn xếp.

## Giới hạn độ sâu đệ quy

Python giới hạn độ sâu đệ quy mặc định là **1000** lời gọi. Vượt quá sẽ ném `RecursionError: maximum recursion depth exceeded`. Xem giới hạn bằng `sys.getrecursionlimit()` và đổi bằng `sys.setrecursionlimit(n)`.

Tăng giới hạn quá cao có thể làm tiến trình Python bị sập vì tràn ngăn xếp của hệ điều hành. Với độ sâu lớn (ví dụ duyệt đồ thị 100 000 đỉnh), nên chuyển sang vòng lặp với ngăn xếp tự quản lý.

Python **không** tối ưu đệ quy đuôi (tail call optimization), nên viết đệ quy đuôi cũng không tránh được giới hạn trên.

## Fibonacci và ghi nhớ

Cài đặt ngây thơ `fib(n) = fib(n-1) + fib(n-2)` có độ phức tạp O(2^n) vì tính lại cùng một bài toán con rất nhiều lần. Thêm `@functools.lru_cache(maxsize=None)` phía trên hàm biến nó thành O(n): mỗi giá trị chỉ tính một lần rồi được lấy lại từ bộ nhớ đệm.

Kỹ thuật này gọi là **memoization** (ghi nhớ), là dạng "từ trên xuống" của quy hoạch động.

## Đệ quy hay vòng lặp

Đệ quy hợp với dữ liệu có cấu trúc đệ quy: cây thư mục, cây nhị phân, chia để trị như merge sort. Với dãy tuyến tính đơn giản, vòng lặp thường nhanh hơn và không lo giới hạn độ sâu.

## Bài tập tuần 4 của nhóm

Bài "Tháp Hà Nội" tuần 4 yêu cầu in số bước di chuyển tối thiểu: với n đĩa là 2^n − 1 bước. Bài nộp phải dùng đệ quy, không được dùng công thức trực tiếp.
