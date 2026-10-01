---
title: Python là gì và chương trình đầu tiên
summary: Vì sao Python hợp để bắt đầu, cách một chương trình được chạy, và ba lệnh đầu tiên — print, input, chú thích.
objectives:
  - Giải thích được chương trình Python được chạy như thế nào
  - Viết chương trình in ra màn hình và đọc dữ liệu từ bàn phím
  - Dùng chú thích để giải thích ý định của đoạn code
minutes: 15
preview: true
---

Lập trình, nói gọn, là viết ra một danh sách chỉ dẫn đủ rõ ràng để máy tính làm theo mà không cần hỏi lại. Máy tính rất nhanh nhưng không biết đoán ý: nó làm **chính xác** những gì bạn viết, kể cả khi bạn viết sai. Vì vậy học lập trình thực chất là học cách diễn đạt suy nghĩ của mình một cách chặt chẽ.

![Người ngồi trước máy tính giơ tay chào: chương trình đầu tiên in ra một lời chào](illustration:hello)

Python là ngôn ngữ rất hợp để bắt đầu việc đó. Cú pháp của Python gần với tiếng Anh, ít ký hiệu thừa, nên bạn dành sức cho **cách giải quyết vấn đề** thay vì cho dấu chấm phẩy. Đồng thời Python không phải ngôn ngữ "đồ chơi": nó được dùng để xây dựng web, phân tích dữ liệu, trí tuệ nhân tạo và tự động hóa ở rất nhiều công ty lớn.

## Chương trình được chạy như thế nào

Khi bạn viết code Python và bấm chạy, một chương trình khác gọi là **trình thông dịch** (interpreter) sẽ đọc file của bạn **từ trên xuống dưới, từng dòng một**, và thực hiện từng lệnh. Nếu gặp một dòng sai cú pháp, trình thông dịch dừng lại và báo lỗi kèm số dòng.

Thứ tự từ trên xuống là quy tắc đầu tiên bạn cần nhớ. Một biến phải được tạo ra **trước** dòng sử dụng nó; một hàm phải được định nghĩa **trước** khi được gọi. Phần lớn lỗi của người mới đến từ việc quên rằng máy đọc code theo đúng thứ tự đó.

Trên CodeMentor, bạn không cần cài gì cả: khung soạn code ở trang luyện tập đã có sẵn trình thông dịch Python. Khi học sâu hơn, bạn nên cài Python trên máy (bản 3.12 trở lên) và một trình soạn thảo như VS Code để tự chạy các ví dụ.

## Lệnh đầu tiên: print

Hàm `print` in một giá trị ra màn hình. Đây là cách đơn giản nhất để chương trình "nói chuyện" với bạn:

```python
print("Xin chào, CodeMentor!")
print(2026)
print("Năm nay là", 2026)
```

Kết quả khi chạy:

```text
Xin chào, CodeMentor!
2026
Năm nay là 2026
```

Một vài điều đáng chú ý:

- Chữ đặt trong dấu nháy `"..."` là **chuỗi** (string). Python in nguyên văn nội dung bên trong dấu nháy.
- Số như `2026` không cần dấu nháy.
- Khi truyền nhiều giá trị cách nhau bởi dấu phẩy, `print` tự chèn **một dấu cách** giữa chúng và xuống dòng ở cuối.

Bạn có thể đổi ký tự ngăn cách và ký tự kết thúc bằng hai tham số `sep` và `end`:

```python
print("08", "30", "00", sep=":")   # 08:30:00
print("Đang tải", end="...")
print("xong")                       # Đang tải...xong
```

## Đọc dữ liệu: input

Hàm `input` dừng chương trình lại, chờ người dùng gõ một dòng và nhấn Enter, rồi trả về **chuỗi** vừa gõ:

```python
ten = input("Bạn tên gì? ")
print("Chào", ten)
```

Chi tiết quan trọng: `input` **luôn** trả về chuỗi, kể cả khi người dùng gõ số. Muốn làm toán, bạn phải đổi sang số bằng `int` (số nguyên) hoặc `float` (số thực):

```python
tuoi = int(input())
print("Năm sau bạn", tuoi + 1, "tuổi")
```

Trong các bài luyện tập trên CodeMentor, dữ liệu vào được hệ thống chấm bài "gõ hộ" bạn. Vì vậy khi giải bài, đừng truyền câu nhắc vào `input("...")`: câu nhắc đó sẽ bị in ra và làm sai kết quả. Chỉ cần gọi `input()`.

## Chú thích: viết cho người đọc

Mọi thứ sau ký tự `#` trên một dòng là **chú thích** (comment). Trình thông dịch bỏ qua chúng hoàn toàn. Chú thích dành cho con người — trong đó có chính bạn sau ba tháng nữa.

```python
# Đổi nhiệt độ từ độ C sang độ F
c = float(input())
f = c * 9 / 5 + 32  # công thức chuẩn, không làm tròn
print(f)
```

Một chú thích tốt giải thích **vì sao** code làm như vậy, không chỉ lặp lại code làm **gì**. `# cộng 1 vào x` là chú thích thừa; `# tính cả ngày cuối kỳ nên +1` mới có ích.

## Lỗi thường gặp

- **Quên dấu nháy**: `print(Xin chào)` báo `SyntaxError` vì Python tưởng `Xin` là tên biến.
- **Cộng chuỗi với số**: `print("Tuổi: " + 18)` báo `TypeError`. Dùng dấu phẩy `print("Tuổi:", 18)` hoặc đổi số thành chuỗi `str(18)`.
- **Quên đổi kiểu sau input**: `a = input()` rồi `a + 1` sẽ lỗi, vì `a` đang là chuỗi.
- **Thụt lề lung tung**: Python dùng thụt lề để biết khối lệnh. Một dòng thụt vào vô cớ ở đầu chương trình sẽ báo `IndentationError`.

## Tóm tắt

- Trình thông dịch chạy chương trình từ trên xuống, từng dòng một.
- `print` in giá trị ra màn hình; `sep` và `end` điều khiển ký tự ngăn cách và kết thúc.
- `input` luôn trả về chuỗi; dùng `int` hoặc `float` để đổi sang số.
- Chú thích bắt đầu bằng `#`, dùng để giải thích ý định.

## Tự kiểm tra

1. Chương trình `x = input()` rồi `print(x * 2)` in ra gì khi người dùng gõ `5`? Vì sao không phải `10`?
2. Viết một dòng `print` in ra ngày `01/10/2026` từ ba giá trị `1`, `10`, `2026`, không dùng phép cộng chuỗi.
