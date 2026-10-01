Hệ điều hành chia thời gian xử lý cho nhiều chương trình bằng cơ chế **xoay vòng** (round-robin): mỗi chương trình được chạy tối đa `q` đơn vị thời gian, sau đó nếu chưa xong thì nhường lượt và xếp lại cuối hàng. Bạn sẽ mô phỏng cơ chế này.

Có `n` tác vụ xếp hàng theo thứ tự đầu vào; tác vụ thứ `i` có tên và cần tổng cộng `t[i]` đơn vị thời gian. Đồng hồ bắt đầu từ 0. Lặp lại cho tới khi hàng đợi rỗng:

1. Lấy tác vụ ở đầu hàng.
2. Cho nó chạy `min(q, thời gian còn lại của nó)` đơn vị; đồng hồ tăng tương ứng.
3. Nếu tác vụ đã chạy đủ, nó hoàn thành tại thời điểm hiện tại của đồng hồ. Nếu chưa, xếp nó lại vào **cuối** hàng.

## Đầu vào

- Dòng đầu gồm hai số nguyên `n` và `q`.
- `n` dòng tiếp theo, mỗi dòng gồm tên tác vụ và `t[i]`.

## Đầu ra

`n` dòng theo **thứ tự hoàn thành**, mỗi dòng gồm tên tác vụ và thời điểm nó hoàn thành.

## Ghi chú

Tổng số lượt chạy có thể lên tới một triệu, trên hàng đợi có hàng nghìn tác vụ. Nếu bạn lấy phần tử đầu danh sách bằng `list.pop(0)`, mỗi lần lấy phải dịch chuyển toàn bộ danh sách và chương trình sẽ quá chậm. Hãy chọn cấu trúc dữ liệu thêm ở cuối và lấy ở đầu đều trong O(1).
