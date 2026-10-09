# List và tuple

## List

List là dãy có thứ tự và **thay đổi được** (mutable). Tạo list bằng cặp ngoặc vuông: `diem = [7, 8.5, 9]`. Phần tử có thể khác kiểu nhau, và list có thể lồng list.

Chỉ số bắt đầu từ 0. Chỉ số âm đếm từ cuối: `diem[-1]` là phần tử cuối cùng. Truy cập chỉ số vượt quá độ dài sẽ ném `IndexError`.

### Các phương thức thường dùng

- `append(x)` thêm một phần tử vào cuối, độ phức tạp trung bình O(1).
- `extend(iterable)` nối tất cả phần tử của một dãy khác vào cuối.
- `insert(i, x)` chèn vào vị trí i, độ phức tạp O(n) vì phải dời các phần tử phía sau.
- `pop()` lấy và xoá phần tử cuối; `pop(0)` lấy phần tử đầu nhưng tốn O(n). Cần lấy ra ở đầu thường xuyên thì dùng `collections.deque`.
- `remove(x)` xoá lần xuất hiện đầu tiên của giá trị x, ném `ValueError` nếu không có.
- `sort()` sắp xếp tại chỗ và trả về `None`; `sorted(lst)` trả về list mới.

Phương thức `list.sort()` của Python là sắp xếp **ổn định**: hai phần tử bằng nhau giữ nguyên thứ tự ban đầu. Thuật toán bên dưới là Timsort.

## Cắt lát (slicing)

Cú pháp `a[bat_dau:ket_thuc:buoc]` lấy các phần tử từ chỉ số bắt đầu đến **trước** chỉ số kết thúc. `a[::-1]` đảo ngược list. Cắt lát luôn tạo list mới, nên `b = a[:]` là cách sao chép nông một list.

## Sao chép nông và sao chép sâu

`b = a` không sao chép gì cả, chỉ thêm một tên mới cho cùng một list. `a[:]`, `list(a)` hay `a.copy()` là sao chép nông: list mới nhưng các phần tử bên trong vẫn dùng chung. Với list lồng nhau cần `copy.deepcopy(a)`.

## Tuple

Tuple là dãy có thứ tự nhưng **bất biến** (immutable): tạo xong thì không thêm, xoá hay gán lại phần tử được. Tạo tuple bằng dấu ngoặc tròn: `toa_do = (3, 4)`.

Tuple một phần tử bắt buộc phải có dấu phẩy: `(5,)` là tuple, còn `(5)` chỉ là số 5 trong ngoặc.

Vì bất biến và băm được (nếu các phần tử bên trong cũng băm được), tuple dùng được làm khoá của dict, còn list thì không.

## Giải nén (unpacking)

`x, y = toa_do` gán lần lượt từng phần tử. Dấu sao gom phần còn lại: `dau, *giua, cuoi = [1, 2, 3, 4]` cho `giua == [2, 3]`. Đổi chỗ hai biến chỉ cần `a, b = b, a`.

## Khi nào dùng list, khi nào dùng tuple

Dùng list cho tập dữ liệu cùng loại có thể thay đổi số lượng, ví dụ danh sách điểm. Dùng tuple cho một bản ghi cố định nhiều trường, ví dụ toạ độ hay cặp (tên, tuổi).
