---
title: Xử lý lỗi và đọc dữ liệu đầu vào
summary: Đọc thông điệp lỗi cho đúng, bắt ngoại lệ bằng try/except, và các cách đọc dữ liệu đầu vào nhanh, chắc chắn mà bài tập lập trình hay dùng.
objectives:
  - Đọc traceback để tìm đúng dòng và nguyên nhân lỗi
  - Bắt và xử lý ngoại lệ bằng try/except mà không nuốt mất lỗi thật
  - Đọc dữ liệu nhiều dòng, nhiều số một cách nhanh và an toàn
minutes: 20
---

Lỗi không phải dấu hiệu bạn học kém; nó là một phần bình thường của lập trình. Người lập trình giỏi không phải người không gặp lỗi, mà là người **đọc lỗi nhanh** và biết chương trình nên phản ứng thế nào khi dữ liệu không như mong đợi.

![Người cầm búa xử lý con bọ trên màn hình: bắt và xử lý lỗi trong chương trình](illustration:fixing-bugs)

## Đọc thông điệp lỗi

Khi chương trình gặp lỗi lúc chạy, Python in ra một **traceback**:

```text
Traceback (most recent call last):
  File "main.py", line 3, in <module>
    tuoi = int(du_lieu)
ValueError: invalid literal for int() with base 10: 'mười tám'
```

Đọc **từ dưới lên**:

1. Dòng cuối là **loại lỗi** (`ValueError`) và **mô tả**: không đổi được chữ `'mười tám'` thành số nguyên.
2. Phía trên là **vị trí**: file `main.py`, dòng 3, kèm nội dung dòng đó.

Một số loại lỗi bạn sẽ gặp nhiều nhất:

- `SyntaxError`: viết sai cú pháp, chương trình không chạy được dòng nào.
- `NameError`: dùng biến hoặc hàm chưa định nghĩa, thường do gõ sai tên.
- `TypeError`: dùng sai kiểu, ví dụ cộng chuỗi với số.
- `ValueError`: đúng kiểu nhưng giá trị không hợp lệ, như `int("abc")`.
- `IndexError`, `KeyError`: truy cập chỉ số hoặc khóa không tồn tại.
- `ZeroDivisionError`: chia cho 0.

## try / except

Khi bạn **biết trước** một thao tác có thể lỗi và biết nên làm gì khi đó, hãy bắt lỗi:

```python
du_lieu = input()
try:
    tuoi = int(du_lieu)
except ValueError:
    print("Tuổi phải là một số nguyên")
else:
    print("Năm sau bạn", tuoi + 1, "tuổi")
```

- Khối `try` chứa code có thể lỗi.
- `except ValueError` chỉ bắt đúng loại lỗi đó. Lỗi loại khác vẫn dừng chương trình như bình thường.
- Khối `else` chạy khi **không** có lỗi. Đặt code "tiếp tục công việc" ở đây giúp khối `try` nhỏ gọn, chỉ bao đúng dòng có thể lỗi.
- Còn có khối `finally` luôn chạy dù có lỗi hay không, thường dùng để dọn dẹp như đóng file.

Ví dụ hỏi lại cho tới khi người dùng nhập đúng:

```python
while True:
    try:
        n = int(input("Nhập số lượng: "))
        if n <= 0:
            raise ValueError("phải dương")
        break
    except ValueError:
        print("Không hợp lệ, nhập lại.")
```

`raise` tự **phát sinh** một ngoại lệ, ở đây để dùng chung một nhánh xử lý cho cả "không phải số" lẫn "số không dương".

## Đừng nuốt lỗi

Cách viết sau trông an toàn nhưng rất nguy hiểm:

```python
try:
    ket_qua = tinh_toan_phuc_tap()
except:
    pass
```

`except:` trống bắt **mọi** lỗi, kể cả lỗi do chính bạn gõ sai tên biến, rồi `pass` lặng lẽ bỏ qua. Chương trình chạy tiếp với dữ liệu sai và bạn không có manh mối nào. Luôn bắt **loại lỗi cụ thể**, và chỉ bắt khi bạn có cách xử lý thật sự.

