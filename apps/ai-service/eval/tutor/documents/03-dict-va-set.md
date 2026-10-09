# Dict và set

## Dict

Dict lưu các cặp khoá – giá trị: `sv = {"ten": "An", "diem": 8}`. Truy cập theo khoá với độ phức tạp trung bình O(1) nhờ bảng băm.

Từ Python 3.7, dict **giữ thứ tự chèn**: duyệt dict cho các khoá theo đúng thứ tự đã thêm vào. Đây là đảm bảo của ngôn ngữ, không còn là chi tiết cài đặt.

Khoá của dict phải **băm được** (hashable): số, chuỗi, tuple chứa phần tử bất biến. List và dict không làm khoá được; dùng chúng làm khoá sẽ ném `TypeError: unhashable type`.

### Đọc giá trị an toàn

`sv["lop"]` ném `KeyError` nếu khoá không tồn tại. `sv.get("lop")` trả về `None`, còn `sv.get("lop", "chua co")` trả về giá trị mặc định. Phương thức `setdefault(k, v)` trả về giá trị của k, và nếu k chưa có thì gán v trước.

Đếm tần suất là bài quen thuộc: `collections.Counter("banana")` cho `Counter({'a': 3, 'n': 2, 'b': 1})`. Gom nhóm dùng `collections.defaultdict(list)` để khỏi kiểm tra khoá đã tồn tại.

### Duyệt dict

- `for k in d:` duyệt khoá.
- `for k, v in d.items():` duyệt cặp khoá – giá trị.
- `d.values()` lấy các giá trị.

Không được thêm hay xoá khoá trong khi đang duyệt chính dict đó; Python sẽ ném `RuntimeError: dictionary changed size during iteration`. Muốn xoá có điều kiện thì duyệt trên `list(d)`.

## Dict comprehension

`binh_phuong = {x: x * x for x in range(5)}` tạo dict từ một biểu thức. Đảo khoá và giá trị: `{v: k for k, v in d.items()}`.

## Set

Set là tập hợp **không có thứ tự** và **không có phần tử trùng**. `set([1, 2, 2, 3])` cho `{1, 2, 3}`. Set rỗng phải viết `set()`, vì `{}` là dict rỗng.

Kiểm tra `x in s` với set trung bình O(1), trong khi với list là O(n). Vì vậy khi cần kiểm tra thành viên nhiều lần, đổi list sang set trước.

### Phép toán tập hợp

- Hợp: `a | b`
- Giao: `a & b`
- Hiệu: `a - b`
- Hiệu đối xứng: `a ^ b` (phần tử thuộc đúng một trong hai tập)

`frozenset` là phiên bản bất biến của set, băm được, nên làm khoá dict hoặc phần tử của set khác được.
