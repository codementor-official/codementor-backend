---
excerpt: API công khai là lời hứa. Vài quyết định ở ngày đầu — hình dạng lỗi, phân trang, phiên bản — quyết định bạn còn sửa được nó hay phải sống chung với nó mãi.
takeaway: Thêm trường thì an toàn. Đổi ý nghĩa, đổi kiểu hay bỏ một trường đã có thì không. Thiết kế để còn đổi ý được về sau.
---
Khác biệt lớn nhất giữa hàm nội bộ và API công khai không phải kỹ thuật, mà là quyền sửa. Hàm nội bộ đổi tên lúc nào cũng được — trình biên dịch chỉ ra mọi chỗ gọi. API đã có người gọi thì mỗi thay đổi là một lần làm hỏng thứ đang chạy ở nơi bạn không nhìn thấy: một ứng dụng di động chưa cập nhật, một đối tác tích hợp, một script ai đó viết từ năm ngoái.

Bài này đi qua những quyết định nên làm đúng ngay từ đầu để còn đổi ý được về sau.

## Thêm thì được, đổi thì không

Thêm một trường vào phản hồi gần như luôn an toàn: bên gọi chưa biết thì bỏ qua. Những thay đổi sau thì không:

- Đổi kiểu một trường: `"price": 99000` thành `"price": "99.000 ₫"`.
- Bỏ một trường, hoặc đổi tên nó.
- Thêm một trường **bắt buộc** vào request.
- Đổi ý nghĩa mà giữ nguyên tên: `total` từ "chưa gồm thuế" thành "đã gồm thuế".

Loại cuối nguy hiểm nhất, vì không có công cụ nào phát hiện được — mọi kiểm tra kiểu đều xanh, chỉ có con số trên hoá đơn là sai.

Cần một ý nghĩa khác thì thêm trường mới bên cạnh, đánh dấu trường cũ là sẽ bỏ, rồi bỏ sau khi không còn ai gọi:

```json
{
  "total": 99000,
  "totalIncludingTax": 108900,
  "_deprecated": { "total": "Dùng totalIncludingTax. Sẽ bỏ sau 2027-06-30." }
}
```

Chậm hơn, nhưng không có buổi tối nào phải quay lui.

## Lỗi cũng là một phần hợp đồng

Mã lỗi và hình dạng phản hồi lỗi được bên gọi xử lý bằng mã, y như dữ liệu thành công. Đổi một mã lỗi là một thay đổi phá vỡ tương thích, dù chẳng có trường nào trong phần dữ liệu bị đụng tới.

Cho lỗi một hình dạng ổn định ngay từ đầu — một mã máy đọc được, một câu cho người đọc, và chi tiết khi cần:

```json
{
  "code": "COUPON_EXPIRED",
  "message": "Mã giảm giá đã hết hạn.",
  "details": { "expiredAt": "2026-10-31T23:59:59Z" },
  "requestId": "7f3a9c2e"
}
```

Bên gọi rẽ nhánh theo `code`, hiển thị `message` cho người dùng, và gửi `requestId` khi báo lỗi. Bạn được tự do sửa câu chữ của `message`, nhưng giữ nguyên `code`. Dùng mã trạng thái HTTP đúng nghĩa: 400 cho đầu vào sai, 401 chưa đăng nhập, 403 không có quyền, 404 không tìm thấy, 409 xung đột, 422 vi phạm quy tắc nghiệp vụ.

## Phân trang từ đầu

Danh sách nào rồi cũng dài ra. Trả về cả mảng khi mới có ba mươi dòng thì tiện, nhưng lúc thành ba mươi nghìn dòng, thêm phân trang là một thay đổi phá vỡ tương thích với mọi bên đang gọi — vì kiểu phản hồi đổi từ mảng sang object.

Bọc danh sách trong object ngay từ ngày đầu, kể cả khi chưa phân trang:

```json
{
  "items": [ { "id": 1, "title": "..." } ],
  "nextCursor": "eyJpZCI6NDJ9"
}
```

Phân trang theo con trỏ (`?cursor=...`) ổn định hơn theo số trang khi dữ liệu thay đổi liên tục, và nhanh như nhau ở mọi trang. Tốn thêm một buổi lúc đầu, tiết kiệm một đợt di dời sau này.

## Phiên bản: khi buộc phải phá vỡ

Đôi khi thay đổi phá vỡ là không tránh được. Đặt phiên bản vào đường dẫn ngay từ đầu (`/api/v1/...`) để có chỗ cho `/v2` mà không đụng tới bên đang dùng `v1`. Khi ra `v2`:

1. Chạy song song cả hai phiên bản.
2. Thông báo thời hạn ngừng `v1`, kèm hướng dẫn chuyển đổi.
3. Theo dõi lưu lượng còn gọi `v1`; liên hệ những bên còn lại.
4. Chỉ tắt `v1` khi lưu lượng về gần không.

Phiên bản mới là phương án cuối cùng, không phải cách làm mặc định — mỗi phiên bản song song là thêm một thứ phải duy trì.

## Những quyết định nhỏ khác đáng làm đúng sớm

- **Định danh dạng chuỗi.** Trả `id` dưới dạng chuỗi giúp bạn đổi từ số sang UUID sau này mà không phá vỡ ai; JavaScript cũng không xử lý chính xác số nguyên lớn hơn 2⁵³.
- **Thời gian theo ISO 8601 có múi giờ:** `2026-11-02T10:41:07Z`, không phải `02/11/2026`.
- **Tên trường nhất quán:** chọn `camelCase` hoặc `snake_case` cho cả API và giữ nguyên.
- **Idempotency cho thao tác tạo:** nhận header `Idempotency-Key` để bên gọi thử lại an toàn khi mạng chập chờn mà không tạo đơn trùng.
- **Viết tài liệu từ đặc tả** (OpenAPI) để tài liệu và mã không lệch nhau.

## Checklist trước khi công bố một endpoint

- Danh sách đã được bọc trong object và có phân trang.
- Lỗi có `code` ổn định, `message`, và mã HTTP đúng nghĩa.
- Không có trường nào mà ý nghĩa còn mơ hồ.
- Đường dẫn có phiên bản.
- Có đặc tả OpenAPI và ví dụ request/response.

## Tóm tắt

API công khai là lời hứa với những người bạn không nhìn thấy. Thêm thì an toàn, đổi thì không; lỗi là một phần hợp đồng; phân trang và phiên bản nên có từ ngày đầu. Vài giờ cân nhắc lúc thiết kế tiết kiệm nhiều tuần di dời về sau.
