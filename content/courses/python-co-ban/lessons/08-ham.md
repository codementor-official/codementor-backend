---
title: Hàm — đóng gói và tái sử dụng
summary: Định nghĩa hàm với def, tham số và giá trị mặc định, return so với print, phạm vi biến, và cách chia chương trình thành các hàm nhỏ dễ kiểm tra.
objectives:
  - Định nghĩa và gọi hàm có tham số, giá trị mặc định và giá trị trả về
  - Phân biệt return và print, hiểu phạm vi biến cục bộ
  - Tách một chương trình thành các hàm nhỏ, mỗi hàm làm một việc
minutes: 25
---

Khi chương trình dài lên, bạn sẽ thấy mình chép đi chép lại cùng một đoạn code: kiểm tra số nguyên tố ở chỗ này, rồi lại ở chỗ kia. Chép code nghĩa là khi phát hiện lỗi, bạn phải sửa ở **mọi** bản chép. Hàm giải quyết việc đó: viết một lần, đặt tên, gọi ở bất cứ đâu.

## Định nghĩa và gọi hàm

```python
def chao(ten):
    print(f"Xin chào, {ten}!")

chao("An")
chao("Bình")
```

- `def` bắt đầu định nghĩa hàm, tiếp theo là **tên hàm** và danh sách **tham số** trong ngoặc.
- Thân hàm thụt vào bên dưới, giống khối `if`.
- Định nghĩa hàm **không chạy** thân hàm; chỉ khi **gọi** `chao("An")` thì thân hàm mới chạy, với `ten` mang giá trị `"An"`.

Vì Python đọc từ trên xuống, hàm phải được định nghĩa **trước** dòng gọi nó.

## return: trả kết quả về

Hàm hữu ích nhất là hàm **tính ra một giá trị** và trả về cho nơi gọi:

```python
def dien_tich_hcn(dai, rong):
    return dai * rong

s = dien_tich_hcn(4, 5)
print(s * 2)    # 40
```

Phân biệt rõ `return` và `print`:

- `print` hiển thị giá trị ra màn hình rồi thôi. Code gọi hàm **không nhận** được giá trị đó.
- `return` gửi giá trị về nơi gọi để **dùng tiếp**: gán vào biến, tính toán, truyền cho hàm khác.

Một hàm không có `return` sẽ trả về `None`. Đây là nguồn của lỗi rất hay gặp:

```python
def tong_sai(a, b):
    print(a + b)        # chỉ in, không trả

x = tong_sai(2, 3)      # in ra 5
print(x * 2)            # TypeError: None * 2
```

`return` còn **kết thúc** hàm ngay lập tức. Điều này cho phép viết kiểu "thoát sớm" rất gọn:

```python
def la_so_nguyen_to(n):
    if n < 2:
        return False
    i = 2
    while i * i <= n:
        if n % i == 0:
            return False
        i += 1
    return True
```

Hàm này chỉ thử chia tới căn bậc hai của `n`: nếu `n` có ước lớn hơn căn của nó thì chắc chắn có một ước tương ứng nhỏ hơn căn, và ta đã gặp nó rồi.

## Tham số mặc định và tham số có tên

```python
def gia_sau_giam(gia, phan_tram=10):
    return gia * (100 - phan_tram) // 100

print(gia_sau_giam(200000))                   # 180000 (giảm mặc định 10%)
print(gia_sau_giam(200000, 25))               # 150000
print(gia_sau_giam(gia=200000, phan_tram=5))  # gọi theo tên, rõ nghĩa
```

Tham số có giá trị mặc định phải đứng **sau** các tham số bắt buộc. Gọi theo tên giúp lời gọi tự giải thích, nhất là khi hàm có nhiều tham số cùng kiểu.

Một hàm có thể trả về nhiều giá trị, thực chất là trả về một tuple:

```python
def thong_ke(ds):
    return min(ds), max(ds), sum(ds) / len(ds)

nho, lon, tb = thong_ke([4, 8, 6])
```

## Phạm vi biến

Biến tạo ra **bên trong** hàm là biến **cục bộ**: nó chỉ tồn tại trong lúc hàm chạy, và không đụng tới biến cùng tên ở bên ngoài.

