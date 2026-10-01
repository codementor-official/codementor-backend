---
title: Tìm kiếm nhị phân
summary: Loại một nửa dữ liệu sau mỗi bước — cài đặt lower_bound không lệch một, bất biến vòng lặp, module bisect, và tìm kiếm nhị phân trên đáp án.
objectives:
  - Cài đặt tìm kiếm nhị phân dạng lower_bound đúng ở mọi trường hợp biên
  - Lập luận bằng bất biến vòng lặp để tránh lỗi lệch một
  - Nhận ra bài toán có thể tìm kiếm nhị phân trên tập đáp án
minutes: 25
---

Bạn mở một cuốn từ điển giấy để tra chữ "ngăn xếp". Không ai lật từng trang từ đầu. Bạn mở đại khoảng giữa, thấy chữ "lập trình", biết "ngăn" nằm phía sau, nên chỉ tìm tiếp ở nửa sau. Mỗi lần nhìn, bạn loại được một nửa số trang còn lại. Đó là **tìm kiếm nhị phân**.

![Người cầm kính lúp dò trong một danh sách đã sắp xếp](illustration:file-searching)

## Vì sao nhanh

Mỗi bước chia đôi khoảng tìm kiếm. Bắt đầu với `n` phần tử, sau `k` bước còn `n / 2^k`. Khoảng tìm kiếm còn một phần tử khi `k ≈ log₂ n`. Với một triệu phần tử chỉ cần khoảng 20 bước, với một tỷ phần tử khoảng 30 bước. Đó là `O(log n)`, so với `O(n)` của tìm tuần tự.

Điều kiện bắt buộc: dữ liệu phải **đã sắp xếp**. Không có thứ tự, nhìn vào phần tử giữa không cho ta biết gì về nửa nào chứa đáp án.

## Lower bound: phiên bản nên thuộc lòng

Câu hỏi "có phần tử `x` không?" thực ra ít hữu ích hơn câu hỏi **"vị trí đầu tiên mà `a[i] ≥ x` là đâu?"**, gọi là *lower bound*. Câu trả lời này cho biết cùng lúc: `x` có trong mảng không (kiểm tra `a[i] == x`), có bao nhiêu phần tử nhỏ hơn `x` (chính là `i`), và chèn `x` vào đâu để giữ thứ tự.

```python
def lower_bound(a, x):
    lo, hi = 0, len(a)          # đáp án nằm trong [lo, hi]
    while lo < hi:
        mid = (lo + hi) // 2
        if a[mid] < x:
            lo = mid + 1        # a[mid] quá nhỏ: đáp án ở bên phải mid
        else:
            hi = mid            # a[mid] >= x: mid có thể là đáp án
    return lo

a = [1, 3, 3, 5, 7]
print(lower_bound(a, 3))   # 1
print(lower_bound(a, 0))   # 0
print(lower_bound(a, 8))   # 5  (chèn vào cuối)
```

## Bất biến vòng lặp: cách không bao giờ lệch một

Tìm kiếm nhị phân nổi tiếng dễ viết sai: vòng lặp vô hạn, bỏ sót phần tử cuối, trả về lệch một vị trí. Cách chắc chắn nhất là phát biểu một **bất biến** (invariant), một điều luôn đúng ở đầu mỗi lượt lặp, rồi kiểm tra mọi dòng code giữ được nó.

Bất biến của hàm trên:

- Mọi phần tử ở vị trí `< lo` đều **nhỏ hơn** `x`.
- Mọi phần tử ở vị trí `≥ hi` đều **lớn hơn hoặc bằng** `x`.

Kiểm tra từng dòng:

1. Ban đầu `lo = 0`, `hi = n`: không có phần tử nào ở `< 0` hay `≥ n`, nên bất biến đúng hiển nhiên.
2. Nếu `a[mid] < x`, mảng tăng dần nên mọi phần tử từ `mid` trở về trước đều `< x`. Gán `lo = mid + 1` giữ đúng vế đầu.
3. Nếu `a[mid] ≥ x`, mọi phần tử từ `mid` trở đi đều `≥ x`. Gán `hi = mid` giữ đúng vế sau.
4. Mỗi lượt khoảng `[lo, hi)` co lại ít nhất một phần tử (vì `lo ≤ mid < hi`), nên vòng lặp chắc chắn dừng.
5. Khi dừng, `lo == hi`. Theo bất biến, mọi phần tử trước `lo` nhỏ hơn `x`, mọi phần tử từ `lo` trở đi lớn hơn hoặc bằng `x`. Vậy `lo` chính là đáp án.

