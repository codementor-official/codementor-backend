---
excerpt: Bọc memo khắp nơi thường làm ứng dụng chậm đi. Trước hết cần biết render lại là gì, khi nào nó thật sự tốn, và cách đo trước khi tối ưu.
takeaway: Render lại không đồng nghĩa với đụng vào DOM. Đo bằng Profiler trước, đẩy state xuống gần nơi dùng, memo sau cùng.
---
Nghe "component render lại" nhiều người tưởng trình duyệt vẽ lại màn hình. Không phải. React chạy lại hàm component để tính ra mô tả giao diện mới, so với mô tả cũ, rồi chỉ đụng vào phần DOM thật sự khác. Phần đắt nằm ở bước cuối — và bước cuối thường không xảy ra, vì phần lớn lần render lại cho ra kết quả giống hệt lần trước.

Nên câu hỏi đúng không phải "làm sao bớt render lại" mà "render lại này có tốn gì không".

## Khi nào một component render lại

Một component render lại khi:

1. State của chính nó thay đổi.
2. Component cha render lại (mặc định, mọi con đều render lại theo, bất kể props có đổi hay không).
3. Context mà nó đọc thay đổi giá trị.

Điều thứ hai hay gây bất ngờ nhất: state đổi ở gần gốc cây thì cả nhánh bên dưới chạy lại. Đó là hành vi bình thường, không phải lỗi.

## Khi nào render lại thật sự tốn

Có ba trường hợp đáng quan tâm:

- Component tính toán nặng ngay trong thân hàm: sắp xếp, lọc hàng nghìn phần tử, phân tích chuỗi lớn.
- Danh sách rất dài render cùng lúc: vài nghìn dòng, mỗi dòng nhiều phần tử.
- Cây component sâu mà gốc đổi state liên tục, ví dụ theo từng ký tự gõ vào ô tìm kiếm hoặc theo từng lần di chuột.

Ngoài ba trường hợp đó, một lần render lại tốn cỡ vài phần trăm mili giây. Bọc `memo` quanh nó thêm một phép so sánh props cho mỗi lần render — nghĩa là bạn vừa trả thêm chi phí để tránh một chi phí nhỏ hơn.

## Cách rẻ nhất: đẩy state xuống

State nằm càng thấp thì càng ít component phải render lại khi nó đổi.

```jsx
// Trước: gõ một ký tự làm cả trang (kể cả bảng 2.000 dòng) render lại
function Page() {
  const [query, setQuery] = useState("");
  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <BigTable rows={rows} />
    </>
  );
}

// Sau: state nằm trong component riêng, bảng không bị ảnh hưởng
function Page() {
  return (
    <>
      <SearchInput />
      <BigTable rows={rows} />
    </>
  );
}
```

Một biến thể khác: truyền component nặng qua `children`. Component bọc ngoài đổi state, nhưng `children` được tạo ở cấp cha nên không render lại theo.

## Vì sao memo hay không có tác dụng

`memo` so sánh props theo tham chiếu. Truyền vào một object hay một hàm tạo mới mỗi lần render thì phép so sánh luôn cho kết quả khác, và component vẫn render lại — chỉ khác là giờ có thêm phần so sánh vô ích.

```jsx
const Row = memo(function Row({ item, onSelect }) { /* ... */ });

function List({ items }) {
  // onSelect là hàm mới mỗi lần render → memo của Row vô tác dụng
  return items.map((item) => <Row key={item.id} item={item} onSelect={() => select(item.id)} />);
}
```

Muốn `memo` có tác dụng, phía cha phải giữ ổn định tham chiếu bằng `useCallback` và `useMemo`. Ba thay đổi phối hợp với nhau mới có tác dụng — và đó là lý do nên để dành nó cho chỗ đã đo được là chậm.

## Danh sách dài: ảo hoá

Với vài nghìn dòng, vấn đề không phải render lại mà là render quá nhiều phần tử cùng lúc. Ảo hoá (virtualization) chỉ render những dòng đang hiện trên màn hình, thường vài chục dòng, bất kể danh sách dài bao nhiêu. Các thư viện như TanStack Virtual làm việc này. Đơn giản hơn nữa: phân trang.

## Thứ tự nên làm

1. Mở **React DevTools → Profiler**, bấm ghi.
2. Thực hiện đúng thao tác đang thấy chậm.
3. Dừng ghi, xem biểu đồ: component nào chiếm nhiều thời gian nhất, và vì sao nó render (bật *Record why each component rendered*).
4. Sửa đúng chỗ đó: đẩy state xuống, ảo hoá danh sách, hoặc chuyển tính toán nặng vào `useMemo`.
5. Đo lại, so sánh con số.

Gần như lần nào cũng ra một chỗ cụ thể chứ không phải "cả ứng dụng render nhiều quá".

## Một lưu ý về React Compiler

Các phiên bản React mới có trình biên dịch tự động thêm memo ở nơi an toàn. Điều đó không đổi lời khuyên ở trên: cấu trúc state tốt và đo trước khi tối ưu vẫn là nền tảng, và trình biên dịch làm việc hiệu quả nhất trên mã đã tổ chức hợp lý.

## Tóm tắt

Render lại là chạy lại hàm, không phải vẽ lại màn hình, và thường rẻ. Chỉ tối ưu khi Profiler chỉ ra chỗ chậm. Cách hiệu quả nhất theo thứ tự: đẩy state xuống gần nơi dùng, ảo hoá danh sách dài, rồi mới đến `memo` kèm tham chiếu ổn định.
