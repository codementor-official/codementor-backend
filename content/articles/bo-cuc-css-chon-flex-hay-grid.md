---
excerpt: Một câu hỏi phân biệt được Flexbox và Grid, thay cho việc thử cả hai rồi giữ cái nào ra đúng hình. Kèm năm bố cục thường gặp và cách dựng từng cái.
takeaway: Grid chia khung theo hai chiều, khung có trước nội dung. Flexbox xếp một hàng hoặc một cột và chia phần dư, nội dung có trước khung.
---
Cả Flexbox lẫn Grid đều dựng được phần lớn bố cục hay gặp, nên người mới thường thử lần lượt và giữ lại cái nào ra đúng hình. Cách đó chạy được, nhưng bố cục sẽ vỡ ngay lần đầu nội dung dài hơn dự tính.

Có một câu hỏi tách bạch được hai thứ: **khung của bạn được quyết định trước, hay do nội dung quyết định?**

## Grid — khung có trước

Khi bạn biết trang chia thành mấy cột mấy hàng trước khi biết sẽ nhét gì vào, đó là Grid. Bạn khai báo khung, rồi đặt phần tử vào ô. Bố cục trang chủ, dashboard, thư viện ảnh đều thuộc nhóm này.

```css
.page {
  display: grid;
  grid-template-columns: 240px 1fr;
  grid-template-rows: auto 1fr auto;
  grid-template-areas:
    "sidebar header"
    "sidebar main"
    "sidebar footer";
  min-height: 100vh;
}
.page > header { grid-area: header; }
.page > aside  { grid-area: sidebar; }
.page > main   { grid-area: main; }
```

Điểm mạnh thật sự của Grid là canh theo cả hai chiều cùng lúc. Ba thẻ ở ba cột khác nhau vẫn thẳng hàng đáy dù nội dung dài ngắn khác nhau, mà không cần đặt chiều cao cố định cho cái nào.

## Flexbox — nội dung có trước

Khi bạn có một dãy phần tử và cần chúng nằm trên một hàng (hoặc một cột) rồi chia nhau chỗ trống, đó là Flexbox. Thanh điều hướng, nhóm nút, hàng thẻ tag — số phần tử thay đổi theo dữ liệu, và bạn không muốn khai báo trước là có mấy cái.

```css
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.toolbar .search { flex: 1; }       /* chiếm phần còn lại */
.toolbar .actions { margin-left: auto; } /* đẩy về bên phải */
```

Flexbox làm việc trên một chiều. Đó không phải hạn chế, đó là điều khiến nó đơn giản hơn cho đúng loại việc này.

## Năm bố cục thường gặp

**Lưới thẻ tự xuống hàng.** Grid với `auto-fill` tự tính số cột theo bề rộng, không cần media query:

```css
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}
```

**Căn giữa một phần tử.** Cả hai đều làm được trong hai dòng:

```css
.center { display: grid; place-items: center; }
```

**Header: logo trái, menu phải.** Flexbox với `justify-content: space-between`.

**Danh sách tag xuống dòng.** Flexbox với `flex-wrap: wrap` và `gap` — số tag do dữ liệu quyết định.

**Form nhãn–ô nhập thẳng hàng.** Grid hai cột `max-content 1fr`: mọi nhãn chung một cột, ô nhập thẳng hàng dù nhãn dài ngắn khác nhau.

## Chỗ hay nhầm

**Lồng Flexbox nhiều tầng để giả lập một cái lưới** là dấu hiệu rõ nhất bạn đang cần Grid. Ngược lại, dùng Grid cho một hàng nút bấm thì phải khai báo số cột — mà số nút lại do dữ liệu quyết định, nên bạn sẽ quay lại sửa nó.

**Quên `min-width: 0`.** Phần tử con trong Flexbox mặc định không co nhỏ hơn nội dung của nó, nên một chuỗi dài không có khoảng trắng sẽ đẩy tràn cả hàng. Thêm `min-width: 0` vào phần tử co giãn (và `overflow-wrap: anywhere` cho chữ) là hết.

**Dùng margin để tạo khoảng cách giữa các phần tử.** Cả Flexbox lẫn Grid đều có `gap`, không bị nhân đôi ở giữa và không thừa ở mép.

**`1fr` không phải "chia đều tuyệt đối".** Cột `1fr` vẫn không co nhỏ hơn nội dung tối thiểu của nó. Muốn chia đều thật sự, dùng `minmax(0, 1fr)`.

## Hai thứ đi cùng nhau

Thực tế hai thứ thường kết hợp: Grid dựng khung trang, rồi trong từng ô là Flexbox xếp nội dung.

```css
.layout { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
.card   { display: flex; flex-direction: column; gap: 12px; }
.card .footer { margin-top: auto; } /* nút luôn nằm đáy thẻ */
```

Không phải chọn một bỏ một — mà là dùng đúng cái cho đúng tầng.

## Tóm tắt

Khung quyết định trước, hai chiều: Grid. Nội dung quyết định, một chiều, chia chỗ trống: Flexbox. Dùng `gap` thay margin, nhớ `min-width: 0` và `minmax(0, 1fr)` khi nội dung dài, và đừng ngại kết hợp cả hai trong cùng một trang.
