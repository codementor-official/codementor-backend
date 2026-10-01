---
title: Dictionary và set
summary: Tra cứu theo khóa thay vì theo vị trí — dictionary để đếm và nhóm dữ liệu, set để loại trùng và kiểm tra thành viên thật nhanh.
objectives:
  - Tạo, đọc, cập nhật dictionary và duyệt qua cặp khóa–giá trị
  - Dùng dictionary để đếm tần suất và nhóm dữ liệu
  - Dùng set để loại trùng và kiểm tra thành viên, biết vì sao nó nhanh hơn list
minutes: 25
---

List lưu dữ liệu theo **vị trí**: phần tử thứ 0, thứ 1, thứ 2. Nhưng nhiều khi ta muốn tra cứu theo **tên**: điểm của học sinh "An" là bao nhiêu, mã sản phẩm "SP01" giá bao nhiêu. Dò từng phần tử trong list để tìm là chậm và rườm rà. Dictionary sinh ra cho việc này.

## Dictionary: tra cứu theo khóa

Dictionary (gọi tắt là dict) lưu các cặp **khóa: giá trị**, viết trong ngoặc nhọn:

```python
gia = {"cafe": 25000, "tra": 15000, "banh": 30000}
print(gia["cafe"])        # 25000

gia["sinh_to"] = 35000    # thêm khóa mới
gia["tra"] = 18000        # cập nhật khóa đã có
del gia["banh"]           # xóa
print(gia)                # {'cafe': 25000, 'tra': 18000, 'sinh_to': 35000}
print(len(gia), "cafe" in gia)   # 3 True
```

Khóa phải là kiểu **bất biến**: chuỗi, số, tuple. List không làm khóa được. Mỗi khóa là duy nhất; gán lại cùng khóa sẽ ghi đè giá trị cũ.

Truy cập một khóa không tồn tại bằng `gia["xyz"]` báo `KeyError`. Khi không chắc khóa có tồn tại, dùng `get` với giá trị mặc định:

```python
print(gia.get("xyz"))        # None
print(gia.get("xyz", 0))     # 0
```

## Duyệt dictionary

```python
for mon, tien in gia.items():
    print(f"{mon}: {tien:,} đ")

print(list(gia.keys()))      # các khóa
print(list(gia.values()))    # các giá trị
```

Từ Python 3.7, dict giữ đúng **thứ tự thêm vào**, nên duyệt dict cho kết quả ổn định.

## Mẫu kinh điển: đếm tần suất

Đếm mỗi thứ xuất hiện bao nhiêu lần là việc dict làm tốt nhất:

```python
van_ban = "hoc hoc nua hoc mai nua"
dem = {}
for tu in van_ban.split():
    dem[tu] = dem.get(tu, 0) + 1
print(dem)    # {'hoc': 3, 'nua': 2, 'mai': 1}
```

Dòng `dem.get(tu, 0) + 1` gói gọn hai trường hợp: từ mới gặp (giá trị mặc định 0, cộng 1 thành 1) và từ đã gặp (cộng thêm 1). Chương trình chỉ duyệt văn bản **một lần**, dù văn bản dài tới đâu.

Để lấy những từ xuất hiện nhiều nhất, sắp xếp các cặp theo số lần:

```python
xep_hang = sorted(dem.items(), key=lambda cap: (-cap[1], cap[0]))
for tu, so_lan in xep_hang[:2]:
    print(tu, so_lan)     # hoc 3 / nua 2
```

`-cap[1]` để số lần giảm dần, `cap[0]` để các từ cùng số lần xếp theo thứ tự chữ cái. Đây chính là lời giải cốt lõi của bài tập cuối chương.

Python có sẵn `collections.Counter` làm đúng việc đếm này, kèm phương thức `most_common`. Hãy tự viết bằng dict một lần để hiểu cơ chế, rồi dùng `Counter` khi đã quen.

## Nhóm dữ liệu

Dict có giá trị là list giúp gom các phần tử theo một tiêu chí:

```python
hoc_sinh = [("An", "10A"), ("Bình", "10B"), ("Chi", "10A")]
theo_lop = {}
for ten, lop in hoc_sinh:
    theo_lop.setdefault(lop, []).append(ten)
print(theo_lop)   # {'10A': ['An', 'Chi'], '10B': ['Bình']}
```

