---
title: Hàng đợi và hàng đợi hai đầu
summary: Cấu trúc vào trước ra trước, vì sao list là lựa chọn sai, collections.deque và ứng dụng mô phỏng — từ lập lịch xoay vòng tới duyệt theo chiều rộng.
objectives:
  - Mô tả nguyên tắc FIFO và các thao tác enqueue, dequeue
  - Giải thích vì sao list.pop(0) làm hàng đợi chậm và dùng deque thay thế
  - Mô phỏng một hệ thống xếp hàng bằng hàng đợi
minutes: 25
---

Ở quầy thanh toán siêu thị, người đến trước được phục vụ trước. Người mới đến xếp vào **cuối** hàng, người được phục vụ rời đi từ **đầu** hàng. Đó là **hàng đợi** (queue), với nguyên tắc *vào trước, ra trước* (FIFO: First In, First Out), ngược với ngăn xếp.

## Các thao tác

- `enqueue(x)`: thêm `x` vào cuối hàng.
- `dequeue()`: lấy phần tử ở đầu hàng ra.
- `front()`: xem phần tử ở đầu hàng.
- `is_empty()`: kiểm tra rỗng.

Hàng đợi xuất hiện ở mọi hệ thống phải xử lý công việc **theo thứ tự đến**: hàng đợi in của máy in, hàng đợi tin nhắn giữa các dịch vụ, hàng đợi yêu cầu của máy chủ web, và cả hàng chờ chấm bài khi bạn nộp code lên CodeMentor.

## Vì sao list là lựa chọn sai

Thử dùng list: thêm ở cuối bằng `append`, lấy ở đầu bằng `pop(0)`. Kết quả đúng, nhưng như bài mảng động đã phân tích, `pop(0)` phải dịch **mọi** phần tử còn lại sang trái, tốn `O(n)`. Với hàng đợi có hàng nghìn phần tử và hàng triệu lượt lấy ra, chương trình chậm đi hàng nghìn lần.

Hãy tự đo để thấy rõ:

```python
import time
from collections import deque

n = 100_000

a = list(range(n))
t = time.perf_counter()
while a:
    a.pop(0)
print("list.pop(0):", round(time.perf_counter() - t, 3), "giây")

d = deque(range(n))
t = time.perf_counter()
while d:
    d.popleft()
print("deque.popleft():", round(time.perf_counter() - t, 3), "giây")
```

Trên máy thông thường, phiên bản list chậm hơn hàng chục tới hàng trăm lần, và khoảng cách càng lớn khi `n` tăng: `O(n²)` so với `O(n)`.

## collections.deque

`deque` (đọc là "đéc", viết tắt của *double-ended queue*) là hàng đợi **hai đầu**: thêm và lấy ở **cả hai đầu** đều `O(1)`.

```python
from collections import deque

hang = deque()
hang.append("An")        # vào cuối
hang.append("Bình")
hang.append("Chi")
print(hang.popleft())    # An   (ra ở đầu)
print(hang[0])           # Bình (xem đầu hàng)
hang.appendleft("Dũng")  # chen lên đầu, cũng O(1)
print(list(hang))        # ['Dũng', 'Bình', 'Chi']
```

Bên trong, `deque` không lưu các phần tử liền nhau như list mà lưu thành nhiều khối nhỏ nối với nhau, nên không bao giờ phải dịch toàn bộ dữ liệu. Đổi lại, truy cập phần tử ở **giữa** `deque` chậm hơn list. Quy tắc chọn: cần lấy ra ở đầu thì dùng `deque`; cần truy cập ngẫu nhiên theo chỉ số thì dùng list.

`deque` còn có tham số `maxlen` để giữ **N phần tử gần nhất**. Thêm phần tử mới khi đã đầy sẽ tự đẩy phần tử cũ nhất ra:

```python
gan_day = deque(maxlen=3)
for trang in ["home", "khoa-hoc", "bai-1", "bai-2"]:
    gan_day.append(trang)
print(list(gan_day))     # ['khoa-hoc', 'bai-1', 'bai-2']
```

## Ví dụ thực hành: lập lịch xoay vòng

Hệ điều hành chia CPU cho nhiều chương trình bằng cơ chế **xoay vòng** (round-robin): mỗi chương trình chạy tối đa `q` đơn vị thời gian, chưa xong thì xếp lại cuối hàng. Hàng đợi mô phỏng điều này một cách tự nhiên:

