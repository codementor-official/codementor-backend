---
excerpt: Clean code không phải danh sách nguyên tắc để thuộc. Năm thói quen làm mã dễ đọc hơn ngay từ tuần đầu đi làm, mỗi thói quen kèm ví dụ trước và sau.
takeaway: Mã được đọc nhiều lần hơn được viết. Tối ưu cho người đọc — người đó sáu tháng sau rất có thể là chính bạn.
---
"Clean code" hay bị hiểu thành một danh sách nguyên tắc phải thuộc. Thực tế nó chỉ là một câu hỏi lặp lại: người đọc đoạn này sau sáu tháng — nhiều khả năng là chính bạn — có hiểu ngay không? Ở chỗ làm, mã của bạn sẽ được đọc trong code review, khi debug lúc nửa đêm, và khi đồng nghiệp thêm tính năng mới. Năm thói quen dưới đây giúp mỗi lần đọc đó nhanh hơn.

## 1. Tên nói ý định, không nói kiểu dữ liệu

`userList` không nói gì hơn `users`, mà lại hứa một cấu trúc cụ thể. `activeUsers` thì nói được điều đáng nói: đây là tập đã lọc, và lọc theo gì.

```javascript
// Trước
const d = 86400;
const list = users.filter((u) => u.s === 1);

// Sau
const SECONDS_PER_DAY = 86_400;
const activeUsers = users.filter((user) => user.status === UserStatus.ACTIVE);
```

Với hàm cũng vậy: `process()` đúng với mọi hàm trên đời. `calculateMonthlyFee()` chỉ đúng với một hàm. Hàm trả về boolean thì đặt tên như một câu hỏi: `isExpired`, `hasPermission`, `canRetry`. Nếu khó đặt tên cho một hàm, thường là vì nó đang làm hơn một việc.

## 2. Hàm làm một việc, ở một mức trừu tượng

Dấu hiệu dễ thấy hơn số dòng: một hàm vừa gọi `saveOrder()` vừa nối chuỗi định dạng ngày tháng là đang trộn hai mức — một mức nghiệp vụ, một mức thao tác chuỗi. Người đọc phải liên tục đổi tầm nhìn.

```javascript
// Trộn mức: nghiệp vụ lẫn chi tiết định dạng
async function checkout(cart) {
  const order = await saveOrder(cart);
  const d = new Date(order.createdAt);
  const label = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  await sendEmail(cart.email, `Đơn hàng ngày ${label}`);
}

// Một mức: đọc như mô tả quy trình
async function checkout(cart) {
  const order = await saveOrder(cart);
  await sendOrderConfirmation(cart.email, order);
}
```

Không phải quy tắc "hàm không quá 20 dòng". Một hàm 40 dòng làm đúng một việc ở đúng một mức đọc dễ hơn ba hàm 10 dòng gọi vòng qua nhau.

## 3. Trả về sớm thay vì lồng sâu

Kiểm tra điều kiện không hợp lệ rồi `return` ngay ở đầu hàm, phần thân chính đứng ở tầng thụt lề ngoài cùng.

```javascript
// Lồng sâu
function applyDiscount(order, code) {
  if (order) {
    if (code) {
      if (!code.expired) {
        return order.total * (1 - code.rate);
      }
    }
  }
  return order?.total ?? 0;
}

// Trả về sớm
function applyDiscount(order, code) {
  if (!order) return 0;
  if (!code || code.expired) return order.total;
  return order.total * (1 - code.rate);
}
```

Bốn tầng `if` lồng nhau buộc người đọc giữ bốn điều kiện trong đầu cùng lúc; trả về sớm thì mỗi điều kiện xử lý xong là quên được.

## 4. Chú thích giải thích VÌ SAO

`// tăng i lên 1` là tiếng ồn — mã đã nói điều đó. Còn chú thích này mới đáng viết, vì không có cách nào đọc ra được từ mã:

```javascript
// API ngân hàng trả tháng bắt đầu từ 1, không phải 0 như Date của JavaScript.
const month = response.month - 1;
```

Nói chung: mã trả lời *làm gì*, chú thích trả lời *vì sao*. Thấy mình đang viết chú thích cho câu hỏi "làm gì" thì thường là dấu hiệu nên đổi tên biến hoặc tách hàm. Và đừng để lại mã bị comment — lịch sử Git đã giữ nó cho bạn.

## 5. Xử lý lỗi rõ ràng, không nuốt lỗi

Khối `catch` rỗng là cách nhanh nhất biến một lỗi dễ sửa thành một lỗi không ai tìm ra.

```javascript
// Nuốt lỗi: hệ thống im lặng chạy tiếp với dữ liệu sai
try { await syncInventory(); } catch (e) {}

// Rõ ràng: ghi lại đủ ngữ cảnh, rồi để lỗi đi tiếp tới nơi xử lý được
try {
  await syncInventory();
} catch (error) {
  logger.error({ error, warehouseId }, 'Không đồng bộ được tồn kho');
  throw error;
}
```

Chỉ bắt lỗi ở nơi bạn thật sự làm được gì đó với nó: thử lại, trả thông báo cho người dùng, hoặc dùng giá trị thay thế có chủ đích.

## Làm sao luyện được

- **Đọc mã tốt.** Mở mã nguồn một thư viện bạn dùng hằng ngày và đọc một tệp nhỏ. Để ý cách họ đặt tên và chia hàm.
- **Học từ review.** Mỗi góp ý về khả năng đọc là một bài học miễn phí. Ghi lại những góp ý lặp lại.
- **Refactor từng bước nhỏ.** Đổi một cái tên, tách một hàm, chạy test, commit. Không cần viết lại cả tệp.
- **Theo quy ước của dự án.** Mã nhất quán với phần còn lại của dự án dễ đọc hơn mã "đúng chuẩn" nhưng khác biệt.

## Tóm tắt

Tên nói ý định, hàm làm một việc ở một mức, trả về sớm, chú thích giải thích vì sao, và không nuốt lỗi. Năm thói quen này không cần học thuộc nguyên tắc nào — chỉ cần luôn tự hỏi người đọc tiếp theo có hiểu ngay không.
