// Seed bài viết mẫu có nội dung thật — chữ, ảnh, khối mã, danh sách — để nhìn được toàn
// bộ đường đi của module bài viết chứ không phải mấy dòng "123".
//
// Ghi THẲNG vào Postgres + MongoDB, không đi qua REST và máy trạng thái. Cố ý: seed chạy
// khi chưa có ai đăng nhập, và đi qua `moderate('approve')` sẽ bắn `evt.article.published.v1`
// cho toàn hệ thống — mỗi lần seed lại là một loạt thông báo giả gửi tới mọi người học.
//
// Idempotent theo `slug`: chạy lại thì cập nhật đúng bài đó, không đẻ thêm bản sao.
//
//   node scripts/seed-articles.mjs
//
// Nội dung do dự án tự viết. KHÔNG sao chép bài của f8.edu.vn hay bất kỳ trang nào khác.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { MongoClient } from "mongodb";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** `.env` đọc tay: script này chạy độc lập, không bootstrap Nest chỉ để lấy hai chuỗi kết nối. */
function env(key) {
  const line = readFileSync(join(repoRoot, ".env"), "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
  if (line === null) throw new Error(`thiếu ${key} trong .env`);
  return line[1].trim();
}

/** Sơ đồ vẽ sẵn, nhúng thẳng bằng data URI — seed không cần một máy chủ ảnh nào chạy kèm. */
function svg(markup) {
  return `data:image/svg+xml;base64,${Buffer.from(markup, "utf8").toString("base64")}`;
}

const pollingDiagram = svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 260" width="640" height="260">
  <rect width="640" height="260" fill="#fff7ed"/>
  <text x="160" y="34" font-family="sans-serif" font-size="17" font-weight="700" fill="#9a3412" text-anchor="middle">HTTP polling</text>
  <text x="480" y="34" font-family="sans-serif" font-size="17" font-weight="700" fill="#18181b" text-anchor="middle">WebSocket</text>
  <line x1="320" y1="20" x2="320" y2="240" stroke="#fdba74" stroke-width="1.5" stroke-dasharray="5 4"/>
  <g font-family="sans-serif" font-size="12" fill="#3f3f46">
    <rect x="45" y="60" width="82" height="30" rx="6" fill="#fff" stroke="#fdba74"/><text x="86" y="79" text-anchor="middle">Client</text>
    <rect x="193" y="60" width="82" height="30" rx="6" fill="#fff" stroke="#fdba74"/><text x="234" y="79" text-anchor="middle">Server</text>
    <rect x="365" y="60" width="82" height="30" rx="6" fill="#fff" stroke="#a1a1aa"/><text x="406" y="79" text-anchor="middle">Client</text>
    <rect x="513" y="60" width="82" height="30" rx="6" fill="#fff" stroke="#a1a1aa"/><text x="554" y="79" text-anchor="middle">Server</text>
  </g>
  <g stroke="#ea580c" stroke-width="2" fill="none">
    <path d="M127 108 H193" marker-end="url(#a)"/><path d="M193 132 H127" marker-end="url(#a)"/>
    <path d="M127 158 H193" marker-end="url(#a)"/><path d="M193 182 H127" marker-end="url(#a)"/>
    <path d="M127 208 H193" marker-end="url(#a)"/>
  </g>
  <path d="M447 130 H513" stroke="#18181b" stroke-width="2.5" marker-end="url(#b)" marker-start="url(#b)"/>
  <defs>
    <marker id="a" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill="#ea580c"/></marker>
    <marker id="b" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill="#18181b"/></marker>
  </defs>
  <text x="160" y="238" font-family="sans-serif" font-size="12" fill="#9a3412" text-anchor="middle">mở — hỏi — trả lời — đóng, lặp mãi</text>
  <text x="480" y="238" font-family="sans-serif" font-size="12" fill="#52525b" text-anchor="middle">bắt tay một lần, sau đó hai chiều</text>
</svg>`);

const tokenDiagram = svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 200" width="640" height="200">
  <rect width="640" height="200" fill="#fafafa"/>
  <g font-family="sans-serif" text-anchor="middle">
    <rect x="30" y="66" width="150" height="64" rx="8" fill="#18181b"/>
    <text x="105" y="92" font-size="13" font-weight="700" fill="#fafafa">Giá trị thô</text>
    <text x="105" y="112" font-size="12" fill="#a1a1aa">#ea580c</text>
    <rect x="245" y="66" width="150" height="64" rx="8" fill="#ea580c"/>
    <text x="320" y="92" font-size="13" font-weight="700" fill="#fff">Token ngữ nghĩa</text>
    <text x="320" y="112" font-size="12" fill="#ffedd5">--color-primary</text>
    <rect x="460" y="66" width="150" height="64" rx="8" fill="#fff" stroke="#e4e4e7" stroke-width="1.5"/>
    <text x="535" y="92" font-size="13" font-weight="700" fill="#18181b">Lớp tiện ích</text>
    <text x="535" y="112" font-size="12" fill="#71717a">bg-primary</text>
  </g>
  <g stroke="#a1a1aa" stroke-width="2" fill="none" marker-end="url(#c)">
    <path d="M182 98 H243"/><path d="M397 98 H458"/>
  </g>
  <defs><marker id="c" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill="#a1a1aa"/></marker></defs>
  <text x="320" y="168" font-family="sans-serif" font-size="12" fill="#71717a" text-anchor="middle">Đổi thương hiệu chỉ sửa ở ô giữa. Bỏ ô giữa đi thì phải sửa ở mọi component.</text>
</svg>`);

