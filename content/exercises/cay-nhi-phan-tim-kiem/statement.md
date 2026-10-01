Cây nhị phân tìm kiếm (BST) giữ dữ liệu luôn "gần như đã sắp xếp": với mọi nút, mọi khóa ở cây con trái **nhỏ hơn** nó và mọi khóa ở cây con phải **lớn hơn** nó. Nhờ vậy việc tìm kiếm chỉ cần đi theo một đường từ gốc xuống, thay vì duyệt toàn bộ dữ liệu.

Bắt đầu từ cây rỗng, hãy **chèn lần lượt** `n` khóa theo đúng thứ tự cho trước. Khóa đầu tiên trở thành gốc. Mỗi khóa sau đó đi từ gốc xuống: nhỏ hơn nút đang xét thì rẽ trái, lớn hơn thì rẽ phải, cho tới khi gặp vị trí trống thì đặt vào đó.

Sau khi chèn hết, in ra:

1. **Chiều cao** của cây: số nút trên đường đi dài nhất từ gốc tới một lá.
2. Thứ tự **duyệt trước** (preorder): thăm nút, rồi duyệt cây con trái, rồi cây con phải.

## Đầu vào

- Dòng đầu là số nguyên `n`.
- Dòng thứ hai gồm `n` khóa phân biệt.

## Đầu ra

- Dòng 1: chiều cao của cây.
- Dòng 2: `n` khóa theo thứ tự duyệt trước, cách nhau một dấu cách.

## Ghi chú

So sánh ví dụ 1 và 2: thứ tự chèn quyết định hình dạng cây. Với dữ liệu tăng dần, cây cao bằng số khóa và tìm kiếm chậm như duyệt danh sách. Đây là lý do thực tế người ta dùng cây **tự cân bằng** (AVL, đỏ đen). Hãy đặc biệt cẩn thận với giới hạn độ sâu đệ quy khi cây suy biến.
