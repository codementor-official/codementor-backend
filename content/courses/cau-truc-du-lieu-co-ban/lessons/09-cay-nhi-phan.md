---
title: Cây nhị phân và cây nhị phân tìm kiếm
summary: Thuật ngữ về cây, ba cách duyệt theo chiều sâu và duyệt theo tầng, cây nhị phân tìm kiếm với chèn/tìm O(chiều cao), và vì sao cây suy biến cần cân bằng.
objectives:
  - Dùng đúng các thuật ngữ gốc, lá, chiều cao, cây con
  - Cài đặt duyệt trước, giữa, sau bằng đệ quy và bằng ngăn xếp
  - Cài đặt chèn và tìm kiếm trên cây nhị phân tìm kiếm, phân tích theo chiều cao
minutes: 30
---

Mảng và danh sách liên kết sắp dữ liệu thành một hàng. Nhưng nhiều dữ liệu tự nhiên có cấu trúc **phân cấp**: thư mục chứa thư mục con, một trang web chứa các thẻ HTML lồng nhau, sơ đồ tổ chức của công ty. **Cây** là cấu trúc dữ liệu cho những thứ như vậy.

![Người trình bày một sơ đồ tổ chức phân cấp hình cây](illustration:hr-presentation)

## Thuật ngữ

- Cây gồm các **nút**; nút trên cùng là **gốc** (root).
- Mỗi nút có thể có các **con**; nút không có con là **lá**.
- Một nút cùng toàn bộ hậu duệ của nó tạo thành một **cây con**.
- **Chiều cao** của cây là số nút trên đường dài nhất từ gốc tới một lá (có tài liệu đếm theo số cạnh; hãy đọc kỹ định nghĩa của từng đề).

**Cây nhị phân** là cây mà mỗi nút có tối đa hai con, gọi là con **trái** và con **phải**.

```python
class Node:
    def __init__(self, key, left=None, right=None):
        self.key = key
        self.left = left
        self.right = right

#       8
#      / \
#     4   12
#    / \
#   2   6
goc = Node(8, Node(4, Node(2), Node(6)), Node(12))
```

## Duyệt cây theo chiều sâu

Có ba thứ tự thăm cơ bản, khác nhau ở chỗ thăm nút **trước, giữa hay sau** khi duyệt hai cây con:

```python
def truoc(n):   # nút → trái → phải
    if n:
        print(n.key, end=" "); truoc(n.left); truoc(n.right)

def giua(n):    # trái → nút → phải
    if n:
        giua(n.left); print(n.key, end=" "); giua(n.right)

def sau(n):     # trái → phải → nút
    if n:
        sau(n.left); sau(n.right); print(n.key, end=" ")

truoc(goc)   # 8 4 2 6 12
giua(goc)    # 2 4 6 8 12
sau(goc)     # 2 6 4 12 8
```

Mỗi thứ tự có ứng dụng riêng. Duyệt **trước** dùng để sao chép hay in cấu trúc cây, vì cha luôn xuất hiện trước con. Duyệt **sau** dùng để tính toán từ dưới lên, như dung lượng một thư mục bằng tổng dung lượng các thư mục con cộng chính nó. Duyệt **giữa** trên cây nhị phân tìm kiếm cho dãy khóa **đã sắp xếp**, như bạn sẽ thấy ngay dưới đây.

Chiều cao tính tự nhiên bằng đệ quy kiểu duyệt sau:

```python
def chieu_cao(n):
    if n is None:
        return 0
    return 1 + max(chieu_cao(n.left), chieu_cao(n.right))
```

## Cây nhị phân tìm kiếm

**Cây nhị phân tìm kiếm** (BST) thêm một quy tắc: với mọi nút, mọi khóa ở cây con **trái nhỏ hơn** nó, mọi khóa ở cây con **phải lớn hơn** nó. Cây ví dụ ở trên thỏa quy tắc này.

Quy tắc đó biến tìm kiếm thành một đường đi duy nhất từ gốc xuống, giống tìm kiếm nhị phân:

```python
def tim(n, key):
    while n is not None and n.key != key:
        n = n.left if key < n.key else n.right
    return n is not None

def chen(goc, key):
    if goc is None:
        return Node(key)
    n = goc
    while True:
        if key < n.key:
            if n.left is None:
                n.left = Node(key); break
            n = n.left
        else:
            if n.right is None:
                n.right = Node(key); break
            n = n.right
    return goc
```