const bugFlowDiagram = svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 210" width="640" height="210">
  <rect width="640" height="210" fill="#fafafa"/>
  <g font-family="sans-serif" font-size="12.5" text-anchor="middle" fill="#18181b">
    <rect x="18" y="40" width="104" height="38" rx="19" fill="#fff" stroke="#a1a1aa"/><text x="70" y="64">Open</text>
    <rect x="152" y="40" width="104" height="38" rx="19" fill="#fff" stroke="#a1a1aa"/><text x="204" y="64">In Progress</text>
    <rect x="286" y="40" width="104" height="38" rx="19" fill="#fff" stroke="#a1a1aa"/><text x="338" y="64">Fixed</text>
    <rect x="420" y="40" width="104" height="38" rx="19" fill="#fff" stroke="#a1a1aa"/><text x="472" y="64">Retest</text>
    <rect x="286" y="140" width="104" height="38" rx="19" fill="#fff" stroke="#ea580c"/><text x="338" y="164" fill="#9a3412">Reopen</text>
    <rect x="420" y="140" width="104" height="38" rx="19" fill="#18181b"/><text x="472" y="164" fill="#fafafa">Closed</text>
  </g>
  <g stroke="#71717a" stroke-width="2" fill="none" marker-end="url(#d)">
    <path d="M122 59 H150"/><path d="M256 59 H284"/><path d="M390 59 H418"/><path d="M472 78 V138"/>
  </g>
  <path d="M420 159 H392" stroke="#ea580c" stroke-width="2" fill="none" marker-end="url(#e)"/>
  <path d="M310 140 V78" stroke="#ea580c" stroke-width="2" fill="none" marker-end="url(#e)"/>
  <defs>
    <marker id="d" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill="#71717a"/></marker>
    <marker id="e" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill="#ea580c"/></marker>
  </defs>
  <text x="250" y="200" font-family="sans-serif" font-size="11.5" fill="#9a3412" text-anchor="middle">Đường cam là đường tester quyết định: retest trượt thì bug quay lại hàng đợi.</text>