Lập luận này nghe có vẻ hàn lâm, nhưng nó là cách duy nhất để **chắc chắn** code đúng thay vì "thử vài ví dụ thấy đúng".

## Module bisect

Python có sẵn tìm kiếm nhị phân trong module `bisect`:

```python
from bisect import bisect_left, bisect_right, insort

a = [1, 3, 3, 5, 7]
print(bisect_left(a, 3))    # 1: vị trí đầu tiên >= 3
print(bisect_right(a, 3))   # 3: vị trí đầu tiên > 3
print(bisect_right(a, 3) - bisect_left(a, 3))   # 2: số lần xuất hiện của 3
insort(a, 4)                # chèn giữ thứ tự
print(a)                    # [1, 3, 3, 4, 5, 7]
```

Hãy tự cài đặt ít nhất một lần để hiểu, rồi dùng `bisect` trong công việc thật. Lưu ý `insort` vẫn tốn `O(n)` vì phải dịch phần tử khi chèn vào list; chỉ phần **tìm vị trí** là `O(log n)`.

## Tìm kiếm nhị phân trên đáp án

Ý tưởng chia đôi không chỉ dùng cho mảng. Nó dùng được bất cứ khi nào câu hỏi có dạng "**giá trị nhỏ nhất thỏa điều kiện**", với điều kiện có tính **đơn điệu**: đã đúng ở một giá trị thì đúng với mọi giá trị lớn hơn.

Ví dụ: một máy in in được `t` trang mỗi phút. Cần in `N` trang trong tối đa `T` phút. Tốc độ `t` nhỏ nhất là bao nhiêu? Nếu tốc độ `t` đủ thì mọi tốc độ lớn hơn cũng đủ: điều kiện đơn điệu, nên ta tìm nhị phân trên `t`:

```python
def toc_do_nho_nhat(N, T):
    lo, hi = 1, N
    while lo < hi:
        mid = (lo + hi) // 2
        if mid * T >= N:       # tốc độ mid đã đủ
            hi = mid
        else:
            lo = mid + 1
    return lo

print(toc_do_nho_nhat(100, 7))   # 15
```

Bài này có công thức trực tiếp, nhưng khi điều kiện phức tạp (chia việc cho nhiều máy, xếp hàng có ràng buộc), tìm kiếm nhị phân trên đáp án là kỹ thuật biến bài toán "tối ưu" khó thành chuỗi câu hỏi "có/không" dễ.

## Lỗi thường gặp

- **Quên điều kiện đã sắp xếp**: kết quả sai mà không báo lỗi.
- **Vòng lặp vô hạn** do gán `lo = mid` thay vì `lo = mid + 1`.
- **Dùng `hi = len(a) - 1`** với khuôn `[lo, hi)`: bỏ sót trường hợp chèn vào cuối mảng.
- **Tràn số** trong ngôn ngữ có giới hạn số nguyên như C++ hay Java: viết `lo + (hi - lo) / 2` thay vì `(lo + hi) / 2`. Python không bị lỗi này.

## Tóm tắt

- Tìm kiếm nhị phân chia đôi khoảng tìm sau mỗi bước, `O(log n)`, cần dữ liệu đã sắp xếp.
- Lower bound trả về vị trí đầu tiên `a[i] ≥ x`; dùng khuôn `[lo, hi)` với `lo = mid + 1` và `hi = mid`.
- Chứng minh đúng bằng bất biến vòng lặp thay vì thử vài ví dụ.
- Tìm nhị phân được trên đáp án khi điều kiện đơn điệu.

## Tự kiểm tra

1. Dùng `lower_bound`, đếm số phần tử nằm trong đoạn `[L, R]` của một mảng đã sắp xếp.
2. Vì sao với khuôn `[lo, hi)` ta khởi tạo `hi = len(a)` chứ không phải `len(a) - 1`?
