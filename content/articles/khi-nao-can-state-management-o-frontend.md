---
excerpt: Phần lớn màn hình không cần thư viện quản lý state. Dấu hiệu nào cho biết đã đến lúc cần, và vì sao dữ liệu từ máy chủ không nên nằm trong kho toàn cục.
takeaway: Cần thư viện khi state được ĐỌC ở nhiều nhánh cây xa nhau, không phải khi nó phức tạp. Tách dữ liệu máy chủ ra trước, phần còn lại thường rất nhỏ.
---
Câu hỏi hay bị đặt sai thành "state của tôi đã đủ phức tạp chưa". Độ phức tạp không phải thứ quyết định — một form mười lăm trường vẫn sống tốt với state cục bộ. Thứ quyết định là **khoảng cách**: state được đọc ở bao nhiêu nhánh khác nhau của cây component, và chúng cách nhau bao xa.

Bài này dùng React làm ví dụ, nhưng lập luận giống hệt với Vue, Svelte hay Angular.

## Ba mức, theo đúng thứ tự nên thử

**1. State cục bộ.** Chỉ một component và con trực tiếp của nó cần đọc. Đây là phần lớn trường hợp: ô tìm kiếm, tab đang mở, modal đang hiện.

```jsx
function SearchBox() {
  const [query, setQuery] = useState("");
  return <input value={query} onChange={(e) => setQuery(e.target.value)} />;
}
```

Đừng đi xa hơn khi chưa phải.

**2. Đưa state lên cha chung và truyền qua props.** Hai component anh em cần cùng một giá trị thì đưa state lên cha chung gần nhất. Sâu hai, ba tầng vẫn đọc được, và người đọc mã thấy ngay dữ liệu chảy từ đâu tới đâu.

```jsx
function ProductPage() {
  const [variant, setVariant] = useState(null);
  return (
    <>
      <VariantPicker value={variant} onChange={setVariant} />
      <PriceTag variant={variant} />
    </>
  );
}
```

**3. Context hoặc thư viện.** Khi cùng một state bị đọc ở hai nhánh phải đi ngược lên tận gốc mới gặp nhau. Người dùng đang đăng nhập, chủ đề sáng/tối, ngôn ngữ, giỏ hàng — chúng thuộc về cả ứng dụng chứ không thuộc về một màn hình.

## Context hay thư viện?

Context của React đủ cho state **ít thay đổi**: người dùng, chủ đề, ngôn ngữ. Mỗi lần giá trị Context đổi, mọi component đọc nó đều render lại — không vấn đề gì nếu nó đổi vài lần mỗi phiên.

Thư viện (Zustand, Redux Toolkit, Jotai…) đáng cân nhắc khi state **đổi thường xuyên** và nhiều nơi chỉ đọc một phần của nó: giỏ hàng cập nhật liên tục, trình soạn thảo cộng tác, bảng điều khiển có nhiều bộ lọc liên kết. Chúng cho phép component chỉ đăng ký đúng phần dữ liệu nó cần:

```javascript
const useCart = create((set) => ({
  items: [],
  add: (item) => set((state) => ({ items: [...state.items, item] })),
}));

// Chỉ render lại khi số lượng đổi, không phải khi bất kỳ thứ gì trong giỏ đổi
const count = useCart((state) => state.items.length);
```

## Cái bẫy phổ biến nhất: dữ liệu máy chủ

Đưa dữ liệu từ máy chủ vào kho state toàn cục. Dữ liệu máy chủ không phải state của ứng dụng — nó là **một bản sao có hạn dùng**, cần biết lúc nào cũ, lúc nào phải tải lại, lúc nào đang tải, và khi nhiều màn hình cùng cần thì tải một lần. Nhét nó vào kho toàn cục nghĩa là bạn sẽ tự viết lại phần quản lý vòng đời đó bằng tay: cờ `isLoading`, xử lý lỗi, làm mới sau khi sửa, huỷ request cũ…

Tách hai loại ra: state của giao diện thì để trong ứng dụng; dữ liệu máy chủ thì để lớp lo việc tải và cache giữ (TanStack Query, SWR, hoặc cơ chế có sẵn của framework):

```javascript
const { data: orders, isLoading } = useQuery({
  queryKey: ["orders", userId],
  queryFn: () => api.orders(userId),
});
```

Sau khi tách, phần state toàn cục còn lại thường nhỏ tới mức không cần thư viện nào.

## Dấu hiệu đã đến lúc cần

- Cùng một state được truyền qua ba, bốn tầng component chỉ để chuyển tiếp, không tầng giữa nào dùng.
- Hai màn hình không liên quan cần đồng bộ cùng một dữ liệu phía client.
- State đổi liên tục và Context làm cả cây render lại thấy rõ (đo bằng React Profiler).
- Bạn đang tự viết cơ chế đăng ký/thông báo thay đổi bằng tay.

## Dấu hiệu chưa cần

- "Dự án sau này sẽ lớn." Thêm thư viện khi cần mất một buổi; gỡ một thư viện đã lan khắp dự án mất vài tuần.
- State chỉ phức tạp nhưng nằm gọn trong một màn hình — dùng `useReducer`.
- Phần lớn "state" thực ra là dữ liệu tải từ máy chủ.

## Tóm tắt

Bắt đầu cục bộ, đưa lên cha chung khi cần chia sẻ, dùng Context cho state ít đổi của toàn ứng dụng, và chỉ thêm thư viện khi state đổi nhiều và được đọc ở nhiều nhánh xa nhau. Tách dữ liệu máy chủ ra khỏi state giao diện ngay từ đầu — đó là quyết định giúp ứng dụng đơn giản hơn cả.