```python
tong = 100

def tinh():
    tong = 5          # biến cục bộ mới, KHÔNG phải biến tong ở trên
    return tong

print(tinh())   # 5
print(tong)     # 100
```

Đây là điều tốt: mỗi hàm là một hộp kín, đọc một hàm không cần biết cả chương trình đang có những biến nào. Quy tắc thực hành: hàm nhận dữ liệu qua **tham số** và trả kết quả qua **return**, tránh đọc hay sửa biến bên ngoài.

## Chia chương trình thành hàm

Hãy so sánh hai cách viết cùng một chương trình đếm số nguyên tố trong nhiều đoạn:

```python
def la_so_nguyen_to(n):
    ...  # như ở trên

def dem_trong_doan(a, b):
    return sum(1 for x in range(a, b + 1) if la_so_nguyen_to(x))

def main():
    q = int(input())
    for _ in range(q):
        a, b = map(int, input().split())
        print(dem_trong_doan(a, b))

main()
```

Mỗi hàm làm **một việc** và có tên nói đúng việc đó. Bạn có thể kiểm tra riêng `la_so_nguyen_to(1)`, `la_so_nguyen_to(97)` trước khi lo phần đọc dữ liệu. Khi cần tăng tốc (bài tập cuối khóa sẽ buộc bạn làm vậy), bạn chỉ phải thay ruột **một** hàm, phần còn lại giữ nguyên.

## Ví dụ thực hành: tách hàm cho dễ kiểm tra

Giả sử bạn viết chương trình tính lương: lương cơ bản cộng thưởng, rồi trừ thuế 10% với phần thu nhập vượt 11 triệu. Nếu viết tất cả trong một khối, mỗi lần nghi ngờ công thức thuế bạn phải chạy cả chương trình và gõ lại dữ liệu. Tách thành hàm thì kiểm tra từng phần rất dễ:

```python
def thue(thu_nhap):
    phan_chiu_thue = max(0, thu_nhap - 11_000_000)
    return phan_chiu_thue * 10 // 100

def thuc_linh(luong, thuong=0):
    tong = luong + thuong
    return tong - thue(tong)

assert thue(10_000_000) == 0
assert thue(21_000_000) == 1_000_000
assert thuc_linh(15_000_000, 1_000_000) == 15_500_000
print("Các kiểm tra đều đúng")
```

Lệnh `assert` kiểm tra một điều kiện và báo lỗi ngay nếu điều kiện sai. Ba dòng `assert` ở trên là những **bài kiểm tra** nhỏ: chúng chạy trong nháy mắt và cho bạn biết công thức còn đúng sau mỗi lần sửa. Chỉ hàm trả về giá trị bằng `return` mới kiểm tra được kiểu này, đây là thêm một lý do để hàm tính toán không nên chỉ `print`.

## Lỗi thường gặp

- **In thay vì trả về**: hàm tính toán nên `return`; để việc in cho phần đọc/ghi dữ liệu.
- **Quên gọi hàm**: viết `main` thay vì `main()` không chạy gì cả.
- **Dùng list hoặc dict làm giá trị mặc định**: `def f(x, ds=[])` dùng chung **một** list cho mọi lần gọi. Dùng `ds=None` rồi tạo list bên trong.
- **Hàm làm quá nhiều việc**: khi tên hàm cần chữ "và", hãy tách nó ra.

## Tóm tắt

- `def ten(tham_so):` định nghĩa hàm; gọi hàm mới chạy thân hàm.
- `return` trả giá trị và kết thúc hàm; không có `return` thì hàm trả `None`.
- Tham số mặc định đứng sau tham số bắt buộc; có thể gọi tham số theo tên.
- Biến trong hàm là cục bộ; hàm tốt nhận qua tham số, trả qua return.

## Tự kiểm tra

1. Viết hàm `uoc_chung_lon_nhat(a, b)` bằng vòng lặp `while b: a, b = b, a % b`. Thử với `(12, 18)`.
2. Vì sao `def them(x, ds=[]): ds.append(x); return ds` gọi hai lần `them(1)` lại cho `[1, 1]`?
