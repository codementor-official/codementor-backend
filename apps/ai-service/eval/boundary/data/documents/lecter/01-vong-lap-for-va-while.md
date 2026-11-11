# Vòng lặp for và while trong Python

## Vòng lặp for

Vòng lặp `for` duyệt qua từng phần tử của một đối tượng lặp được (iterable) như list, chuỗi, tuple, dict hay `range`. Mỗi vòng, biến lặp nhận giá trị của phần tử kế tiếp.

```python
for ky_tu in "abc":
    print(ky_tu)
```

Hàm `range(start, stop, step)` sinh dãy số nguyên từ `start` tới **trước** `stop`. `range(5)` cho 0, 1, 2, 3, 4 — không có 5. Đây là nguồn gốc của phần lớn lỗi lệch một đơn vị (off-by-one) ở học viên mới.

Muốn có cả chỉ số lẫn giá trị, dùng `enumerate`:

```python
for i, gia_tri in enumerate([10, 20, 30]):
    print(i, gia_tri)
```

## Vòng lặp while

`while` lặp chừng nào điều kiện còn đúng. Phải bảo đảm thân vòng lặp làm điều kiện tiến dần tới sai, nếu không chương trình lặp vô hạn.

```python
n = 10
while n > 0:
    n -= 3
```

## break, continue và else

- `break` thoát ngay khỏi vòng lặp gần nhất.
- `continue` bỏ qua phần còn lại của vòng hiện tại, sang vòng kế tiếp.
- Mệnh đề `else` gắn với vòng lặp chạy khi vòng lặp kết thúc bình thường, tức là không bị `break`.

## Gợi ý soạn bài tập

Bài tập về vòng lặp cho người mới nên kiểm tra được: biên của `range`, trường hợp danh sách rỗng, và một trường hợp có `break` sớm. Ví dụ đề phù hợp: tính tổng các số chẵn trong một danh sách, đếm số chữ số của một số nguyên dương, tìm phần tử đầu tiên lớn hơn một ngưỡng.
