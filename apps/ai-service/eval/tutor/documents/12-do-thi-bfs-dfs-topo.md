# Đồ thị: BFS, DFS và sắp xếp tô-pô

## Biểu diễn đồ thị

Danh sách kề là cách phổ biến nhất trong Python: `g = defaultdict(list)` rồi `g[u].append(v)` cho mỗi cạnh u → v. Với đồ thị vô hướng thì thêm cả hai chiều. Ma trận kề tốn O(V²) bộ nhớ, chỉ hợp với đồ thị dày.

## Tìm kiếm theo chiều rộng (BFS)

BFS duyệt theo từng lớp, dùng **hàng đợi**. Trong Python dùng `collections.deque` với `popleft()` O(1); không dùng `list.pop(0)` vì tốn O(n).

```python
from collections import deque

def bfs(g, nguon):
    khoang_cach = {nguon: 0}
    q = deque([nguon])
    while q:
        u = q.popleft()
        for v in g[u]:
            if v not in khoang_cach:
                khoang_cach[v] = khoang_cach[u] + 1
                q.append(v)
    return khoang_cach
```

Trên đồ thị **không trọng số**, BFS cho đường đi ngắn nhất tính theo số cạnh. Độ phức tạp O(V + E).

## Tìm kiếm theo chiều sâu (DFS)

DFS đi sâu hết một nhánh rồi mới quay lui, dùng **ngăn xếp** hoặc đệ quy. Cài đặt đệ quy gọn nhưng với đồ thị sâu hơn 1000 đỉnh sẽ chạm giới hạn đệ quy của Python, khi đó nên dùng ngăn xếp tự quản lý. Độ phức tạp cũng là O(V + E).

DFS dùng để tìm thành phần liên thông, phát hiện chu trình và sắp xếp tô-pô.

## Sắp xếp tô-pô

Sắp xếp tô-pô xếp các đỉnh của một **đồ thị có hướng không chu trình (DAG)** sao cho với mọi cạnh u → v, u đứng trước v. Ứng dụng: thứ tự học các môn có môn tiên quyết, thứ tự build các module.

### Thuật toán Kahn (dựa trên BFS)

1. Tính bậc vào (indegree) của mọi đỉnh.
2. Đưa mọi đỉnh có bậc vào bằng 0 vào hàng đợi.
3. Lấy một đỉnh ra, thêm vào kết quả, giảm bậc vào của các đỉnh kề; đỉnh nào về 0 thì đưa vào hàng đợi.
4. Nếu kết quả có ít hơn V đỉnh thì đồ thị **có chu trình** và không sắp xếp tô-pô được.

### Cách dùng DFS

Chạy DFS, thêm đỉnh vào danh sách khi đã duyệt xong mọi đỉnh kề của nó (hậu thứ tự), rồi đảo ngược danh sách. Phát hiện chu trình bằng ba trạng thái: chưa thăm, đang thăm, đã xong — gặp cạnh tới đỉnh "đang thăm" nghĩa là có chu trình.

## Đường đi ngắn nhất có trọng số

BFS không đúng khi cạnh có trọng số khác nhau; khi đó cần Dijkstra (trọng số không âm) hoặc Bellman-Ford (cho phép trọng số âm). Hai thuật toán này nằm ở chuyên đề tuần 9, chưa có trong tài liệu này.
