---
title: Bảng băm — vì sao dict và set nhanh
summary: Hàm băm biến khóa thành chỉ số mảng, xử lý va chạm, vì sao tra cứu trung bình O(1), và các mẫu bài toán giải bằng bảng băm như phát hiện trùng lặp.
objectives:
  - Giải thích cách bảng băm dùng hàm băm để tra cứu trong O(1) trung bình
  - Mô tả va chạm và cách xử lý bằng dây chuyền hoặc dò tuyến tính
  - Nhận ra bài toán "đã thấy chưa?" và giải bằng set/dict
minutes: 25
---

Ở khóa Python, bạn đã dùng `dict` và `set` và biết rằng kiểm tra `x in tap_hop` rất nhanh. Bài này trả lời câu hỏi **vì sao**. Câu trả lời là bảng băm, một trong những ý tưởng hữu ích nhất của khoa học máy tính.

## Ý tưởng: biến khóa thành chỉ số

Mảng truy cập theo chỉ số trong `O(1)`. Nếu khóa của ta là số nguyên nhỏ, ta có thể dùng thẳng khóa làm chỉ số. Nhưng khóa thường là chuỗi như `"an@gmail.com"`, hoặc số rất lớn như mã giao dịch.

Bảng băm giải quyết bằng một **hàm băm** (hash function): biến bất kỳ khóa nào thành một số nguyên, rồi lấy dư cho kích thước mảng để ra chỉ số:

```text
chỉ số = hash(khóa) % kích thước mảng
```

Để tra cứu, ta tính lại đúng phép tính đó rồi nhìn vào đúng ô đó, không cần duyệt các ô khác. Đó là lý do tra cứu là `O(1)`.

```python
print(hash("an@gmail.com") % 8)   # một số trong 0..7, mỗi lần chạy có thể khác
print(hash(42), hash((1, 2)))
```

Python chủ ý xáo trộn giá trị băm của chuỗi giữa các lần chạy chương trình, để kẻ xấu không đoán trước được và cố tình gửi các khóa va chạm nhau làm chậm máy chủ. Trong cùng một lần chạy, cùng một khóa luôn có cùng giá trị băm.

Hàm băm tốt cần ba tính chất: **xác định** (cùng khóa luôn cho cùng kết quả), **nhanh** để tính, và **rải đều** các khóa khác nhau ra khắp mảng.

## Va chạm

Vì số khóa có thể có là vô hạn còn số ô là hữu hạn, chắc chắn sẽ có hai khóa khác nhau rơi vào cùng một ô. Đó là **va chạm** (collision). Hai cách xử lý phổ biến:

- **Dây chuyền** (chaining): mỗi ô chứa một danh sách nhỏ các cặp khóa–giá trị. Va chạm thì nối thêm vào danh sách của ô đó.
- **Dò địa chỉ mở** (open addressing): ô đã có người thì thử ô kế tiếp theo một quy tắc cố định, cho tới khi gặp ô trống. Python dùng một biến thể của cách này cho `dict`.

Dưới đây là một bảng băm dây chuyền tối giản để thấy rõ cơ chế:

```python
class BangBam:
    def __init__(self, so_o=8):
        self.o = [[] for _ in range(so_o)]

    def _vi_tri(self, khoa):
        return hash(khoa) % len(self.o)

    def dat(self, khoa, gia_tri):
        day = self.o[self._vi_tri(khoa)]
        for cap in day:
            if cap[0] == khoa:
                cap[1] = gia_tri      # khóa đã có: ghi đè
                return
        day.append([khoa, gia_tri])

    def lay(self, khoa):
        for k, v in self.o[self._vi_tri(khoa)]:
            if k == khoa:
                return v
        raise KeyError(khoa)

b = BangBam()
b.dat("cafe", 25000)
b.dat("tra", 15000)
print(b.lay("tra"))   # 15000
```

## Vì sao "trung bình" O(1)