</svg>`);

const ARTICLES = [
  {
    slug: "websocket-va-socket-io-khi-nao-nen-dung",
    title: "WebSocket và Socket.IO: khi nào nên dùng, khi nào đừng",
    tagSlug: "websocket",
    readMinutes: 9,
    excerpt:
      "Realtime không phải lúc nào cũng cần một kết nối sống. Bài này phân biệt WebSocket với Socket.IO, chỉ ra ba chỗ hay vỡ khi lên production, và nêu thẳng những trường hợp nên quay về HTTP thường.",
    takeaway:
      "Chọn WebSocket khi server cần chủ động đẩy dữ liệu và độ trễ tính bằng mili giây. Còn lại, một request HTTP mỗi lần người dùng bấm vẫn rẻ hơn và dễ vận hành hơn nhiều.",
    contentHtml: `
<h2>Vấn đề bắt đầu từ chỗ nào</h2>
<p>Lần đầu làm tính năng thông báo, gần như ai cũng đi một đường giống nhau: đặt một <code>setInterval</code> ba giây, gọi <code>GET /notifications</code>, so sánh xem có gì mới không. Chạy được. Vấn đề chỉ lộ ra khi số người dùng đồng thời tăng lên.</p>
<p>Một nghìn người mở tab, mỗi người ba giây một request, là hơn ba trăm request mỗi giây — cho một endpoint mà đại đa số lần trả về đúng một mảng rỗng. Server không chết vì tải thật, nó chết vì tải giả.</p>
<img src="${pollingDiagram}" alt="So sánh HTTP polling và WebSocket">
<p><em>Polling trả tiền cho mỗi lần hỏi. WebSocket trả tiền một lần lúc bắt tay.</em></p>
<h2>WebSocket giải quyết cái gì</h2>
<p>WebSocket bắt đầu bằng một request HTTP bình thường có thêm header <code>Upgrade: websocket</code>. Server đồng ý, và từ giây đó trở đi kết nối TCP bên dưới không đóng nữa: hai bên gửi dữ liệu cho nhau bất cứ lúc nào, không cần bên kia hỏi trước.</p>
<p>Điểm mấu chốt không phải là "nhanh hơn". Điểm mấu chốt là <strong>server chủ động gửi được</strong>. Với polling, dữ liệu mới nằm chờ tới nhịp hỏi kế tiếp; với WebSocket, nó đi ngay.</p>
<h3>Socket.IO khác gì WebSocket thuần</h3>
<p>Socket.IO <em>không phải</em> một cách viết khác của WebSocket. Nó là một giao thức riêng chạy bên trên, và nó thêm vào bốn thứ mà tự làm sẽ mất khá nhiều thời gian:</p>
<ul>
  <li><strong>Tự kết nối lại</strong> kèm backoff — mạng 4G rớt sóng trong thang máy là chuyện bình thường.</li>
  <li><strong>Phòng (room)</strong> — gửi cho một nhóm người mà không phải tự giữ danh sách socket.</li>
  <li><strong>Sự kiện có tên</strong> thay vì tự quy ước một khuôn JSON rồi tự phân nhánh.</li>
  <li><strong>Đường lui</strong> sang HTTP long-polling khi hạ tầng chặn WebSocket.</li>
</ul>
<p>Cái giá phải trả: client buộc phải dùng thư viện Socket.IO. Một <code>new WebSocket(url)</code> thuần sẽ không bắt tay nổi với server Socket.IO.</p>
<h2>Một ví dụ đủ chạy</h2>
<p>Phía server, gom mỗi người dùng vào một phòng mang chính id của họ. Nhờ vậy gửi riêng cho một người và phát cho cả nhóm dùng chung một cơ chế:</p>
<pre><code class="language-javascript">io.use(async (socket, next) => {
  // Xác thực Ở ĐÂY, không phải trong handler sự kiện. Handler chạy sau khi kết nối đã
  // được chấp nhận — lúc đó từ chối thì socket đã nằm trong danh sách đang mở rồi.
  const token = socket.handshake.auth.token;
  try {
    socket.data.user = await verifyAccessToken(token);
    next();
  } catch {
    next(new Error("unauthorized"));
  }
});

