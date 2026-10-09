# Comprehension và generator

## List comprehension

`binh_phuong = [x * x for x in range(10)]` tạo list từ một biểu thức. Thêm điều kiện lọc: `[x for x in ds if x % 2 == 0]`. Biểu thức điều kiện đặt trước `for` để biến đổi chứ không lọc: `["chẵn" if x % 2 == 0 else "lẻ" for x in ds]`.

Comprehension lồng: `[(i, j) for i in range(3) for j in range(3)]` duyệt `i` ở vòng ngoài, `j` ở vòng trong, đúng thứ tự viết.

Quy tắc của nhóm A+ Python: comprehension không được dài quá **một dòng 79 ký tự**; dài hơn thì viết vòng `for` thường cho dễ đọc.

## Set và dict comprehension

`{x % 3 for x in ds}` tạo set, `{ten: diem for ten, diem in cap}` tạo dict.

## Generator expression

Thay ngoặc vuông bằng ngoặc tròn: `(x * x for x in range(10**8))`. Generator **không** tạo cả danh sách trong bộ nhớ mà sinh từng giá trị khi được hỏi tới, nên tổng của 100 triệu số bình phương bằng `sum(x * x for x in range(10**8))` chỉ tốn bộ nhớ hằng số.

Generator chỉ duyệt được **một lần**. Duyệt lần hai sẽ không ra phần tử nào.

## Hàm generator và yield

```python
def dem_nguoc(n):
    while n > 0:
        yield n
        n -= 1
```

Gọi `dem_nguoc(3)` chưa chạy thân hàm mà trả về một đối tượng generator. Mỗi lần `next()` chạy tiếp tới `yield` kế tiếp rồi tạm dừng, giữ nguyên trạng thái biến cục bộ. Khi hàm chạy hết, generator ném `StopIteration`, và vòng `for` hiểu đó là tín hiệu kết thúc.

`yield from iterable` uỷ quyền cho một generator khác, thường dùng khi duyệt cấu trúc đệ quy.

## itertools

Module `itertools` có sẵn nhiều generator: `count()`, `cycle()`, `chain(a, b)`, `islice(g, 5)` lấy 5 phần tử đầu, `permutations`, `combinations`, `groupby` (gom các phần tử liên tiếp cùng khoá, nên phải sắp xếp trước).

## Khi nào dùng generator

Dùng generator khi dữ liệu lớn hoặc vô hạn, khi đọc tệp lớn theo từng dòng, hoặc khi chỉ cần duyệt một lần. Dùng list khi cần truy cập ngẫu nhiên theo chỉ số, cần `len()`, hoặc duyệt nhiều lần.
