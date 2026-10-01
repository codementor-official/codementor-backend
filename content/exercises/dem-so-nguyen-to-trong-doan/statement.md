Một trò chơi toán học hỏi người chơi liên tục: "Trong đoạn từ `a` tới `b` có bao nhiêu số nguyên tố?". Bạn cần viết chương trình trả lời nhanh **nhiều** câu hỏi như vậy.

Nhắc lại: số nguyên tố là số tự nhiên lớn hơn 1 chỉ chia hết cho 1 và chính nó. Số 1 **không** phải số nguyên tố.

## Đầu vào

- Dòng đầu là số nguyên `q` — số câu hỏi.
- `q` dòng tiếp theo, mỗi dòng gồm hai số nguyên `a` và `b`.

## Đầu ra

`q` dòng, dòng thứ `i` là số lượng số nguyên tố trong đoạn `[a, b]` của câu hỏi thứ `i` (tính cả hai đầu mút).

## Ghi chú

Hãy bắt đầu bằng một hàm `la_so_nguyen_to(n)` đơn giản để chắc chắn hiểu đúng bài. Sau đó nhận ra rằng có tới `4000` câu hỏi, mỗi câu trên đoạn dài gần `10^6` phần tử, nên kiểm tra từng số là không đủ nhanh. Bài này là dịp để bạn thấy một **hàm tính trước một lần** (sàng + cộng dồn) có thể thay cho hàng triệu phép tính lặp lại.