```python
from collections import deque

def xoay_vong(tac_vu, q):
    hang = deque(tac_vu)            # các cặp (tên, thời gian còn lại)
    dong_ho = 0
    hoan_thanh = []
    while hang:
        ten, con_lai = hang.popleft()
        chay = min(q, con_lai)
        dong_ho += chay
        if con_lai > chay:
            hang.append((ten, con_lai - chay))
        else:
            hoan_thanh.append((ten, dong_ho))
    return hoan_thanh

print(xoay_vong([("A", 3), ("B", 1), ("C", 4)], 2))
# [('B', 3), ('A', 6), ('C', 8)]
```

Hãy tự lần theo từng lượt với giấy bút một lần: A chạy 2 (đồng hồ 2), B chạy 1 và xong (3), C chạy 2 (5), A chạy nốt 1 (6), C chạy nốt 2 (8). Lần theo bằng tay là cách tốt nhất để chắc chắn bạn hiểu mô phỏng trước khi tin vào kết quả của chương trình. Đây chính là bài tập của chương này, với dữ liệu đủ lớn để `list.pop(0)` bị quá thời gian.

## Hàng đợi và duyệt theo chiều rộng

Một ứng dụng quan trọng khác của hàng đợi là **duyệt theo chiều rộng** (BFS): đi qua các đỉnh của đồ thị hay các ô của bản đồ **theo thứ tự khoảng cách** từ điểm xuất phát. Ta lấy một đỉnh ở đầu hàng đợi, rồi thêm các đỉnh kề chưa thăm của nó vào cuối hàng. Vì hàng đợi giữ đúng thứ tự đến, mọi đỉnh ở khoảng cách 1 được xử lý xong rồi mới tới khoảng cách 2. Bạn sẽ gặp lại BFS khi học về cây và đồ thị.

## Hàng đợi ưu tiên

Không phải hàng nào cũng phục vụ theo thứ tự đến. Phòng cấp cứu ưu tiên ca nặng; bộ lập lịch ưu tiên tác vụ khẩn. **Hàng đợi ưu tiên** luôn lấy ra phần tử có độ ưu tiên cao nhất, bất kể nó vào lúc nào. Python cài đặt nó bằng module `heapq` trên một list thông thường, với thêm và lấy đều `O(log n)`:

```python
import heapq

ca_benh = []
heapq.heappush(ca_benh, (3, "đau đầu"))     # số nhỏ = ưu tiên cao
heapq.heappush(ca_benh, (1, "ngừng tim"))
heapq.heappush(ca_benh, (2, "gãy chân"))
while ca_benh:
    muc, ten = heapq.heappop(ca_benh)
    print(muc, ten)        # 1 ngừng tim / 2 gãy chân / 3 đau đầu
```

`heapq` luôn lấy ra phần tử **nhỏ nhất**; muốn lấy lớn nhất thì đổi dấu độ ưu tiên. Cấu trúc bên trong của nó là **đống nhị phân** (heap), một loại cây đặc biệt bạn sẽ học ở khóa nâng cao.

## Lỗi thường gặp

- **Dùng `list.pop(0)` làm dequeue**: đúng nhưng `O(n)` mỗi lần.
- **Lấy từ hàng đợi rỗng**: `deque.popleft()` trên deque rỗng báo `IndexError`; luôn kiểm tra `while hang:`.
- **Nhầm hàng đợi với ngăn xếp**: lấy nhầm đầu (`pop()` thay vì `popleft()`) biến FIFO thành LIFO, kết quả sai mà không báo lỗi.
- **Truy cập giữa deque như list** trong vòng lặp lớn.

## Tóm tắt

- Hàng đợi là FIFO: vào ở cuối, ra ở đầu.
- `list.pop(0)` là `O(n)`; dùng `collections.deque` với `append`/`popleft` đều `O(1)`.
- `deque(maxlen=N)` giữ N phần tử gần nhất.
- Hàng đợi là nền tảng của mô phỏng xếp hàng và duyệt theo chiều rộng.

## Tự kiểm tra

1. Cài đặt hàng đợi chỉ bằng **hai ngăn xếp** (hai list). Vì sao mỗi thao tác vẫn là `O(1)` khấu hao?
2. Trong ví dụ xoay vòng, nếu `q` rất lớn (lớn hơn mọi thời gian), thứ tự hoàn thành là gì?
