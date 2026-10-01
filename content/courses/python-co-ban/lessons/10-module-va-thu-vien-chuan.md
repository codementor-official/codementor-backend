---
title: Module và thư viện chuẩn
summary: Dùng lại code bằng import, những module chuẩn đáng nhớ (math, random, datetime, collections), tự viết module của mình và bước tiếp theo sau khóa học.
objectives:
  - Import module theo các cách khác nhau và biết khi nào dùng cách nào
  - Dùng các module chuẩn math, random, datetime, collections cho việc thường gặp
  - Tự tách code thành module và hiểu khối if __name__ == "__main__"
minutes: 20
---

Python nổi tiếng với câu nói "có sẵn pin" (batteries included): ngay khi cài đặt, bạn đã có hàng trăm **module** viết sẵn cho toán học, ngày giờ, xử lý file, mạng, nén dữ liệu. Biết tìm và dùng chúng là một kỹ năng quan trọng không kém tự viết code: phần lớn vấn đề thường gặp đã có người giải tốt rồi.

![Kiện hàng được giao tới cửa: import mang module có sẵn vào chương trình](illustration:package-arrived)

## import

Một module là một file Python chứa các hàm, biến, lớp. Lệnh `import` nạp module để dùng:

```python
import math

print(math.sqrt(16))      # 4.0
print(math.pi)            # 3.141592653589793
print(math.gcd(12, 18))   # 6  (ước chung lớn nhất)
print(math.ceil(4.1))     # 5  (làm tròn lên)
```

Các cách import khác:

```python
from math import sqrt, floor     # lấy riêng vài tên
print(sqrt(25), floor(3.9))

import datetime as dt            # đặt tên ngắn
print(dt.date.today())
```

Nên chọn cách nào? `import math` rồi viết `math.sqrt` cho biết rõ hàm đến từ đâu, dễ đọc khi chương trình lớn. `from ... import` tiện khi dùng một hàm rất nhiều lần. **Tránh** `from math import *`: nó đổ mọi tên vào chương trình và có thể ghi đè tên của bạn mà bạn không hề hay biết.

## Vài module chuẩn đáng nhớ

**random**: số ngẫu nhiên.

```python
import random

print(random.randint(1, 6))               # xúc xắc: số nguyên từ 1 tới 6
print(random.choice(["kéo", "búa", "bao"]))
ds = [1, 2, 3, 4, 5]
random.shuffle(ds)                        # xáo trộn tại chỗ
```

**datetime**: ngày và giờ.

```python
from datetime import date, timedelta

hom_nay = date(2026, 10, 1)
han_nop = hom_nay + timedelta(days=14)
print(han_nop)                       # 2026-10-15
print((han_nop - hom_nay).days)      # 14
print(han_nop.strftime("%d/%m/%Y"))  # 15/10/2026
```

Tính ngày bằng tay rất dễ sai: năm nhuận, tháng 30 hay 31 ngày. `datetime` đã xử lý hết những điều đó.

**collections**: cấu trúc dữ liệu bổ sung.

```python
from collections import Counter, deque

dem = Counter("hoc hoc nua hoc".split())
print(dem.most_common(1))    # [('hoc', 3)]

hang_doi = deque([1, 2, 3])
hang_doi.append(4)
print(hang_doi.popleft())    # 1, lấy ra ở đầu rất nhanh
```

`Counter` là phiên bản có sẵn của mẫu đếm bằng dict bạn đã học. `deque` là hàng đợi hai đầu, thao tác ở **cả hai đầu** đều nhanh, khắc phục điểm yếu của list khi `pop(0)`. Bạn sẽ dùng nó nhiều ở khóa Cấu trúc dữ liệu.

## Tự tra cứu tài liệu