Nếu mỗi ô chỉ có vài phần tử, tra cứu là `O(1)`. Nếu quá nhiều khóa dồn vào một ô, tra cứu suy biến thành duyệt danh sách, `O(n)`. Hai điều giữ cho trường hợp xấu không xảy ra trong thực tế:

1. Hàm băm tốt rải đều khóa.
2. Khi bảng **quá đầy** (tỷ lệ số phần tử trên số ô vượt một ngưỡng, khoảng 2/3 với `dict` của Python), bảng được **mở rộng** và băm lại toàn bộ, giống mảng động gấp đôi. Chi phí mở rộng chia đều ra thành `O(1)` khấu hao.

Vì vậy ta nói thao tác bảng băm là `O(1)` **trung bình**, khác với `O(1)` **chắc chắn** của truy cập mảng theo chỉ số.

## Vì sao khóa phải bất biến

Nếu khóa là một list và bạn sửa list đó sau khi đã đặt vào dict, giá trị băm của nó thay đổi, và phần tử nằm ở ô "sai" mãi mãi, không tra lại được. Python ngăn điều này bằng cách chỉ cho phép khóa **bất biến**: số, chuỗi, tuple. Đó là lý do `{[1, 2]: "x"}` báo lỗi `unhashable type: 'list'`.

## Mẫu bài toán: "đã thấy chưa?"

Rất nhiều bài toán quy về câu hỏi lặp lại "phần tử này đã xuất hiện trước đó chưa?". Với list, mỗi câu hỏi là `O(n)`, cả bài là `O(n²)`. Với set, cả bài là `O(n)`:

```python
def phan_tu_lap_dau_tien(a):
    da_thay = set()
    for i, x in enumerate(a):
        if x in da_thay:
            return x, i + 1
        da_thay.add(x)
    return None

print(phan_tu_lap_dau_tien([3, 8, 5, 8, 3, 1]))   # (8, 4)
```

Cùng mẫu này giải được bài toán "hai số có tổng bằng K" trên mảng **chưa** sắp xếp: duyệt từng số `x`, hỏi xem `K - x` đã thấy chưa.

```python
def co_cap_tong_k(a, k):
    da_thay = set()
    for x in a:
        if k - x in da_thay:
            return True
        da_thay.add(x)
    return False
```

So với hai con trỏ ở bài mảng động: hai con trỏ cần mảng đã sắp xếp nhưng chỉ tốn `O(1)` bộ nhớ thêm; bảng băm không cần sắp xếp nhưng tốn `O(n)` bộ nhớ. Chọn cách nào tùy dữ liệu đầu vào và giới hạn bộ nhớ.

## Lỗi thường gặp

- **Dùng list để kiểm tra thành viên lặp đi lặp lại**: đổi sang set.
- **Dùng khóa khả biến** như list hay dict.
- **Tin rằng dict/set luôn O(1)**: trường hợp xấu là `O(n)`, hiếm nhưng có.
- **Phụ thuộc vào thứ tự của set**: set không đảm bảo thứ tự; sắp xếp trước khi in.

## Tóm tắt

- Bảng băm dùng hàm băm biến khóa thành chỉ số mảng, cho tra cứu trung bình `O(1)`.
- Va chạm xử lý bằng dây chuyền hoặc dò địa chỉ mở; bảng mở rộng khi quá đầy.
- Khóa phải bất biến để giá trị băm không đổi.
- Bài toán "đã thấy chưa?" giải trong `O(n)` bằng set thay vì `O(n²)` bằng list.

## Tự kiểm tra

1. Dùng dict, kiểm tra hai chuỗi có phải là **đảo chữ** của nhau không (cùng các ký tự với cùng số lần, ví dụ `"listen"` và `"silent"`).
2. Vì sao một bảng băm có 8 ô chứa 1000 khóa lại chậm, dù hàm băm rất tốt?
