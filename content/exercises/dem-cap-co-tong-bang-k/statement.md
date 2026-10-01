Một cửa hàng muốn gợi ý cho khách các **cặp sản phẩm** có tổng giá đúng bằng số tiền trong thẻ quà tặng `K`, để khách dùng hết thẻ. Danh sách giá đã được sắp xếp tăng dần.

Cho mảng `a` gồm `n` số nguyên **đã sắp xếp không giảm** và số nguyên `K`, hãy đếm số cặp chỉ số `(i, j)` với `i < j` sao cho `a[i] + a[j] = K`.

## Đầu vào

- Dòng đầu gồm hai số nguyên `n` và `K`.
- Dòng thứ hai gồm `n` số nguyên `a[0], a[1], …, a[n-1]`.

## Đầu ra

Một số nguyên là số cặp thỏa mãn.

## Ghi chú

Lời giải thử mọi cặp rất dễ viết và **đúng**, hãy dùng nó để kiểm tra hiểu biết của bạn trên ví dụ nhỏ. Nhưng với `n` tới `2·10^4`, nó cần khoảng 200 triệu phép thử và sẽ bị **Quá thời gian**. Bài này muốn bạn tận dụng điều kiện "mảng đã sắp xếp" để đạt độ phức tạp O(n). Chú ý các giá trị trùng nhau: chúng tạo ra nhiều cặp khác nhau về chỉ số.
