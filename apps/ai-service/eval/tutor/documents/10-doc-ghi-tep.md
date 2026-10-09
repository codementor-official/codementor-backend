# Đọc và ghi tệp

## Mở tệp với with

```python
with open("diem.txt", "r", encoding="utf-8") as f:
    for dong in f:
        print(dong.strip())
```

Câu lệnh `with` tự đóng tệp khi ra khỏi khối, kể cả khi có ngoại lệ. Luôn ghi rõ `encoding="utf-8"` khi làm việc với tiếng Việt; trên Windows, mặc định có thể là cp1252 và sẽ hỏng dấu.

## Các chế độ mở

- `"r"`: đọc (mặc định). Tệp không tồn tại sẽ ném `FileNotFoundError`.
- `"w"`: ghi, **xoá sạch** nội dung cũ nếu tệp đã có.
- `"a"`: ghi nối vào cuối tệp.
- `"x"`: tạo tệp mới, ném `FileExistsError` nếu tệp đã tồn tại.
- Thêm `"b"` cho tệp nhị phân như ảnh: `"rb"`, `"wb"`.

## Đọc tệp

- `f.read()` đọc toàn bộ thành một chuỗi — tránh với tệp lớn.
- `f.readline()` đọc một dòng.
- `f.readlines()` trả về list các dòng.
- Duyệt `for dong in f:` đọc từng dòng một, tiết kiệm bộ nhớ nhất vì tệp là một iterator.

Mỗi dòng đọc được còn giữ ký tự xuống dòng `\n` ở cuối; dùng `strip()` hoặc `rstrip("\n")` để bỏ.

## pathlib

`from pathlib import Path` cho cách làm việc với đường dẫn theo hướng đối tượng: `Path("du_lieu") / "diem.txt"` ghép đường dẫn đúng cho mọi hệ điều hành. `Path("a.txt").read_text(encoding="utf-8")` đọc nhanh cả tệp, `.exists()` kiểm tra tồn tại, `.glob("*.csv")` liệt kê tệp.

## JSON

```python
import json
with open("cau_hinh.json", "w", encoding="utf-8") as f:
    json.dump(du_lieu, f, ensure_ascii=False, indent=2)
```

`ensure_ascii=False` giữ nguyên tiếng Việt thay vì đổi thành `ạ`. Đọc lại bằng `json.load(f)`; đọc từ chuỗi dùng `json.loads(s)`. Tuple ghi ra JSON sẽ thành list khi đọc lại.

## CSV

Module `csv` có `csv.reader` và `csv.DictReader`. Khi mở tệp CSV để ghi phải truyền `newline=""` cho `open`, nếu không trên Windows sẽ có dòng trống xen giữa.
