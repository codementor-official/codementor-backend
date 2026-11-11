# Hàm và đệ quy

## Định nghĩa hàm

Hàm được khai báo bằng `def`, nhận tham số và trả về giá trị bằng `return`. Hàm không có `return` trả về `None`.

```python
def binh_phuong(x):
    return x * x
```

Tham số có thể có giá trị mặc định. Không dùng đối tượng thay đổi được (list, dict) làm giá trị mặc định, vì giá trị mặc định chỉ được tạo **một lần** lúc định nghĩa hàm.

## Đệ quy

Hàm đệ quy là hàm gọi lại chính nó. Mỗi hàm đệ quy cần:

1. **Trường hợp cơ sở**: điểm dừng, không gọi đệ quy nữa.
2. **Bước đệ quy**: đưa bài toán về bài toán nhỏ hơn, tiến dần về trường hợp cơ sở.

```python
def giai_thua(n):
    if n <= 1:
        return 1
    return n * giai_thua(n - 1)
```

Python giới hạn độ sâu đệ quy, mặc định khoảng 1000 lời gọi. Vượt quá sẽ gây `RecursionError`. Với `n` lớn nên viết lại bằng vòng lặp hoặc dùng quy hoạch động.

## Gợi ý soạn bài tập

Bài đệ quy nên có test với `n = 0` hoặc `n = 1` (trường hợp cơ sở) và một test `n` vừa phải. Tránh test `n` quá lớn khiến lời giải đệ quy đúng vẫn bị `RecursionError`.
