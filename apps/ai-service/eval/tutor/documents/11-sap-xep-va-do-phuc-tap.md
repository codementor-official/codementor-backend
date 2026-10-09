# Sắp xếp và độ phức tạp thuật toán

## Ký hiệu Big-O

Big-O mô tả tốc độ tăng của thời gian chạy (hoặc bộ nhớ) theo kích thước đầu vào n khi n lớn, bỏ qua hằng số. Các bậc thường gặp, từ nhanh đến chậm: O(1), O(log n), O(n), O(n log n), O(n²), O(2^n).

Tìm kiếm nhị phân trên mảng đã sắp xếp là O(log n). Duyệt một vòng là O(n). Hai vòng lồng nhau trên cùng dãy là O(n²).

## Các thuật toán sắp xếp

| Thuật toán | Trung bình | Xấu nhất | Ổn định |
|---|---|---|---|
| Nổi bọt (bubble) | O(n²) | O(n²) | Có |
| Chèn (insertion) | O(n²) | O(n²) | Có |
| Trộn (merge) | O(n log n) | O(n log n) | Có |
| Nhanh (quick) | O(n log n) | O(n²) | Không |

Sắp xếp chèn rất nhanh với dãy **gần như đã sắp xếp** (gần O(n)). Quick sort rơi vào O(n²) khi chọn chốt tệ, ví dụ luôn chọn phần tử đầu với dãy đã sắp xếp.

Merge sort cần thêm O(n) bộ nhớ phụ để trộn hai nửa.

## Sắp xếp trong Python

Python dùng **Timsort**, lai giữa merge sort và insertion sort, độ phức tạp xấu nhất O(n log n) và ổn định. `ds.sort()` sắp xếp tại chỗ; `sorted(ds)` trả về list mới và nhận mọi đối tượng lặp được.

Tham số `key` nhận một hàm áp lên từng phần tử trước khi so sánh: `sorted(sv, key=lambda s: s.diem, reverse=True)`. Sắp xếp theo nhiều tiêu chí: `key=lambda s: (-s.diem, s.ten)` — điểm giảm dần, cùng điểm thì theo tên tăng dần.

Vì Timsort ổn định, có thể sắp nhiều lượt: sắp theo tiêu chí phụ trước, rồi sắp theo tiêu chí chính sau.

## Giới hạn thời gian trên hệ thống chấm

Trên hệ thống chấm của nhóm, giới hạn thời gian mặc định của bài là **1 giây**. Với n = 10^5, thuật toán O(n²) (khoảng 10^10 phép tính) chắc chắn quá thời gian; cần O(n log n).
