---
excerpt: Bảy thứ trong DevTools mà phần lớn người dùng hằng ngày vẫn chưa bật tới — mỗi thứ thay được hàng chục dòng console.log.
takeaway: Breakpoint có điều kiện và logpoint thay được hàng chục dòng console.log, mà không có dòng nào bị bỏ quên trong commit.
---
Phần lớn chúng ta dùng DevTools ở mức mở Console rồi rải `console.log`. Cách đó chạy được, nhưng mỗi lần thêm log là một lần sửa mã, tải lại trang, và hy vọng mình in đúng thứ cần xem. Bảy công cụ dưới đây đều nằm sẵn trong Chrome DevTools và tiết kiệm nhiều thời gian hơn hẳn. Mở DevTools bằng `F12` (hoặc `Cmd + Option + I` trên macOS) và thử từng cái khi đọc.

## 1. Breakpoint có điều kiện

Mở tab **Sources**, tìm tệp cần xem (`Ctrl + P` để tìm theo tên). Chuột phải vào số dòng, chọn **Add conditional breakpoint**, rồi gõ điều kiện:

```javascript
order.id === 42 && order.total > 1_000_000
```

Chương trình chỉ dừng đúng lần lặp bạn quan tâm, thay vì bấm *Continue* ba trăm lần hay in ra ba trăm dòng. Khi dừng, bạn xem được toàn bộ biến trong phạm vi ở bảng **Scope** và chạy thử biểu thức ngay trong Console với đúng ngữ cảnh đó.

## 2. Logpoint

Cùng menu đó có **Add logpoint**: in một biểu thức mỗi lần chạy qua dòng ấy, mà không sửa mã nguồn.

```javascript
'cart total', cart.items.length, cart.total
```

Logpoint không cần tải lại trang để có hiệu lực và tồn tại qua các lần tải lại. Quan trọng hơn: không có `console.log` nào bị bỏ quên trong commit, và không có log debug nào lọt lên production.

## 3. Dừng khi DOM thay đổi

Trong tab **Elements**, chuột phải một phần tử → **Break on** → chọn:

- *subtree modifications* — khi con của nó được thêm, xoá.
- *attribute modifications* — khi `class`, `style` hay thuộc tính khác đổi.
- *node removal* — khi chính nó bị gỡ khỏi trang.

Đây là cách nhanh nhất tìm ra đoạn mã nào đang đổi class hay ẩn một phần tử, khi bạn không biết nó nằm ở đâu trong hàng trăm tệp. Trình duyệt dừng đúng tại dòng gây ra thay đổi, kèm cả call stack dẫn tới đó.

## 4. Copy as fetch

Tab **Network**, chuột phải một request → **Copy** → **Copy as fetch**. Dán thẳng vào Console để chạy lại với tham số khác:

```javascript
const res = await fetch("https://api.example.com/v1/orders?page=2", {
  headers: { accept: "application/json" },
  credentials: "include",
});
console.table((await res.json()).items);
```

Đủ cả header và cookie của phiên đang đăng nhập. Nhanh hơn dựng lại request bằng tay rất nhiều, và khi cần chia sẻ cho đồng đội, *Copy as cURL* cho ra lệnh chạy được trong terminal.

## 5. Chặn request và giả lập phản hồi

Chuột phải một request → **Block request URL**. Lần tải sau, request đó thất bại — đây là cách kiểm tra giao diện xử lý ra sao khi một API hỏng, mà không phải đụng vào máy chủ. Trang có hiện thông báo lỗi tử tế không, hay trắng xoá?

Tính năng **Local overrides** (chuột phải request → *Override content*) còn cho phép sửa nội dung phản hồi: thử giao diện với một danh sách rỗng, một chuỗi rất dài, hay một trường `null` mà backend hiếm khi trả về.

## 6. Điều tiết mạng và CPU

Network throttling ai cũng biết; ít người biết tab **Performance** còn có **CPU throttling**. Đặt mức 4× hoặc 6× là gần với máy di động tầm trung — nơi phần lớn người dùng thật đang mở trang của bạn. Một hiệu ứng mượt trên laptop có thể giật thấy rõ ở mức này.

Kết hợp ghi một bản **Performance recording** khi thao tác chậm: biểu đồ cho thấy hàm nào chiếm thời gian, khi nào trình duyệt phải tính lại bố cục, và tác vụ dài nào chặn luồng chính.

## 7. Các biến tiện ích trong Console

Console có sẵn vài biến giúp bỏ bớt thao tác trung gian:

- `$0` — phần tử vừa chọn trong tab Elements. Gõ `$0.dataset` để xem thuộc tính `data-*`.
- `$_` — kết quả của biểu thức vừa chạy.
- `copy(value)` — chép một giá trị (kể cả object, dưới dạng JSON) vào clipboard.
- `console.table(array)` — hiển thị mảng object dạng bảng, dễ so sánh hơn nhiều so với `console.log`.

```javascript
copy(await (await fetch('/api/me')).json());  // chép JSON phản hồi để dán vào báo cáo lỗi
```

## Quy trình debug gợi ý

1. Tái hiện lỗi ổn định, ghi lại các bước.
2. Xem tab Network: request có gửi đi không, phản hồi đúng không?
3. Đặt breakpoint có điều kiện ở chỗ dữ liệu bắt đầu sai.
4. Nếu không biết mã nằm đâu, dùng *Break on* ở phần tử bị đổi.
5. Sửa xong, tái hiện lại đúng các bước ở bước 1.

## Tóm tắt

DevTools không chỉ là Console. Breakpoint có điều kiện, logpoint và *Break on* giúp tìm đúng chỗ hỏng mà không sửa mã; *Copy as fetch*, chặn request và override giúp thử các tình huống khó tái hiện; throttling CPU cho bạn thấy trang chạy thế nào trên máy của người dùng thật. Dành mười phút làm quen với cả bảy, bạn sẽ dùng chúng mỗi ngày.