Cả hai thao tác đi theo **một** đường từ gốc, nên chi phí là `O(h)` với `h` là chiều cao cây. Duyệt giữa luôn cho khóa tăng dần, vì với mọi nút, mọi thứ bên trái nhỏ hơn được in trước và mọi thứ bên phải lớn hơn được in sau.

## Vấn đề: cây suy biến

Chi phí `O(h)` chỉ tốt khi cây **cân bằng**: khi đó `h ≈ log₂ n`. Nhưng hình dạng cây phụ thuộc **thứ tự chèn**. Chèn `1, 2, 3, 4, 5` theo thứ tự tăng dần, mỗi khóa mới đều lớn hơn mọi khóa cũ nên luôn đi sang phải. Cây thành một "dây xích" cao `n`, và tìm kiếm chậm như duyệt danh sách: `O(n)`.

Đây không phải trường hợp hiếm: dữ liệu ngoài đời thường đến **đã gần sắp xếp**, ví dụ mã đơn hàng tăng dần theo thời gian. Các cây **tự cân bằng** như AVL hay cây đỏ đen sẽ tự xoay lại sau mỗi lần chèn để giữ `h = O(log n)`. Bạn sẽ học chúng ở khóa nâng cao; cơ sở dữ liệu dùng một họ hàng của chúng là B-tree để đánh chỉ mục.

Cây suy biến còn gây một vấn đề thực tế với code đệ quy: cây cao 5000 tầng làm hàm `chieu_cao` đệ quy 5000 tầng và Python báo `RecursionError`. Cách xử lý là duyệt bằng **ngăn xếp tự quản lý**, đúng như bài ngăn xếp đã gợi ý:

```python
def chieu_cao_lap(goc):
    if goc is None:
        return 0
    cao = 0
    stack = [(goc, 1)]
    while stack:
        n, d = stack.pop()
        cao = max(cao, d)
        if n.right: stack.append((n.right, d + 1))
        if n.left: stack.append((n.left, d + 1))
    return cao
```

Đẩy con **phải trước** con trái để con trái được lấy ra trước, cho đúng thứ tự duyệt trước.

## Duyệt theo tầng

Thay vì đi sâu, ta có thể thăm cây **từng tầng một** từ trên xuống, bằng hàng đợi:

```python
from collections import deque

def theo_tang(goc):
    hang = deque([goc])
    while hang:
        n = hang.popleft()
        print(n.key, end=" ")
        if n.left: hang.append(n.left)
        if n.right: hang.append(n.right)

theo_tang(goc)   # 8 4 12 2 6
```

Đây chính là BFS nhắc tới ở bài hàng đợi, áp dụng trên cây. Ngăn xếp cho duyệt theo chiều sâu, hàng đợi cho duyệt theo chiều rộng: hai cấu trúc dữ liệu đầu khóa học quyết định hai cách đi qua mọi cây và đồ thị.

## Lỗi thường gặp

- **Nhầm định nghĩa chiều cao** (đếm nút hay đếm cạnh) và lệch một.
- **Không kiểm tra `None`** trước khi truy cập `.left`/`.right`.
- **Tin rằng BST luôn O(log n)**: chỉ đúng khi cây cân bằng.
- **Đệ quy trên cây có thể rất sâu**: dùng ngăn xếp tự quản.

## Tóm tắt

- Cây nhị phân: mỗi nút tối đa hai con; chiều cao là đường dài nhất từ gốc tới lá.
- Duyệt trước, giữa, sau khác ở thời điểm thăm nút; duyệt theo tầng dùng hàng đợi.
- BST: trái nhỏ hơn, phải lớn hơn; tìm và chèn `O(h)`; duyệt giữa cho dãy tăng dần.
- Thứ tự chèn quyết định hình dạng; cây suy biến cao `n`, cần cây tự cân bằng hoặc ít nhất là tránh đệ quy sâu.

## Tự kiểm tra

1. Chèn lần lượt `50, 30, 70, 20, 40` vào BST rỗng. Viết thứ tự duyệt trước và chiều cao.
2. Vì sao duyệt giữa một BST luôn cho dãy khóa tăng dần?
