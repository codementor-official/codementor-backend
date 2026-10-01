---
title: Danh sách liên kết
summary: Nút và con trỏ thay cho ô liền nhau — chèn/xóa O(1) khi đã có vị trí, truy cập O(n), cài đặt đảo ngược danh sách và vì sao trong Python ta hiếm khi tự viết nó.
objectives:
  - Mô tả cấu trúc nút và con trỏ của danh sách liên kết đơn
  - So sánh chi phí thao tác giữa danh sách liên kết và mảng
  - Cài đặt duyệt, chèn đầu và đảo ngược danh sách liên kết
minutes: 25
---

Mảng mạnh ở truy cập theo chỉ số nhưng yếu ở chèn và xóa giữa chừng, vì phải dịch các phần tử liền kề. **Danh sách liên kết** đảo ngược đánh đổi đó: các phần tử không cần nằm liền nhau, mỗi phần tử tự biết phần tử kế tiếp nằm ở đâu.

## Nút và con trỏ

Một danh sách liên kết đơn gồm các **nút** (node). Mỗi nút giữ hai thứ: **giá trị** và một **tham chiếu** (con trỏ) tới nút kế tiếp. Nút cuối cùng trỏ tới `None`. Ta chỉ cần giữ tham chiếu tới nút **đầu** (head) là đi được cả danh sách.

```python
class Node:
    def __init__(self, value, next=None):
        self.value = value
        self.next = next

# Tạo danh sách 1 → 2 → 3
head = Node(1, Node(2, Node(3)))

node = head
while node is not None:
    print(node.value, end=" → ")
    node = node.next
print("None")         # 1 → 2 → 3 → None
```

Vòng lặp `while node is not None: ... node = node.next` là "câu thần chú" của danh sách liên kết. Gần như mọi thao tác đều bắt đầu bằng việc đi dọc danh sách theo cách này.

## Chi phí: ngược với mảng

**Truy cập phần tử thứ `i`** phải đi qua `i` nút từ đầu, tốn `O(n)`. Không có phép tính địa chỉ nào giúp nhảy thẳng tới đó như mảng.

**Chèn ở đầu** chỉ là tạo một nút mới trỏ tới head cũ, `O(1)`, bất kể danh sách dài bao nhiêu:

```python
head = Node(0, head)   # 0 → 1 → 2 → 3
```

**Chèn hoặc xóa sau một nút đã biết** cũng `O(1)`: chỉ cần sửa vài con trỏ, không dịch dữ liệu nào.

```python
def chen_sau(node, value):
    node.next = Node(value, node.next)

def xoa_sau(node):
    if node.next is not None:
        node.next = node.next.next
```

Cụm từ quan trọng là "**khi đã có vị trí**". Nếu phải đi tìm vị trí trước, chi phí tìm vẫn là `O(n)`. Danh sách liên kết thực sự tỏa sáng khi chương trình đang giữ sẵn tham chiếu tới nút cần thao tác, ví dụ trong cài đặt bộ nhớ đệm LRU, hay danh sách các tiến trình của hệ điều hành.

Tổng hợp so sánh:

- Truy cập theo chỉ số: mảng `O(1)`, danh sách liên kết `O(n)`.
- Chèn/xóa ở đầu: mảng `O(n)`, danh sách liên kết `O(1)`.
- Chèn/xóa khi đã có vị trí: mảng `O(n)`, danh sách liên kết `O(1)`.
- Tìm kiếm theo giá trị: cả hai đều `O(n)`.
- Bộ nhớ: danh sách liên kết tốn thêm một con trỏ cho mỗi phần tử, và các nút nằm rải rác nên CPU đọc kém hiệu quả hơn mảng liền nhau.

## Bài toán kinh điển: đảo ngược danh sách

Đảo ngược `1 → 2 → 3 → None` thành `3 → 2 → 1 → None` mà không tạo nút mới. Ý tưởng: đi dọc danh sách, lần lượt quay ngược con trỏ `next` của từng nút về phía nút **trước** nó.

```python
def dao_nguoc(head):
    truoc = None
    hien_tai = head
    while hien_tai is not None:
        sau = hien_tai.next      # 1. nhớ nút kế tiếp trước khi mất dấu
        hien_tai.next = truoc    # 2. quay ngược con trỏ
        truoc = hien_tai         # 3. tiến hai con trỏ lên một bước
        hien_tai = sau
    return truoc                 # nút cuối cũ là head mới
```

Thứ tự ba bước là mấu chốt. Nếu quay con trỏ trước khi lưu `sau`, ta mất đường tới phần còn lại của danh sách và không cách nào lấy lại được. Khi làm việc với con trỏ, hãy vẽ các ô và mũi tên ra giấy cho ba nút đầu; đây không phải việc của người mới, mà là thói quen của cả những lập trình viên nhiều kinh nghiệm.

Thuật toán duyệt mỗi nút một lần: `O(n)` thời gian, `O(1)` bộ nhớ thêm.

## Kỹ thuật hai con trỏ nhanh, chậm

Một mẹo hay trên danh sách liên kết là dùng hai con trỏ đi với tốc độ khác nhau. Để tìm **nút giữa** trong một lần duyệt:

```python
def nut_giua(head):
    cham = nhanh = head
    while nhanh is not None and nhanh.next is not None:
        cham = cham.next
        nhanh = nhanh.next.next
    return cham
```

Khi con trỏ nhanh (đi hai bước mỗi lượt) tới cuối, con trỏ chậm vừa đi được nửa đường. Cùng ý tưởng này phát hiện được danh sách có **chu trình**: nếu có vòng lặp, con trỏ nhanh sẽ đuổi kịp con trỏ chậm.

## Trong Python thì sao?

Python không có sẵn lớp danh sách liên kết, và bạn hiếm khi phải tự viết trong công việc hằng ngày: `list` đủ tốt cho hầu hết trường hợp, còn khi cần thêm/lấy nhanh ở hai đầu thì `deque` đã có sẵn. Vậy tại sao vẫn học? Vì danh sách liên kết là cách tốt nhất để luyện tư duy **con trỏ và tham chiếu**, nền tảng của cây, đồ thị và gần như mọi cấu trúc dữ liệu phức tạp hơn. Nó cũng là chủ đề kinh điển trong phỏng vấn kỹ thuật.

## Lỗi thường gặp

- **Truy cập `.next` của `None`**: `AttributeError: 'NoneType' object has no attribute 'next'`. Luôn kiểm tra nút trước khi đi tiếp.
- **Mất dấu phần còn lại** khi sửa con trỏ sai thứ tự.
- **Quên cập nhật head** khi chèn hoặc xóa ở đầu.
- **Không xử lý danh sách rỗng hoặc một phần tử**: hai trường hợp này làm hỏng nhiều lời giải tưởng là đúng.

## Tóm tắt

- Danh sách liên kết gồm các nút, mỗi nút trỏ tới nút kế tiếp; chỉ cần giữ head.
- Truy cập theo chỉ số `O(n)`; chèn/xóa ở đầu hoặc khi đã có vị trí `O(1)`.
- Đảo ngược: lưu `next`, quay con trỏ, tiến lên, theo đúng thứ tự.
- Hai con trỏ nhanh/chậm tìm nút giữa và phát hiện chu trình.

## Tự kiểm tra

1. Viết hàm đếm số nút của danh sách liên kết. Độ phức tạp thời gian và bộ nhớ là bao nhiêu?
2. Vì sao xóa **nút cuối** của danh sách liên kết đơn lại tốn `O(n)`, dù xóa nút đầu chỉ `O(1)`?
