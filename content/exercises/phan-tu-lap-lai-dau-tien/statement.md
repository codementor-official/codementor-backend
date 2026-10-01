Hệ thống thanh toán ghi lại mã giao dịch theo thứ tự đến. Một mã xuất hiện lần thứ hai là dấu hiệu **gửi trùng** cần cảnh báo ngay. Bạn cần tìm giao dịch trùng **sớm nhất**.

Cho dãy `n` số nguyên, đọc từ trái sang phải. Hãy tìm vị trí đầu tiên mà giá trị tại đó **đã xuất hiện trước đó** trong dãy.

## Đầu vào

- Dòng đầu là số nguyên `n`.
- Dòng thứ hai gồm `n` số nguyên.

## Đầu ra

- Nếu tồn tại, in giá trị đó và vị trí (đếm từ 1) nơi nó **lặp lại lần đầu**, cách nhau một dấu cách.
- Nếu không có giá trị nào lặp lại, in `NONE`.

## Ghi chú

"Phần tử lặp lại đầu tiên" khác với "phần tử xuất hiện đầu tiên mà có lặp lại". Ở ví dụ 1, số `3` đứng đầu dãy và có lặp lại, nhưng lần lặp của nó (vị trí 5) đến **sau** lần lặp của `8` (vị trí 4). Hệ thống cần cảnh báo ngay khi gặp bản trùng đầu tiên trong luồng dữ liệu, nên đáp án là `8`.