Không ai nhớ hết mọi hàm của thư viện chuẩn, và bạn cũng không cần nhớ. Trong trình thông dịch tương tác, `help(math.gcd)` in ra mô tả của một hàm, còn `dir(math)` liệt kê mọi tên trong module. Nguồn tham khảo đầy đủ và chính xác nhất là tài liệu chính thức tại [docs.python.org](https://docs.python.org/3/library/index.html). Hãy tập thói quen tra tài liệu gốc trước khi tìm câu trả lời trên diễn đàn: tài liệu luôn đúng với phiên bản bạn đang dùng.

## Tự viết module

Bất kỳ file `.py` nào cũng là một module. Giả sử bạn có file `tien_ich.py`:

```python
# tien_ich.py
def la_so_nguyen_to(n):
    if n < 2:
        return False
    i = 2
    while i * i <= n:
        if n % i == 0:
            return False
        i += 1
    return True

if __name__ == "__main__":
    # chỉ chạy khi chạy trực tiếp file này
    print(la_so_nguyen_to(97))
```

Ở file khác cùng thư mục:

```python
from tien_ich import la_so_nguyen_to
print([x for x in range(20) if la_so_nguyen_to(x)])
```

Khối `if __name__ == "__main__":` là một quy ước quan trọng. Khi bạn **chạy trực tiếp** `tien_ich.py`, biến đặc biệt `__name__` có giá trị `"__main__"` và khối đó chạy. Khi file được **import** từ nơi khác, `__name__` là `"tien_ich"` và khối đó **không** chạy. Nhờ vậy một file vừa dùng được như thư viện, vừa có chỗ để thử nghiệm.

## Thư viện bên ngoài

Ngoài thư viện chuẩn, cộng đồng Python có hơn nửa triệu gói trên PyPI, cài bằng `pip`:

```bash
pip install requests
```

Một vài cái tên bạn sẽ gặp: `requests` để gọi API web, `pandas` để phân tích dữ liệu dạng bảng, `fastapi` để viết web API. Trên máy của bạn, hãy tạo **môi trường ảo** cho mỗi dự án (`python -m venv .venv`) để các dự án không giẫm lên phiên bản thư viện của nhau.

## Ví dụ thực hành: đếm ngày tới hạn

Một ứng dụng nhắc việc cần in số ngày còn lại tới từng hạn nộp, và đánh dấu những việc đã quá hạn. Dữ liệu là các dòng dạng `ten_viec dd/mm/yyyy`.

```python
from datetime import date, datetime

hom_nay = date(2026, 10, 1)
viec = ["bao-cao 05/10/2026", "do-an 20/12/2026", "thi-thu 28/09/2026"]

for dong in viec:
    ten, chuoi_ngay = dong.split()
    han = datetime.strptime(chuoi_ngay, "%d/%m/%Y").date()
    con_lai = (han - hom_nay).days
    trang_thai = "QUÁ HẠN" if con_lai < 0 else f"còn {con_lai} ngày"
    print(f"{ten}: {trang_thai}")
```

`strptime` là "phân tích theo định dạng": nó đọc chuỗi ngày theo mẫu bạn đưa vào, ngược lại với `strftime` dùng để in. Phép trừ hai ngày cho ra một `timedelta`, và `.days` là số ngày chênh lệch, có thể âm. Toàn bộ chương trình không có một phép tính tháng hay năm nhuận nào do bạn tự viết.

## Lỗi thường gặp

- **Đặt tên file trùng module chuẩn**: file của bạn tên `random.py` sẽ bị import thay cho module `random` thật, và `random.randint` báo lỗi không tồn tại.
- **`from x import *`**: làm mờ nguồn gốc của tên và dễ ghi đè.
- **Quên `if __name__ == "__main__"`**: import module là thấy nó in ra kết quả thử nghiệm.
- **Tự viết lại thứ có sẵn**: trước khi viết hàm tính ngày, đếm tần suất hay hàng đợi, hãy kiểm tra thư viện chuẩn.

## Tóm tắt

- `import module` rồi dùng `module.ten`; `from module import ten` khi dùng nhiều lần.
- `math`, `random`, `datetime`, `collections` giải quyết nhiều việc thường gặp.
- Mỗi file `.py` là một module; `if __name__ == "__main__":` cho phần chỉ chạy khi chạy trực tiếp.
- Thư viện bên ngoài cài bằng `pip`, mỗi dự án một môi trường ảo.

## Bước tiếp theo

Bạn đã có đủ nền tảng: biến, điều kiện, vòng lặp, chuỗi, list, dict, hàm và module. Bước tiếp theo trong lộ trình là khóa **Cấu trúc dữ liệu cơ bản**. Ở đó bạn sẽ học cách đánh giá một chương trình nhanh hay chậm, và chọn đúng cấu trúc dữ liệu cho từng bài toán.

## Tự kiểm tra

1. Dùng `datetime`, tính xem còn bao nhiêu ngày từ hôm nay tới ngày 1/1 năm sau.
2. Vì sao một file tên `math.py` trong thư mục dự án có thể làm hỏng dòng `import math`?