io.on("connection", (socket) => {
  socket.join(\`user:\${socket.data.user.id}\`);
  socket.on("disconnect", () => console.log("rời:", socket.data.user.id));
});

export function notify(userId, payload) {
  io.to(\`user:\${userId}\`).emit("notification:new", payload);
}</code></pre>
<p>Phía client, điều đáng chú ý là token đi trong <code>auth</code> chứ không phải query string:</p>
<pre><code class="language-javascript">const socket = io("https://api.example.com", {
  path: "/realtime",
  auth: { token: accessToken },
});

socket.on("notification:new", (item) => store.prepend(item));
socket.on("connect_error", (error) => {
  if (error.message === "unauthorized") refreshTokenThenReconnect();
});</code></pre>
<blockquote>Query string bị ghi vào access log của mọi proxy trên đường đi. Access token nằm trong đó là access token nằm trong file log — và log thì thường được giữ lâu hơn tuổi thọ của token rất nhiều.</blockquote>
<h2>Ba chỗ hay vỡ khi lên production</h2>
<h3>1. Nhiều instance thì emit không tới</h3>
<p>Chạy hai instance sau một load balancer: người A nối vào instance 1, người B nối vào instance 2. Instance 1 gọi <code>io.to("user:B").emit(...)</code> và không có chuyện gì xảy ra cả, vì instance 1 không giữ socket của B.</p>
<p>Lời giải là một adapter dùng chung — Redis là lựa chọn phổ biến nhất — để các instance chuyển tiếp sự kiện cho nhau. Việc này phải tính từ lúc thiết kế; phát hiện ra sau khi scale là lúc khó sửa nhất.</p>
<h3>2. Token hết hạn nhưng kết nối vẫn sống</h3>
<p>Xác thực chỉ chạy một lần lúc bắt tay. Access token sống 15 phút, còn kết nối có thể sống nhiều giờ. Nếu không làm gì, một phiên đã bị thu hồi vẫn tiếp tục nhận dữ liệu.</p>
<p>Cách nhẹ nhất là đặt hạn cho chính kết nối: sau một khoảng thời gian thì server chủ động ngắt, client tự nối lại bằng token mới. Không cần cơ chế gia hạn phức tạp.</p>
<h3>3. Nối lại thành công nhưng dữ liệu bị thủng</h3>
<p>Socket.IO tự nối lại, nhưng nó không biết trong lúc rớt mạng đã có sự kiện nào trôi qua. Người dùng thấy giao diện "sống" trở lại và tin rằng mình không bỏ lỡ gì.</p>
<p>Cách xử lý đơn giản mà đúng: sau mỗi lần <code>connect</code>, gọi một request HTTP lấy lại trạng thái hiện tại. Kết nối sống lo phần <em>mới</em>, HTTP lo phần <em>đúng</em>.</p>
<pre><code class="language-javascript">socket.on("connect", () => {
  // Không tin vào những gì socket đã bỏ lỡ — hỏi lại nguồn sự thật.
  void refetchNotifications();
});</code></pre>
<h2>Khi nào thì đừng dùng</h2>
<p>Kết nối sống là trạng thái, và trạng thái thì tốn tiền: mỗi socket là một chỗ trong bộ nhớ, một mục trong bảng kết nối, một thứ phải nghĩ tới khi deploy. Nếu rơi vào một trong các trường hợp dưới đây, HTTP thường vẫn là câu trả lời tốt hơn:</p>
<ul>
  <li>Dữ liệu chỉ đổi khi chính người dùng thao tác — họ bấm, ta gọi API, xong.</li>
  <li>Trễ vài giây không ảnh hưởng gì: bảng thống kê, báo cáo, danh sách đơn hàng.</li>
  <li>Thông tin cần đẩy chỉ vài lần mỗi ngày. Server-Sent Events rẻ hơn nhiều và chạy trên HTTP sẵn có.</li>
</ul>
<p>Câu hỏi cần trả lời trước khi mở kết nối không phải "realtime có ngầu không", mà là "có ai đó đang chờ dữ liệu này mà không hề bấm gì không". Trả lời được là chọn được.</p>
`,
  },
  {
    slug: "tailwind-css-dung-nhu-mot-design-system",
    title: "Tailwind CSS: dùng như một design system, đừng dùng như bảng tra class",
    tagSlug: "tailwind-css",
    readMinutes: 8,
    excerpt:
      "Tailwind không tự làm giao diện đẹp lên. Nó chỉ đổi chỗ của sự lộn xộn — từ file CSS sang thuộc tính class. Bài này nói về lớp token ở giữa, thứ quyết định dự án đi được xa hay không.",
    takeaway:
      "Đừng viết màu và khoảng cách thô vào class. Định nghĩa token ngữ nghĩa trước, để mọi component nói cùng một ngôn ngữ — lúc đó đổi thương hiệu hay thêm dark mode chỉ là sửa vài dòng.",
    contentHtml: `
<h2>Cái mà Tailwind không hứa</h2>
<p>Nhiều người kỳ vọng chuyển sang Tailwind là giao diện tự nhất quán. Không phải. Tailwind là một bộ tiện ích ánh xạ gần như một–một với thuộc tính CSS. Viết <code>text-[#1a73e8]</code> thì cũng lộn xộn hệt như viết <code>color: #1a73e8</code> rải rác trong stylesheet — chỉ khác là giờ nó nằm trong HTML.</p>
<p>Thứ thật sự tạo ra tính nhất quán là <strong>lớp token nằm giữa</strong> giá trị thô và lớp tiện ích.</p>
<img src="${tokenDiagram}" alt="Ba lớp: giá trị thô, token ngữ nghĩa, lớp tiện ích">
<h2>Đặt tên theo vai trò, không theo màu</h2>
<p>So sánh hai cách khai báo dưới đây. Cả hai đều chạy, nhưng chỉ một cái sống sót qua lần đổi nhận diện thương hiệu đầu tiên:</p>
<pre><code class="language-css">/* Đặt tên theo màu: tới lúc thương hiệu đổi sang xanh thì tên biến thành lời nói dối. */
--color-orange-600: #ea580c;

/* Đặt tên theo vai trò: đổi giá trị, mọi chỗ dùng vẫn đúng nghĩa. */
--color-primary: #ea580c;
--color-danger: #dc2626;
--color-border: #e4e4e7;
--color-text-muted: #71717a;</code></pre>
<p>Nguyên tắc kiểm tra rất nhanh: nếu đổi giá trị của biến mà cái tên trở nên sai, thì cái tên đó đặt theo hình thức chứ không theo vai trò.</p>
<h3>Thang bậc, không phải giá trị tuỳ hứng</h3>
<p>Khoảng cách cũng vậy. Khi mỗi người tự chọn <code>mt-[13px]</code>, <code>mt-3</code>, <code>mt-3.5</code> theo cảm giác, giao diện trông "gần đúng" ở mọi nơi và không đúng ở đâu cả. Một thang bốn năm bậc là đủ cho hầu hết sản phẩm:</p>
<ul>
  <li><strong>2</strong> — khoảng cách trong một cụm: nhãn và ô nhập.</li>
  <li><strong>4</strong> — giữa các phần tử cùng nhóm.</li>
  <li><strong>6</strong> — giữa các nhóm trong một thẻ.</li>
  <li><strong>10</strong> — giữa các khối lớn trên trang.</li>
</ul>
<blockquote>Ràng buộc không làm nghèo thiết kế. Nó lấy đi những lựa chọn không đáng phải cân nhắc, để dành sức cho những lựa chọn đáng.</blockquote>
<h2>Class sprawl và cách chặn từ gốc</h2>
<p>Ai cũng gặp cảnh một cái nút mang mười tám lớp, và cái nút kế bên mang mười bảy lớp hơi khác. Phản xạ đầu tiên thường là <code>@apply</code> — và đó thường là phản xạ sai: nó dựng lại đúng lớp CSS trung gian mà Tailwind sinh ra để tránh, chỉ khác chỗ ngồi.</p>
<p>Chỗ đúng để gom là <strong>component</strong>, không phải stylesheet:</p>
<pre><code class="language-tsx">const styles = {
  base: "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors disabled:opacity-50",
  variant: {
    solid: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-border bg-background hover:bg-muted",
    ghost: "text-foreground hover:bg-muted",
  },
};

export function Button({ variant = "solid", className = "", ...props }) {
  return &lt;button className={\`\${styles.base} \${styles.variant[variant]} \${className}\`} {...props} /&gt;;
}</code></pre>
<p>Khác biệt nằm ở chỗ: một biến thể mới là thêm một dòng trong <code>variant</code>, chứ không phải một lần sao chép mười tám lớp sang chỗ khác.</p>
<h2>Dark mode là phép thử của toàn bộ hệ thống</h2>
<p>Nếu token đặt đúng, dark mode gần như miễn phí — khai lại giá trị, không đụng tới một component nào:</p>
<pre><code class="language-css">:root {
  --background: #ffffff;
  --foreground: #18181b;
  --muted: #f4f4f5;
}

.dark {
  --background: #09090b;
  --foreground: #fafafa;
  --muted: #27272a;
}</code></pre>
<p>Còn nếu phải đi tìm và sửa <code>dark:</code> ở hàng trăm chỗ, thì đó là chẩn đoán: giá trị thô đã lọt xuống tận component. Sửa ở tầng token, đừng vá ở tầng ngọn.</p>
<h2>Vài thứ dễ bỏ quên</h2>
<ul>
  <li><strong>Tương phản.</strong> Chữ phụ đúng là phải nhạt hơn, nhưng WCAG AA vẫn đòi tỉ lệ 4.5:1. <code>text-zinc-400</code> trên nền trắng thường trượt.</li>
  <li><strong>Viền focus.</strong> Đừng để <code>outline-none</code> đứng một mình. Không thay bằng <code>focus-visible:ring-2</code> là vừa xoá mất đường đi của người dùng bàn phím.</li>
  <li><strong>Chiều cao chạm.</strong> Trên di động, vùng bấm nên tối thiểu 44px. Một cái nút <code>h-8</code> đẹp trên desktop và khó bấm trên điện thoại.</li>
</ul>
<p>Tailwind rút ngắn quãng đường từ ý tưởng tới màn hình. Nó không thay ta quyết định giao diện <em>nên</em> trông như thế nào — phần đó vẫn phải viết ra, và chỗ để viết chính là lớp token.</p>
`,
  },
  {
    slug: "jira-cho-tester-moi-vong-doi-mot-bug",
    title: "Jira cho tester mới: vòng đời một bug từ lúc phát hiện tới lúc đóng",
    tagSlug: "kiem-thu",
    readMinutes: 7,
    excerpt:
      "Ngày đầu mở Jira thường là một màn hình đầy trạng thái không hiểu gì. Bài này đi hết một vòng đời bug thật: viết mô tả sao cho lập trình viên không phải hỏi lại, và ai được đổi trạng thái nào.",
    takeaway:
      "Một bug tốt trả lời đủ ba câu trước khi bị hỏi: làm gì để thấy lại, mong đợi gì, và thực tế xảy ra gì. Thiếu một câu là thêm một vòng qua lại.",
    contentHtml: `
<h2>Trạng thái không phải thủ tục hành chính</h2>
<p>Mỗi trạng thái trong Jira trả lời đúng một câu hỏi: <em>quả bóng đang ở chân ai</em>. Hiểu như vậy thì cái luồng bên dưới không còn là thứ phải học thuộc.</p>
<img src="${bugFlowDiagram}" alt="Vòng đời một bug trong Jira">
<p>Điều quan trọng nhất trong sơ đồ này: <strong>người tạo bug là người đóng bug</strong>. Lập trình viên chuyển sang <em>Fixed</em>, nghĩa là "tôi tin đã sửa xong". Chỉ tester mới có quyền nói "đúng là đã sửa" — vì chính họ là người tìm ra nó.</p>
<h2>Viết mô tả sao cho không bị hỏi lại</h2>
<p>Bug bị trả về với dòng chữ "không tái hiện được" gần như luôn là bug thiếu thông tin, chứ không phải bug không tồn tại. Một mô tả đủ dùng gồm bốn phần:</p>
<ol>
  <li><strong>Môi trường</strong> — bản build nào, trình duyệt gì, tài khoản nào.</li>
  <li><strong>Các bước</strong> — đánh số, mỗi bước một hành động, có dữ liệu cụ thể.</li>
  <li><strong>Kết quả mong đợi</strong> — và dẫn nguồn: tài liệu yêu cầu hay bản thiết kế.</li>
  <li><strong>Kết quả thực tế</strong> — kèm ảnh chụp màn hình hoặc video.</li>
</ol>
<p>So sánh nhanh. Đây là mô tả khiến bug quay lại chỗ bạn:</p>
<blockquote>Thanh toán bị lỗi, không đặt hàng được.</blockquote>
<p>Còn đây là mô tả khiến nó được sửa:</p>
<pre><code class="language-plaintext">Môi trường: web build 2.14.0, Chrome 141, tài khoản qa_buyer_02

Các bước:
1. Thêm sản phẩm "Bàn phím K3" (giá 1.290.000đ) vào giỏ
2. Áp mã giảm giá GIAM10 — giỏ hiển thị đúng 1.161.000đ
3. Chọn thanh toán khi nhận hàng
4. Bấm "Đặt hàng"

Mong đợi: đơn được tạo với tổng tiền 1.161.000đ (mục 4.2 tài liệu yêu cầu)
Thực tế:  đơn được tạo với tổng tiền 1.290.000đ — mã giảm giá bị bỏ qua
          khi phương thức là COD. Với thẻ tín dụng thì đúng.</code></pre>
<p>Chú ý câu cuối: nó đã khoanh vùng lỗi vào một nhánh cụ thể. Tester tìm ra được điều kiện phân biệt là đã làm hộ lập trình viên bước tốn thời gian nhất.</p>
<h2>Severity và Priority là hai thứ khác nhau</h2>
<p>Đây là chỗ người mới nhầm nhiều nhất, và nhầm thì bug bị xếp sai hàng đợi.</p>
<ul>
  <li><strong>Severity</strong> — hỏng nặng tới đâu về mặt kỹ thuật. Tester quyết định.</li>
  <li><strong>Priority</strong> — cần sửa gấp tới đâu về mặt kinh doanh. Product owner quyết định.</li>
</ul>
<p>Hai cái này tách rời nhau thật sự. Sai chính tả tên công ty ngay trang chủ là <em>severity thấp</em> nhưng <em>priority cao nhất</em>: sửa một dòng chữ, mà cả thị trường đang nhìn thấy. Ngược lại, ứng dụng sập khi người dùng đổi ngôn ngữ sang tiếng Nhật là <em>severity cao</em> nhưng có thể <em>priority thấp</em>, nếu sản phẩm chưa phát hành ở Nhật.</p>
<h2>Ba thói quen tiết kiệm rất nhiều thời gian</h2>
<h3>Tìm trùng trước khi tạo mới</h3>
<p>Gõ thẳng vào ô tìm kiếm của Jira cụm từ đặc trưng nhất — thường là thông báo lỗi. Bug trùng làm loãng hàng đợi và khiến số liệu cuối sprint sai lệch.</p>
<h3>Đính kèm bằng chứng, đừng mô tả bằng chứng</h3>
<p>Một đoạn video mười giây thay được ba đoạn văn. Nếu lỗi nằm ở phía giao diện, chụp thêm tab Network hoặc Console — nhiều khi lập trình viên nhìn ảnh là biết ngay chỗ hỏng.</p>
<h3>Retest đúng cái đã báo, rồi mới nhìn rộng ra</h3>
<p>Khi bug chuyển sang <em>Fixed</em>, chạy lại đúng các bước đã ghi trước. Đạt rồi thì mới kiểm tra vùng xung quanh — vì một bản vá hay kéo theo hồi quy ở chỗ khác. Đóng bug mà chưa nhìn quanh là cách phổ biến để một lỗi cũ quay lại dưới tên mới.</p>
<h2>Điều không có trong tài liệu nào</h2>
<p>Bug là câu chuyện về sản phẩm, không phải về người viết ra nó. Mô tả nên nói "chức năng tính giảm giá bỏ qua mã khi thanh toán COD", đừng nói "phần này làm ẩu quá". Cách viết trung tính không phải phép lịch sự suông — nó giữ cho cuộc trao đổi ở lại trên hiện tượng quan sát được, và đó là chỗ duy nhất hai bên có thể cùng kiểm chứng.</p>
`,
  },
];

async function main() {
  const prisma = new PrismaClient();
  const mongo = await MongoClient.connect(env("MONGO_URI"));
  const contents = mongo.db(env("MONGO_DB")).collection("article_contents");

  // Tác giả: lấy một giảng viên có sẵn. Bài viết phải có tác giả thật thì trang danh sách
  // mới hiện được tên và chữ cái đầu ở ảnh đại diện.
  const [author] = await prisma.$queryRawUnsafe(
    `SELECT id FROM users WHERE role = 'lecturer' AND status <> 'deleted' ORDER BY created_at LIMIT 1`,
  );
  if (author === undefined) throw new Error("chưa có tài khoản giảng viên nào để gán làm tác giả");

  for (const article of ARTICLES) {
    const [tag] = await prisma.$queryRawUnsafe(`SELECT id FROM tags WHERE slug = $1`, article.tagSlug);
    if (tag === undefined) throw new Error(`chưa có chủ đề "${article.tagSlug}" — chạy seed tags trước`);

    const html = article.contentHtml.trim();

    // Bài phải tồn tại trước khi ghi nội dung: `content_ref` trỏ sang Mongo, còn Mongo
    // khoá theo `articleId` bên Postgres. Chèn hàng trước để có id, ghi nội dung, rồi
    // cập nhật con trỏ — cùng thứ tự mà `saveContent` của learning-service đang làm.
    const [row] = await prisma.$queryRawUnsafe(
      `INSERT INTO articles (slug, title, excerpt, takeaway, author_id, tag_id, read_minutes, status, published_at)
       VALUES ($1, $2, $3, $4, $5::uuid, $6::uuid, $7, 'draft', now())
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title, excerpt = EXCLUDED.excerpt, takeaway = EXCLUDED.takeaway,
         author_id = EXCLUDED.author_id, tag_id = EXCLUDED.tag_id, read_minutes = EXCLUDED.read_minutes
       RETURNING id`,
      article.slug,
      article.title,
      article.excerpt,
      article.takeaway,
      author.id,
      tag.id,
      article.readMinutes,
    );

    const written = await contents.findOneAndUpdate(
      { articleId: row.id },
      { $set: { contentHtml: html, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, returnDocument: "after" },
    );

    // `published` chỉ hợp lệ khi đã có cả `published_at` lẫn `content_ref` — ràng buộc
    // `articles_published_needs_date_and_body` chặn ngay ở tầng cơ sở dữ liệu.
    await prisma.$executeRawUnsafe(
      `UPDATE articles SET content_ref = $2, status = 'published' WHERE id = $1::uuid`,
      row.id,
      String(written._id),
    );

    console.log(`  ${article.slug}  (${html.length} ký tự)`);
  }

  await mongo.close();
  await prisma.$disconnect();
  console.log(`\nĐã seed ${ARTICLES.length} bài viết.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
