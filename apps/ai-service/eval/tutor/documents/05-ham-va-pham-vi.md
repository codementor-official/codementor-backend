# Hàm và phạm vi biến

## Định nghĩa hàm

```python
def dien_tich_hcn(dai, rong=1):
    """Trả về diện tích hình chữ nhật."""
    return dai * rong
```

Hàm không có `return` sẽ trả về `None`. Chuỗi ngay dưới dòng `def` là docstring, đọc được qua `help(dien_tich_hcn)`.

## Tham số

- Tham số vị trí và tham số từ khoá: `dien_tich_hcn(3, rong=4)`.
- Tham số mặc định được tính **một lần duy nhất** lúc định nghĩa hàm. Vì vậy không dùng đối tượng thay đổi được làm giá trị mặc định: `def them(x, ds=[])` sẽ dùng chung một list cho mọi lần gọi. Cách đúng là `def them(x, ds=None):` rồi trong thân hàm viết `if ds is None: ds = []`.
- `*args` gom các tham số vị trí thừa thành một tuple; `**kwargs` gom tham số từ khoá thừa thành một dict.
- Tham số đứng sau `*` bắt buộc truyền theo tên: `def ket_noi(host, *, cong=8080)`.

## Phạm vi biến: quy tắc LEGB

Khi gặp một tên, Python tìm theo thứ tự **L**ocal (trong hàm) → **E**nclosing (hàm bao ngoài) → **G**lobal (cấp module) → **B**uilt-in (như `len`, `print`).

Gán giá trị cho một tên bên trong hàm sẽ biến tên đó thành biến cục bộ của hàm. Muốn gán vào biến cấp module phải khai báo `global ten`; muốn gán vào biến của hàm bao ngoài thì dùng `nonlocal ten`. Đọc biến toàn cục mà không gán thì không cần khai báo gì.

Lỗi `UnboundLocalError` xảy ra khi đọc một biến trước khi gán nó trong cùng hàm, trong khi Python đã coi nó là biến cục bộ vì có câu lệnh gán ở phía sau.

## Hàm là đối tượng

Hàm trong Python là đối tượng hạng nhất: gán được cho biến, truyền làm tham số, trả về từ hàm khác. Hàm lồng trong hàm và "nhớ" biến của hàm bao ngoài gọi là closure.

`lambda` tạo hàm vô danh một biểu thức, thường dùng làm `key` khi sắp xếp: `sorted(sv, key=lambda s: s["diem"])`.

## Decorator

Decorator là hàm nhận một hàm và trả về hàm mới. `@functools.lru_cache` là decorator ghi nhớ kết quả các lần gọi trước, rất hữu ích với hàm đệ quy có bài toán con lặp lại.
