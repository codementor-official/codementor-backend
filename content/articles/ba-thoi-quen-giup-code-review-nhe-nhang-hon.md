---
excerpt: Review căng thẳng thường không phải vì người review khó tính, mà vì PR quá lớn và thiếu ngữ cảnh. Ba thói quen phía tác giả và vài nguyên tắc phía người review.
takeaway: PR nhỏ được review kỹ hơn và nhanh hơn. Kích thước và mô tả là hai thứ tác giả hoàn toàn kiểm soát được.
---
Code review hay bị coi là chuyện của người review. Phần lớn thứ quyết định buổi review dễ hay khó lại nằm ở tay tác giả, và nằm ở trước khi PR (pull request) được mở. Bài này đi qua ba thói quen phía tác giả, cách viết góp ý phía người review, và một mẫu mô tả PR dùng được ngay.

## 1. Giữ PR nhỏ

PR 60 dòng nhận được góp ý cụ thể. PR 1.500 dòng nhận được "nhìn ổn" — không phải vì nó ổn, mà vì không ai giữ nổi 1.500 dòng trong đầu cùng lúc. Kết quả là PR lớn được duyệt nhanh hơn nhưng kỹ kém hơn, và lỗi lọt qua đúng lúc cần bắt nhất.

Một mốc thực dụng: dưới khoảng 400 dòng thay đổi, đọc trong một lần ngồi. Vượt quá thì tách:

- **Tách cấu trúc khỏi hành vi.** Một PR đổi tên, di chuyển tệp, tách hàm mà không đổi hành vi; một PR thay đổi hành vi. Người review kiểm từng cái một, thay vì phải phân biệt hai loại thay đổi trộn lẫn trong cùng một diff.
- **Tách theo tầng.** Migration và repository trước, service sau, giao diện cuối.
- **Dùng feature flag** khi tính năng lớn chưa thể hoàn thiện trong một PR: mã được gộp dần nhưng chưa bật cho người dùng.

Kiểm tra nhanh kích thước trước khi mở PR:

```bash
git diff --stat main...HEAD
```

## 2. Tự review trước khi mở PR

Đọc lại diff của chính mình trên giao diện web trước khi bấm nút. Đổi góc nhìn từ "người viết" sang "người đọc" làm lộ ra những thứ không thấy trong trình soạn thảo. Bạn sẽ tự bắt được:

- Mã debug bỏ quên: `console.log`, `print`, breakpoint.
- Tên biến đặt vội: `data2`, `temp`, `x`.
- Tệp lỡ commit: file cấu hình cá nhân, file build, file `.env`.
- Khối mã bị comment thay vì xoá.

Đúng những thứ chiếm phần lớn số góp ý nhưng chẳng nói lên điều gì về thiết kế. Mỗi góp ý loại đó bị loại bỏ trước là một vòng qua lại được tiết kiệm. Để công cụ làm phần cơ học: chạy linter, formatter và test trước khi đẩy lên, để buổi review dành cho những thứ máy không bắt được.

## 3. Viết mô tả trả lời "vì sao"

Diff đã cho biết bạn thay đổi gì. Cái nó không cho biết là vì sao lại chọn cách này, và bạn đã cân nhắc rồi bỏ cách nào. Một mẫu mô tả ngắn:

```markdown
## Vấn đề
Trang đơn hàng tải 3–4 giây với người có nhiều đơn (N+1 khi lấy sản phẩm).

## Cách làm
Lấy sản phẩm bằng một truy vấn `WHERE id = ANY($1)` thay vì lặp.

## Đã cân nhắc
JOIN thẳng — bỏ vì nhân số dòng khi đơn có nhiều sản phẩm.

## Cách kiểm tra
Mở /orders với tài khoản test có 200 đơn: 3,8 s → 220 ms.
```

Bốn mục — vấn đề, hướng đã chọn, hướng đã loại, cách kiểm tra — biến buổi review từ giải mã ý định thành đánh giá một quyết định đã nêu rõ. Thay đổi giao diện thì kèm ảnh chụp trước và sau.

## Về phía người review

**Nói rõ mức độ của mỗi góp ý.** "Chỗ này rò kết nối" và "tôi thích tên kia hơn" mà viết cùng một giọng thì tác giả không biết cái nào phải sửa, cái nào tuỳ ý. Một quy ước tiền tố đơn giản giải quyết gần hết chuyện này:

- `blocker:` — phải sửa trước khi gộp (lỗi, lỗ hổng, mất dữ liệu).
- `suggestion:` — nên cân nhắc, tác giả quyết.
- `nit:` — chi tiết nhỏ, không bắt buộc.
- `question:` — hỏi để hiểu, không phải yêu cầu sửa.

**Góp ý vào mã, không vào người.** "Hàm này xử lý cả định dạng lẫn lưu trữ" thay vì "bạn viết hàm này rối quá". Kèm lý do hoặc đề xuất cụ thể khi có thể.

**Review sớm.** Một PR chờ hai ngày làm tác giả mất ngữ cảnh và sinh xung đột khi gộp. Nhiều nhóm thống nhất phản hồi trong vòng một ngày làm việc.

**Khen đúng chỗ.** Một dòng "cách tách hàm này dễ đọc" không tốn gì, và cho tác giả biết điều nên tiếp tục làm.

## Checklist cho tác giả

- Diff dưới khoảng 400 dòng, hoặc đã tách hợp lý.
- Đã tự đọc lại diff trên giao diện web.
- Linter, formatter, test đều chạy xanh.
- Mô tả có vấn đề, cách làm, hướng đã loại, cách kiểm tra.
- Có ảnh chụp nếu đổi giao diện.

## Tóm tắt

Buổi review nhẹ nhàng bắt đầu từ trước khi PR được mở: giữ PR nhỏ, tự review, và viết mô tả trả lời "vì sao". Người review góp phần bằng cách nói rõ mức độ góp ý, tập trung vào mã và phản hồi sớm. Làm được cả hai phía, review trở thành nơi cả nhóm học từ nhau thay vì một cửa ải.
