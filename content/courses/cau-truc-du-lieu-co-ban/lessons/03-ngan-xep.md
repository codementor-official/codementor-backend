---
title: Ngăn xếp (stack)
summary: Cấu trúc vào sau ra trước, cài đặt bằng list trong O(1), và ba bài toán kinh điển mà ngăn xếp giải gọn — kiểm tra ngoặc, hoàn tác, và ngăn xếp gọi hàm của chính chương trình.
objectives:
  - Mô tả nguyên tắc LIFO và các thao tác push, pop, peek
  - Cài đặt ngăn xếp bằng list với mọi thao tác O(1)
  - Nhận ra bài toán có cấu trúc lồng nhau và giải bằng ngăn xếp
minutes: 25
---

Hãy nghĩ tới chồng đĩa trong bếp: bạn đặt đĩa mới lên **trên cùng**, và cũng lấy đĩa từ **trên cùng**. Chiếc đĩa đặt vào sau cùng được lấy ra đầu tiên. Đó chính là **ngăn xếp** (stack), với nguyên tắc *vào sau, ra trước* (LIFO: Last In, First Out).

![Chồng tài liệu xếp lên nhau: tờ đặt vào sau cùng nằm trên đỉnh và được lấy ra trước](illustration:documents)

## Các thao tác

Một ngăn xếp chỉ cho phép thao tác ở **đỉnh**:

- `push(x)`: đặt `x` lên đỉnh.
- `pop()`: lấy phần tử ở đỉnh ra.
- `peek()`: xem phần tử ở đỉnh mà không lấy ra.
- `is_empty()`: kiểm tra rỗng.

Giới hạn này nghe như một khuyết điểm, nhưng chính nó làm ngăn xếp hữu ích: khi bạn dùng ngăn xếp, người đọc code biết ngay dữ liệu được xử lý theo thứ tự ngược với thứ tự đến.

## Cài đặt bằng list

Ở bài trước ta biết `append` và `pop()` ở **cuối** list đều `O(1)`. Vậy chỉ cần coi cuối list là đỉnh ngăn xếp:

```python
stack = []
stack.append("a")      # push
stack.append("b")
stack.append("c")
print(stack[-1])       # peek → c
print(stack.pop())     # pop  → c
print(stack.pop())     # pop  → b
print(len(stack) == 0) # False, còn "a"
```

Đừng coi **đầu** list là đỉnh: `insert(0, x)` và `pop(0)` đều `O(n)`.

Nếu muốn code tự giải thích hơn, bạn có thể bọc lại trong một lớp nhỏ:

```python
class Stack:
    def __init__(self):
        self._items = []

    def push(self, x):
        self._items.append(x)

    def pop(self):
        if not self._items:
            raise IndexError("pop từ ngăn xếp rỗng")
        return self._items.pop()

    def peek(self):
        return self._items[-1] if self._items else None

    def __len__(self):
        return len(self._items)
```

## Bài toán kinh điển: kiểm tra ngoặc

Cho biểu thức có ba loại ngoặc `( ) [ ] { }`. Các ngoặc có đóng mở đúng không?

Quan sát then chốt: khi gặp một ngoặc đóng, nó phải khớp với ngoặc mở **gần nhất chưa được đóng**. "Gần nhất chưa được xử lý" chính là đỉnh ngăn xếp.

```python
def can_bang(s):
    cap = {")": "(", "]": "[", "}": "{"}
    stack = []
    for ch in s:
        if ch in "([{":
            stack.append(ch)
        elif ch in cap:
            if not stack or stack.pop() != cap[ch]:
                return False
    return not stack     # còn ngoặc mở chưa đóng thì sai

print(can_bang("a*(b+[c-d])"))   # True
print(can_bang("([)]"))          # False
print(can_bang("(("))            # False
```

Ba cách sai đều được bắt: ngoặc đóng khi ngăn xếp rỗng, ngoặc đóng khác loại với đỉnh, và còn ngoặc mở khi đã duyệt hết. Mỗi ký tự được đẩy vào và lấy ra nhiều nhất một lần, nên thuật toán là `O(n)`.

Bài tập của chương yêu cầu thêm một điều: báo **vị trí** gây lỗi. Gợi ý: đẩy vào ngăn xếp cặp `(ký_tự, vị_trí)` thay vì chỉ ký tự.

## Ngăn xếp ở khắp nơi

**Hoàn tác (Undo)**: mỗi thao tác chỉnh sửa được đẩy vào ngăn xếp. Bấm Undo là lấy thao tác gần nhất ra và đảo ngược nó. Chức năng Redo dùng ngăn xếp thứ hai.

**Nút Back của trình duyệt**: mỗi trang mới mở được đẩy vào ngăn xếp lịch sử, bấm Back là lấy ra.