Trong bài tập lập trình, dữ liệu vào được đảm bảo đúng định dạng đề bài, nên bạn hiếm khi cần `try/except`. Hãy dùng nó cho chương trình làm việc với người dùng thật, file và mạng.

## Đọc dữ liệu cho bài tập

Đề bài thường cho dữ liệu nhiều dòng. Vài mẫu đọc bạn nên thuộc:

```python
# Một số trên một dòng
n = int(input())

# Nhiều số trên một dòng
a, b = map(int, input().split())
ds = list(map(int, input().split()))

# n dòng, mỗi dòng một cặp
cap = [tuple(map(int, input().split())) for _ in range(n)]
```

Khi dữ liệu rất lớn (hàng trăm nghìn dòng), gọi `input()` nhiều lần chậm. Đọc **toàn bộ** một lần rồi tách:

```python
import sys

du_lieu = sys.stdin.read().split()
q = int(du_lieu[0])
for i in range(q):
    a = int(du_lieu[1 + 2 * i])
    b = int(du_lieu[2 + 2 * i])
    print(a + b)
```

`sys.stdin.read().split()` cho một danh sách mọi "từ" trong dữ liệu vào, bất kể chúng nằm trên dòng nào. Cách này nhanh và không quan tâm dữ liệu xuống dòng ra sao. Nhược điểm là bạn mất thông tin dòng, nên với dữ liệu là văn bản có dấu cách, hãy đọc theo dòng bằng `sys.stdin.read().split("\n")`.

In nhiều kết quả cũng nên gom lại rồi in một lần:

```python
ket_qua = []
for a, b in cac_cap:
    ket_qua.append(str(a + b))
print("\n".join(ket_qua))
```

## Ví dụ thực hành: đọc file cấu hình an toàn

Chương trình của bạn đọc số lượng tối đa từ một dòng cấu hình do người khác soạn. Nếu dòng đó trống hoặc không phải số, chương trình nên dùng giá trị mặc định và **báo cho người dùng biết**, chứ không dừng đột ngột cũng không im lặng bỏ qua.

```python
MAC_DINH = 50

def doc_gioi_han(dong):
    try:
        gia_tri = int(dong)
    except ValueError:
        print(f"Cảnh báo: '{dong}' không phải số, dùng mặc định {MAC_DINH}")
        return MAC_DINH
    if gia_tri <= 0:
        print(f"Cảnh báo: {gia_tri} không dương, dùng mặc định {MAC_DINH}")
        return MAC_DINH
    return gia_tri

print(doc_gioi_han("120"))   # 120
print(doc_gioi_han("abc"))   # cảnh báo rồi 50
print(doc_gioi_han("-3"))    # cảnh báo rồi 50
```

So sánh với `except: pass`: ở đây lỗi vẫn được xử lý, nhưng người dùng **thấy** điều gì đã xảy ra và chương trình chạy tiếp với một giá trị có chủ đích. Khối `try` chỉ bao đúng một dòng có thể lỗi, còn việc kiểm tra số dương nằm ngoài vì nó là quy tắc nghiệp vụ, không phải lỗi chuyển đổi.

## Lỗi thường gặp

- **Đọc traceback từ trên xuống** và sửa nhầm chỗ: dòng cuối mới nói lỗi gì.
- **`except:` trống** che giấu lỗi thật.
- **Khối `try` quá lớn**: không biết dòng nào gây lỗi; chỉ bao đúng dòng có thể lỗi.
- **In câu nhắc trong bài tập**: `input("Nhập n: ")` làm thừa chữ ở đầu ra và bị chấm sai.

## Tóm tắt

- Traceback đọc từ dưới lên: loại lỗi, mô tả, rồi vị trí.
- `try/except LoaiLoi` bắt lỗi cụ thể; `else` cho phần chạy khi không lỗi; `raise` để tự phát sinh lỗi.
- Không dùng `except:` trống để bỏ qua lỗi.
- Dữ liệu lớn: `sys.stdin.read().split()` một lần, in kết quả bằng `join`.

## Tự kiểm tra

1. Đoạn `int("3.5")` báo lỗi gì? Làm sao đổi chuỗi `"3.5"` thành số nguyên `3`?
2. Viết đoạn đọc `n` rồi `n` số trên **cùng một dòng** và in ra tổng của chúng.