`setdefault(lop, [])` trả về list của lớp đó, tạo list rỗng nếu chưa có.

Module `collections` còn có `defaultdict`, một dictionary tự tạo giá trị mặc định cho khóa chưa có. Với `theo_lop = defaultdict(list)`, bạn viết thẳng `theo_lop[lop].append(ten)` mà không cần `setdefault`. Cả hai cách cho cùng kết quả; hãy chọn cách mà người đọc code của bạn dễ hiểu nhất. Điều quan trọng hơn là nhận ra **mẫu**: "gom các phần tử theo một khóa" luôn gợi tới dictionary chứa list.

## Set: tập hợp không trùng lặp

Set là tập các phần tử **không trùng nhau** và **không có thứ tự**:

```python
email = ["a@x.com", "b@x.com", "a@x.com"]
duy_nhat = set(email)
print(duy_nhat, len(duy_nhat))   # {'a@x.com', 'b@x.com'} 2

lop_a = {"An", "Bình", "Chi"}
lop_b = {"Chi", "Dũng"}
print(lop_a & lop_b)   # {'Chi'}         giao
print(lop_a | lop_b)   # hợp
print(lop_a - lop_b)   # {'An', 'Bình'}  hiệu
```

Lưu ý: `{}` tạo **dict rỗng**, không phải set rỗng. Set rỗng viết là `set()`.

## Vì sao dict và set nhanh

Kiểm tra `x in danh_sach` phải so sánh `x` với từng phần tử, nên list một triệu phần tử cần tới một triệu phép so sánh. Dict và set dùng kỹ thuật **băm** (hashing): từ giá trị của khóa, Python tính ra ngay vị trí lưu trữ. Vì vậy `x in tap_hop` gần như tức thì, bất kể tập lớn cỡ nào.

```python
da_xem = set()
for ma in cac_ma_san_pham:
    if ma in da_xem:          # nhanh
        print("Trùng:", ma)
    da_xem.add(ma)
```

Quy tắc thực hành: khi chương trình phải hỏi "phần tử này đã có chưa?" nhiều lần, hãy dùng set (hoặc dict), đừng dùng list. Khóa Cấu trúc dữ liệu sẽ giải thích bảng băm hoạt động ra sao.

## Ví dụ thực hành: tổng tiền theo từng khách

Một file nhật ký bán hàng có mỗi dòng gồm tên khách và số tiền một lần mua. Hãy in tổng tiền của từng khách, khách mua nhiều nhất ở trên cùng.

```python
n = int(input())
tong = {}
for _ in range(n):
    ten, tien = input().split()
    tong[ten] = tong.get(ten, 0) + int(tien)

for ten, so_tien in sorted(tong.items(), key=lambda c: (-c[1], c[0])):
    print(ten, so_tien)
```

Đây vẫn là mẫu đếm tần suất, chỉ khác là thay vì cộng `1` ta cộng **số tiền**. Rất nhiều bài toán thống kê ngoài đời đều quy về mẫu này: tổng doanh thu theo tháng, số lượt truy cập theo trang, số lỗi theo loại. Khi nhận ra "gom theo một khóa rồi cộng dồn", bạn biết ngay phải dùng dictionary.

## Lỗi thường gặp

- **Đọc khóa không tồn tại bằng `d[k]`**: dùng `d.get(k, mac_dinh)` hoặc kiểm tra `k in d` trước.
- **Dùng list làm khóa**: `TypeError: unhashable type: 'list'`. Đổi sang tuple.
- **Viết `{}` khi muốn set rỗng**.
- **Kỳ vọng set giữ thứ tự**: nếu cần thứ tự, sắp xếp khi in ra.

## Tóm tắt

- Dict tra cứu theo khóa; `get` an toàn hơn `[]` khi khóa có thể thiếu.
- Mẫu đếm: `dem[k] = dem.get(k, 0) + 1`; nhóm: `setdefault(k, []).append(v)`.
- Set loại trùng và hỗ trợ giao, hợp, hiệu.
- Kiểm tra thành viên trong dict/set nhanh hơn rất nhiều so với list.

## Tự kiểm tra

1. Cho danh sách số, dùng set để in ra các số xuất hiện từ hai lần trở lên.
2. Với yêu cầu "cùng số lần thì xếp theo thứ tự chữ cái", vì sao `key=lambda c: -c[1]` chưa đủ? Sửa lại `key` cho đúng.