**Ngăn xếp gọi hàm**: khi hàm `A` gọi hàm `B`, máy lưu "đang ở đâu trong `A`" lên một ngăn xếp, chạy `B`, rồi lấy ra để quay về `A` đúng chỗ. Đệ quy hoạt động nhờ ngăn xếp này. Đệ quy quá sâu làm tràn nó, và Python báo `RecursionError` khi vượt khoảng 1000 tầng.

```python
def dem_xuong(n):
    if n == 0:
        return
    dem_xuong(n - 1)

dem_xuong(500)        # được
# dem_xuong(5000)     # RecursionError: maximum recursion depth exceeded
```

Hiểu điều này giúp bạn một mẹo quan trọng: **mọi thuật toán đệ quy đều có thể viết lại bằng vòng lặp và một ngăn xếp tự quản lý**. Đây là cách xử lý khi dữ liệu có thể sâu hàng nghìn tầng, như cây suy biến ở cuối khóa.

## Ví dụ thực hành: tính biểu thức hậu tố

Biểu thức hậu tố (ký pháp Ba Lan ngược) đặt toán tử **sau** toán hạng: `3 4 + 2 *` nghĩa là `(3 + 4) * 2`. Máy tính rất thích dạng này vì tính được bằng một ngăn xếp, không cần quan tâm ngoặc hay độ ưu tiên:

```python
def tinh_hau_to(bieu_thuc):
    stack = []
    for token in bieu_thuc.split():
        if token in "+-*/":
            b = stack.pop()
            a = stack.pop()
            if token == "+": stack.append(a + b)
            elif token == "-": stack.append(a - b)
            elif token == "*": stack.append(a * b)
            else: stack.append(a // b)
        else:
            stack.append(int(token))
    return stack.pop()

print(tinh_hau_to("3 4 + 2 *"))   # 14
```

Chú ý thứ tự lấy ra: phần tử lấy ra **trước** là toán hạng **phải** (`b`). Đảo nhầm thứ tự này làm `5 2 -` ra `-3` thay vì `3`.

## Ngăn xếp đơn điệu

Một biến thể rất hay gặp trong bài toán thực tế: với mỗi ngày trong dãy giá cổ phiếu, tìm **ngày gần nhất phía sau có giá cao hơn**. Thử mọi cặp là `O(n²)`. Ngăn xếp cho lời giải `O(n)`: giữ trong ngăn xếp các ngày **chưa tìm được** đáp án, và giá của chúng luôn giảm dần từ đáy lên đỉnh.

```python
def ngay_cao_hon_ke_tiep(gia):
    ket_qua = [-1] * len(gia)
    stack = []                       # chỉ số các ngày chưa có đáp án
    for i, g in enumerate(gia):
        while stack and gia[stack[-1]] < g:
            ket_qua[stack.pop()] = i # ngày i là đáp án của ngày ở đỉnh
        stack.append(i)
    return ket_qua

print(ngay_cao_hon_ke_tiep([73, 74, 75, 71, 69, 72, 76]))   # [1, 2, 6, 5, 5, 6, -1]
```

Mỗi chỉ số được đẩy vào một lần và lấy ra nhiều nhất một lần, nên dù có vòng `while` lồng trong `for`, tổng số thao tác vẫn là `O(n)`. Đây là ví dụ tốt cho thấy "hai vòng lặp lồng nhau" không tự động có nghĩa là `O(n²)`: hãy đếm tổng số lần mỗi phần tử được xử lý.

## Lỗi thường gặp

- **pop khi ngăn xếp rỗng**: luôn kiểm tra trước, hoặc xem đó là tín hiệu dữ liệu sai như trong bài kiểm tra ngoặc.
- **Quên kiểm tra ngăn xếp còn sót phần tử** sau khi duyệt xong.
- **Dùng đầu list làm đỉnh**: mất tính `O(1)`.
- **Đệ quy quá sâu**: chuyển sang vòng lặp với ngăn xếp tự quản.

## Tóm tắt

- Ngăn xếp là LIFO; mọi thao tác chỉ ở đỉnh.
- Dùng cuối list làm đỉnh: `append`/`pop`/`[-1]` đều `O(1)`.
- Bài toán có cấu trúc lồng nhau (ngoặc, thẻ HTML, hoàn tác) thường giải bằng ngăn xếp.
- Đệ quy dựa trên ngăn xếp gọi hàm; khi quá sâu, thay bằng ngăn xếp tự quản lý.

## Tự kiểm tra

1. Dùng ngăn xếp để đảo ngược một chuỗi. Độ phức tạp là bao nhiêu?
2. Tính tay biểu thức hậu tố `5 1 2 + 4 * + 3 -`.
