---
excerpt: try/catch quanh await bắt được ít hơn bạn tưởng, và bỏ sót đúng những lỗi khó tìm nhất. Năm tình huống thường gặp và cách xử lý từng cái.
takeaway: Promise bị bỏ rơi không đi vào catch nào. Mỗi promise phải được await, hoặc được xử lý lỗi ngay tại chỗ tạo ra nó.
---
`async/await` làm mã bất đồng bộ đọc như mã tuần tự, nên người ta cũng xử lý lỗi như với mã tuần tự: bọc `try/catch` quanh khối là xong. Phần lớn thời gian đúng. Chỗ nó sai lại đúng là chỗ khó tìm nhất — lỗi không hiện ngay, mà hiện ở một nơi khác, muộn hơn, không còn dấu vết dẫn về nơi gây ra.

## 1. Promise không được await thì không ai bắt

`try/catch` chỉ bắt được lỗi của biểu thức bạn thật sự `await`.

```javascript
async function saveProfile(user) {
  try {
    validate(user);
    updateDatabase(user);   // quên await!
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
```

`updateDatabase` vẫn chạy và vẫn có thể hỏng — nhưng hàm đã trả về `{ ok: true }` từ trước, và lỗi rơi ra ngoài mọi `catch`, thành một cảnh báo *unhandled rejection*. Trên Node.js từ phiên bản 15, unhandled rejection mặc định làm tiến trình dừng hẳn.

Bật quy tắc lint `@typescript-eslint/no-floating-promises` (hoặc `require-await` cho JavaScript) để công cụ bắt giúp bạn loại lỗi này.

## 2. Chạy song song thì lỗi đầu tiên thắng

`Promise.all` dừng ở lỗi đầu tiên và bỏ qua kết quả của những cái còn lại — nhưng chúng vẫn đang chạy, và có thể vẫn ghi dữ liệu.

```javascript
// Nếu một ảnh lỗi, cả lô bị coi là lỗi, dù các ảnh khác đã tải xong
const urls = await Promise.all(files.map(upload));

// Muốn biết kết quả từng cái
const results = await Promise.allSettled(files.map(upload));
const failed = results.filter((r) => r.status === "rejected");
if (failed.length) console.warn(`${failed.length} ảnh tải lên thất bại`);
```

`Promise.allSettled` không bao giờ reject, và trả về trạng thái từng cái để bạn tự quyết định: thử lại cái hỏng, báo cho người dùng, hay bỏ qua.

## 3. Vòng lặp: tuần tự hay song song

`forEach` không đợi hàm `async` bên trong — vòng lặp chạy xong ngay, lỗi bên trong không ai bắt:

```javascript
// SAI: forEach bỏ qua promise trả về
items.forEach(async (item) => await save(item));

// Tuần tự, dừng ở lỗi đầu tiên
for (const item of items) {
  await save(item);
}

// Song song, chờ tất cả
await Promise.all(items.map((item) => save(item)));
```

Chọn tuần tự khi thứ tự quan trọng hoặc cần giới hạn tải lên hệ thống khác; chọn song song khi các việc độc lập.

## 4. Bắt lỗi rồi nuốt mất

```javascript
try {
  await chargeCard(order);
} catch (error) {
  console.log(error);   // ghi log rồi chạy tiếp như chưa có gì
}
await markOrderPaid(order);  // đơn được đánh dấu đã trả dù thẻ chưa bị trừ
```

Chỉ bắt lỗi ở nơi bạn thật sự xử lý được. Nếu không, ghi log kèm ngữ cảnh rồi ném tiếp (`throw error`), hoặc bọc lại với thông tin rõ hơn:

```javascript
throw new Error(`Không trừ được tiền cho đơn ${order.id}`, { cause: error });
```

Thuộc tính `cause` giữ nguyên lỗi gốc cùng stack trace của nó.

## 5. Không có thời gian chờ

Một request treo mãi thì `await` cũng chờ mãi, không có lỗi nào được ném ra. Đặt giới hạn thời gian cho mọi lời gọi ra ngoài:

```javascript
const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
```

Quá 5 giây, `fetch` reject với lỗi `TimeoutError` — lúc đó `try/catch` của bạn mới có việc để làm.

## Một quy tắc gọn

Mỗi promise sinh ra phải kết thúc ở một trong hai chỗ: **được await**, hoặc **được gắn `.catch()` ngay tại nơi tạo ra nó**. Không có chỗ thứ ba.

```javascript
// Cố ý không chờ (ví dụ gửi analytics), nhưng vẫn xử lý lỗi
sendAnalytics(event).catch((error) => logger.warn({ error }, "analytics failed"));
```

Quy tắc này bắt được gần hết các loại lỗi nói trên mà không cần nhớ thêm gì.

## Lưới an toàn cuối cùng

Đăng ký bộ xử lý toàn cục để ít nhất lỗi bị bỏ sót được ghi lại thay vì biến mất:

```javascript
// Trình duyệt
window.addEventListener("unhandledrejection", (event) => report(event.reason));

// Node.js
process.on("unhandledRejection", (reason) => logger.error({ reason }, "unhandled rejection"));
```

Đây là lưới an toàn để phát hiện lỗi, không phải nơi xử lý lỗi.

## Tóm tắt

Quên `await`, `Promise.all` dừng sớm, `forEach` với hàm `async`, nuốt lỗi và thiếu thời gian chờ là năm nguồn lỗi bất đồng bộ phổ biến nhất. Một quy tắc giải quyết phần lớn: mọi promise phải được await hoặc gắn `.catch()` tại chỗ — và để linter nhắc bạn khi quên.
