Một nhóm nghiên cứu muốn biết trong các bài đánh giá khóa học, học viên hay nhắc tới những từ nào nhất. Bạn được giao viết công cụ đếm từ.

Cho một đoạn văn và số nguyên `k`, hãy in ra `k` từ xuất hiện nhiều nhất cùng số lần xuất hiện.

Quy ước:

- Một **từ** là dãy liên tiếp các chữ cái hoặc chữ số. Mọi ký tự khác (dấu cách, dấu câu) là ký tự phân tách.
- Không phân biệt chữ hoa, chữ thường: `Hoc` và `hoc` là cùng một từ. In từ ở dạng **chữ thường**.
- Sắp xếp theo số lần xuất hiện **giảm dần**. Nếu bằng nhau, xếp theo thứ tự từ điển **tăng dần**.
- Nếu số từ khác nhau ít hơn `k`, in tất cả.

## Đầu vào

- Dòng đầu là số nguyên `k`.
- Dòng thứ hai là đoạn văn.

## Đầu ra

Mỗi dòng gồm một từ và số lần xuất hiện của nó, cách nhau một dấu cách.

## Ghi chú

Đếm bằng dictionary chỉ cần duyệt văn bản **một lần**. Cách gọi `text.count(w)` cho từng từ trông ngắn hơn, nhưng mỗi lần gọi lại phải duyệt cả văn bản.
