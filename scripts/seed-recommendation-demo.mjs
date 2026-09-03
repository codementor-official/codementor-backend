// Seed dữ liệu để NHÌN THẤY đề xuất đổi theo hồ sơ.
//
// Vì sao cần: dữ liệu hiện có gần như toàn bài viết Back-end và Cơ sở dữ liệu, còn các chủ
// đề Front-end / React / JavaScript / DevOps thì không có bài nào. Hai học viên khai hai
// lĩnh vực khác nhau vẫn nhận đúng một danh sách, nên không phân biệt được "đề xuất chưa
// chạy" với "đề xuất chạy nhưng không có gì để chọn khác đi".
//
// Seed này lấp đúng khoảng trống đó: mỗi lĩnh vực onboarding có ít nhất hai bài viết và một
// khóa học mang chủ đề tương ứng, ở các bậc trình độ khác nhau.
//
// Ghi THẲNG vào Postgres + MongoDB, không đi qua REST — cùng lý do đã ghi trong
// `seed-articles.mjs`: đi qua máy trạng thái sẽ bắn sự kiện `evt.article.published.v1` và
// gửi một loạt thông báo giả cho mọi người học.
//
// Idempotent theo `slug`: chạy lại thì cập nhật đúng bản ghi đó, không đẻ thêm bản sao.
//
//   node --env-file=.env scripts/seed-recommendation-demo.mjs
//
// Nội dung do dự án tự viết.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { MongoClient } from "mongodb";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function env(key) {
  const line = readFileSync(join(repoRoot, ".env"), "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
  if (line === null) throw new Error(`thiếu ${key} trong .env`);
  return line[1].trim();
}

function p(...paragraphs) {
  return paragraphs.map((text) => `<p>${text}</p>`).join("\n");
}

/**
 * Chủ đề chọn có chủ đích: `tagSlug` phải rút gọn về cùng khóa với một `interested_fields`
 * hoặc `interested_technologies` của onboarding, vì đó là cách `scoreCandidate` nối hồ sơ
 * khai với bài viết ("Front-end" và enum `frontend` cùng rút về "frontend").
 */
const ARTICLES = [
  {
    slug: "bo-cuc-css-chon-flex-hay-grid",
    tagSlug: "front-end",
    title: "Bố cục CSS: chọn Flexbox hay Grid",
    excerpt: "Một câu hỏi phân biệt được hai công cụ, thay cho việc thử cả hai rồi giữ cái nào chạy.",
    takeaway: "Grid chia khung theo hai chiều. Flexbox xếp một hàng hoặc một cột và chia phần dư.",
    readMinutes: 7,
    contentHtml: `
${p(
  "Cả Flexbox lẫn Grid đều dựng được phần lớn bố cục hay gặp, nên người mới thường thử lần lượt và giữ lại cái nào ra đúng hình. Cách đó chạy được, nhưng bố cục sẽ vỡ ngay lần đầu nội dung dài hơn dự tính.",
  "Có một câu hỏi tách bạch được hai thứ: <em>khung của bạn được quyết định trước, hay do nội dung quyết định?</em>",
)}
<h2>Grid — khung có trước</h2>
${p(
  "Khi bạn biết trang chia thành mấy cột mấy hàng trước khi biết sẽ nhét gì vào, đó là Grid. Bạn khai báo khung, rồi đặt phần tử vào ô. Bố cục trang chủ, dashboard, thư viện ảnh đều thuộc nhóm này.",
  "Điểm mạnh thật sự của Grid là canh theo <strong>cả hai chiều cùng lúc</strong>. Ba thẻ ở ba cột khác nhau vẫn thẳng hàng đáy dù nội dung dài ngắn khác nhau, mà không cần đặt chiều cao cố định cho cái nào.",
)}
<h2>Flexbox — nội dung có trước</h2>
${p(
  "Khi bạn có một dãy phần tử và cần chúng nằm trên một hàng (hoặc một cột) rồi chia nhau chỗ trống, đó là Flexbox. Thanh điều hướng, nhóm nút, hàng thẻ tag — số phần tử thay đổi theo dữ liệu, và bạn không muốn khai báo trước là có mấy cái.",
  "Flexbox làm việc trên <strong>một chiều</strong>. Đó không phải hạn chế, đó là điều khiến nó đơn giản hơn cho đúng loại việc này.",
)}
<h2>Chỗ hay nhầm</h2>
${p(
  "Lồng Flexbox nhiều tầng để giả lập một cái lưới là dấu hiệu rõ nhất bạn đang cần Grid. Ngược lại, dùng Grid cho một hàng nút bấm thì phải khai báo số cột — mà số nút lại do dữ liệu quyết định, nên bạn sẽ quay lại sửa nó.",
  "Thực tế hai thứ đi cùng nhau: Grid dựng khung trang, rồi trong từng ô là Flexbox xếp nội dung. Không phải chọn một bỏ một.",
)}
`,
  },
  {
    slug: "khi-nao-can-state-management-o-frontend",
    tagSlug: "front-end",
    title: "Khi nào frontend thật sự cần thư viện quản lý state",
    excerpt: "Phần lớn màn hình không cần. Dấu hiệu nào cho biết đã đến lúc cần thì có.",
    takeaway: "Cần thư viện khi state được ĐỌC ở nhiều nhánh cây xa nhau, không phải khi nó phức tạp.",
    readMinutes: 6,
    contentHtml: `
${p(
  "Câu hỏi hay bị đặt sai thành \"state của tôi đã đủ phức tạp chưa\". Độ phức tạp không phải thứ quyết định — một form mười lăm trường vẫn sống tốt với state cục bộ.",
  "Thứ quyết định là <strong>khoảng cách</strong>: state được đọc ở bao nhiêu nhánh khác nhau của cây component, và chúng cách nhau bao xa.",
)}
<h2>Ba mức, theo đúng thứ tự nên thử</h2>
${p(
  "<strong>State cục bộ.</strong> Chỉ một component và con trực tiếp của nó cần đọc. Đây là phần lớn trường hợp. Đừng đi xa hơn khi chưa phải.",
  "<strong>Truyền qua props.</strong> Sâu hai, ba tầng. Vẫn đọc được, và người đọc mã thấy ngay dữ liệu chảy từ đâu tới đâu.",
  "<strong>Context hoặc thư viện.</strong> Khi cùng một state bị đọc ở hai nhánh phải đi ngược lên tận gốc mới gặp nhau. Người dùng đang đăng nhập, chủ đề sáng/tối, giỏ hàng — chúng thuộc về cả ứng dụng chứ không thuộc về một màn hình.",
)}
<h2>Cái bẫy phổ biến nhất</h2>
${p(
  "Đưa dữ liệu từ máy chủ vào kho state toàn cục. Dữ liệu máy chủ không phải state của ứng dụng — nó là một bản sao có hạn dùng, cần biết lúc nào cũ, lúc nào phải tải lại, lúc nào đang tải. Nhét nó vào kho toàn cục nghĩa là bạn sẽ tự viết lại phần quản lý vòng đời đó bằng tay.",
  "Tách hai loại ra: state của giao diện thì để trong ứng dụng; dữ liệu máy chủ thì để lớp lo việc tải và cache giữ. Sau khi tách, phần state toàn cục còn lại thường nhỏ tới mức không cần thư viện nào.",
)}
`,
  },
  {
    slug: "react-re-render-hieu-dung-truoc-khi-toi-uu",
    tagSlug: "react",
    title: "React re-render: hiểu đúng trước khi tối ưu",
    excerpt: "Bọc memo khắp nơi thường làm ứng dụng chậm đi. Trước hết cần biết render lại thật sự tốn ở đâu.",
    takeaway: "Render lại không đồng nghĩa với đụng vào DOM. Đo trước, memo sau.",
    readMinutes: 8,
    contentHtml: `
${p(
  "Nghe \"component render lại\" nhiều người tưởng trình duyệt vẽ lại màn hình. Không phải. React chạy lại hàm component để tính ra mô tả giao diện mới, so với mô tả cũ, rồi <strong>chỉ đụng vào phần DOM thật sự khác</strong>. Phần đắt nằm ở bước cuối, và bước cuối thường không xảy ra.",
  "Nên câu hỏi đúng không phải \"làm sao bớt render lại\" mà \"render lại này có tốn gì không\".",
)}
<h2>Khi nào render lại thật sự tốn</h2>
${p(
  "Có ba trường hợp đáng quan tâm: component tính toán nặng ngay trong thân hàm; danh sách rất dài render cùng lúc; và cây component sâu mà gốc đổi state liên tục, ví dụ theo từng ký tự gõ vào ô tìm kiếm.",
  "Ngoài ba trường hợp đó, một lần render lại tốn cỡ vài phần trăm mili giây. Bọc <code>memo</code> quanh nó thêm một phép so sánh props cho mỗi lần render — nghĩa là bạn vừa trả thêm chi phí để tránh một chi phí nhỏ hơn.",
)}
<h2>Vì sao memo hay không có tác dụng</h2>
${p(
  "<code>memo</code> so sánh props theo tham chiếu. Truyền vào một object hay một hàm tạo mới mỗi lần render thì phép so sánh luôn cho kết quả khác, và component vẫn render lại — chỉ khác là giờ có thêm phần so sánh vô ích.",
  "Đó là lý do <code>memo</code> thường phải đi kèm việc giữ ổn định tham chiếu ở phía cha. Ba thay đổi phối hợp với nhau mới có tác dụng, và đó cũng là lý do nên để dành nó cho chỗ đã đo được.",
)}
<h2>Thứ tự nên làm</h2>
${p(
  "Mở profiler, tương tác đúng thao tác đang thấy chậm, tìm component chiếm nhiều thời gian nhất. Gần như lần nào cũng ra một chỗ cụ thể chứ không phải \"cả ứng dụng render nhiều quá\". Sửa đúng chỗ đó rồi đo lại.",
  "Cách rẻ nhất thường không phải memo, mà là đẩy state xuống gần nơi dùng nó. State nằm càng thấp thì càng ít component phải render lại khi nó đổi.",
)}
`,
  },
  {
    slug: "javascript-bat-day-async-await-cho-dung",
    tagSlug: "javascript",
    title: "JavaScript: bắt lỗi async/await cho đúng",
    excerpt: "try/catch quanh await bắt được ít hơn bạn tưởng, và bỏ sót đúng những lỗi khó tìm nhất.",
    takeaway: "Promise bị bỏ rơi không đi vào catch nào. Await nó, hoặc xử lý nó ngay chỗ tạo ra.",
    readMinutes: 7,
    contentHtml: `
${p(
  "<code>async/await</code> làm mã bất đồng bộ đọc như mã tuần tự, nên người ta cũng xử lý lỗi như với mã tuần tự: bọc <code>try/catch</code> quanh khối là xong. Phần lớn thời gian đúng. Chỗ nó sai lại đúng là chỗ khó tìm nhất.",
)}
<h2>Promise không được await thì không ai bắt</h2>
${p(
  "<code>try/catch</code> chỉ bắt được lỗi của biểu thức bạn thật sự <code>await</code>. Gọi một hàm async mà quên <code>await</code>, nó vẫn chạy, vẫn có thể hỏng — và lỗi đó rơi ra ngoài mọi <code>catch</code> trong hàm, thành một cảnh báo unhandled rejection ở đâu đó.",
  "Kiểu lỗi này không làm hỏng ngay. Nó làm hỏng ở một chỗ khác, muộn hơn, không còn dấu vết dẫn về nơi gây ra.",
)}
<h2>Chạy song song thì lỗi đầu tiên thắng</h2>
${p(
  "<code>Promise.all</code> dừng ở lỗi đầu tiên và bỏ qua kết quả của những cái còn lại — nhưng chúng <strong>vẫn đang chạy</strong>. Nếu một trong số đó hỏng sau, lại là một rejection không ai bắt.",
  "Khi cần biết kết quả của tất cả, kể cả cái hỏng, dùng <code>Promise.allSettled</code>. Nó không bao giờ reject, và trả về trạng thái từng cái để bạn tự quyết định.",
)}
<h2>Một quy tắc gọn</h2>
${p(
  "Mỗi promise sinh ra phải kết thúc ở một trong hai chỗ: được <code>await</code>, hoặc được gắn <code>.catch()</code> ngay tại nơi tạo ra nó. Không có chỗ thứ ba. Quy tắc này bắt được gần hết loại lỗi nói trên mà không cần nhớ thêm gì.",
)}
`,
  },
  {
    slug: "devops-doc-log-truoc-khi-them-dashboard",
    tagSlug: "devops",
    title: "DevOps: đọc log cho ra chuyện trước khi thêm dashboard",
    excerpt: "Thêm biểu đồ không làm sự cố ngắn đi. Log có cấu trúc và một id xuyên suốt thì có.",
    takeaway: "Một request phải truy được từ đầu tới cuối bằng một id duy nhất.",
    readMinutes: 6,
    contentHtml: `
${p(
  "Khi hệ thống có sự cố, phản xạ thường thấy là dựng thêm dashboard. Biểu đồ cho biết <em>có</em> chuyện xảy ra và xảy ra lúc nào — nhưng gần như không bao giờ cho biết <em>vì sao</em>. Câu trả lời nằm trong log, và log chỉ dùng được nếu đã chuẩn bị từ trước.",
)}
<h2>Log có cấu trúc</h2>
${p(
  "Log dạng câu văn ghép chuỗi thì chỉ đọc được bằng mắt. Log dạng JSON có trường rõ ràng thì lọc được, đếm được, gom nhóm được. Khác biệt lộ ra đúng lúc ba giờ sáng, khi cần trả lời \"lỗi này xảy ra với bao nhiêu người dùng\" mà không phải viết một biểu thức chính quy.",
)}
<h2>Một id đi hết vòng đời request</h2>
${p(
  "Đây là thứ đáng làm sớm nhất. Sinh một id ở cửa ngõ, gắn vào mọi log của mọi service mà request đó đi qua, và trả nó về trong phản hồi lỗi. Người dùng báo lỗi kèm id, bạn lọc đúng id đó và thấy toàn bộ đường đi.",
  "Không có nó, mỗi lần điều tra là một lần ghép thủ công theo mốc thời gian giữa nhiều service — vừa chậm vừa hay ghép nhầm khi tải cao.",
)}
<h2>Mức log dùng đúng nghĩa</h2>
${p(
  "<code>ERROR</code> để dành cho thứ cần người xử lý. Một request hỏng vì người dùng nhập sai không phải <code>ERROR</code> — nó là chuyện bình thường. Đánh nhầm mức khiến cảnh báo kêu suốt, và cảnh báo kêu suốt thì chẳng ai nhìn nữa.",
  "Thước đo đơn giản: nếu thấy một dòng <code>ERROR</code> mà bạn không định làm gì cả, nó không phải <code>ERROR</code>.",
)}
`,
  },
  {
    slug: "thiet-ke-bang-truoc-khi-viet-query-dau-tien",
    tagSlug: "co-so-du-lieu",
    title: "Thiết kế bảng trước khi viết truy vấn đầu tiên",
    excerpt: "Phần lớn truy vấn chậm không sửa được bằng index, vì gốc rễ nằm ở cách chia bảng.",
    takeaway: "Ràng buộc đặt ở cơ sở dữ liệu thì không có đường vòng nào lách qua được.",
    readMinutes: 7,
    contentHtml: `
${p(
  "Truy vấn chậm hay được chữa bằng cách thêm index. Nhiều lần có tác dụng. Nhưng nếu phải thêm index thứ năm cho cùng một bảng, vấn đề thường không nằm ở index — nó nằm ở chỗ bảng đó đang gánh nhiều việc hơn một bảng nên gánh.",
)}
<h2>Ràng buộc thuộc về cơ sở dữ liệu</h2>
${p(
  "Khóa ngoại, <code>NOT NULL</code>, <code>UNIQUE</code>, <code>CHECK</code> — đặt được ở tầng dữ liệu thì đặt ở đó. Kiểm tra trong mã ứng dụng chỉ có tác dụng với đường đi qua đúng đoạn mã ấy; còn seed script, migration chạy tay, một service khác viết sau này thì không.",
  "Dữ liệu sống lâu hơn mã. Một ràng buộc trong cơ sở dữ liệu vẫn còn hiệu lực sau khi tầng ứng dụng đã viết lại lần thứ ba.",
)}
<h2>Chuẩn hóa tới đâu</h2>
${p(
  "Bắt đầu ở chuẩn hóa, chỉ phi chuẩn hóa khi đo được là cần. Ngược lại rất khó sửa: dữ liệu trùng lặp sẽ lệch nhau, và lúc phát hiện ra thì không còn biết bản nào đúng.",
  "Ngoại lệ hợp lý nhất là các cột đếm — số lượt ghi danh, số thành viên. Chúng được đọc liên tục và đếm lại mỗi lần thì tốn; nhưng phải có một đường rõ ràng để dựng lại từ dữ liệu gốc khi lệch.",
)}
<h2>Kiểm bằng dữ liệu thật</h2>
${p(
  "Truy vấn nào cũng nhanh trên một trăm dòng. Ba thứ chỉ lộ ra ở quy mô thật: quét toàn bảng, join nhân bản số dòng, và index không được dùng vì kiểu dữ liệu hai bên khác nhau.",
  "<code>EXPLAIN</code> trên dữ liệu thật là cách rẻ nhất để thấy cả ba, và rẻ hơn nhiều so với phát hiện chúng lúc đang có sự cố.",
)}
`,
  },
  {
    slug: "viet-api-de-doi-y-ve-sau",
    tagSlug: "back-end",
    title: "Viết API để còn đổi ý được về sau",
    excerpt: "API công khai là lời hứa. Vài quyết định ở ngày đầu quyết định bạn còn rút lại được hay không.",
    takeaway: "Thêm trường thì an toàn. Đổi ý nghĩa một trường đã có thì không.",
    readMinutes: 6,
    contentHtml: `
${p(
  "Khác biệt lớn nhất giữa hàm nội bộ và API công khai không phải kỹ thuật, mà là quyền sửa. Hàm nội bộ đổi tên lúc nào cũng được. API đã có người gọi thì mỗi thay đổi là một lần làm hỏng thứ đang chạy ở nơi bạn không nhìn thấy.",
)}
<h2>Thêm thì được, đổi thì không</h2>
${p(
  "Thêm một trường vào phản hồi gần như luôn an toàn: bên gọi chưa biết thì bỏ qua. Đổi kiểu của một trường, đổi ý nghĩa của nó, hay bỏ nó đi thì không — và loại nguy hiểm nhất là đổi <em>ý nghĩa</em> mà giữ nguyên tên, vì không có công cụ nào phát hiện được.",
  "Cần một ý nghĩa khác thì thêm trường mới bên cạnh, đánh dấu trường cũ là sẽ bỏ, rồi bỏ sau khi không còn ai gọi. Chậm hơn, nhưng không có buổi tối nào phải quay lui.",
)}
<h2>Lỗi cũng là một phần hợp đồng</h2>
${p(
  "Mã lỗi và hình dạng phản hồi lỗi được bên gọi xử lý bằng mã, y như dữ liệu thành công. Đổi một thông báo lỗi thành mã khác là một thay đổi phá vỡ tương thích, dù chẳng có trường nào trong phần dữ liệu bị đụng tới.",
  "Cho lỗi một hình dạng ổn định ngay từ đầu — một mã máy đọc được, một câu cho người đọc — và giữ nguyên phần mã máy đọc.",
)}
<h2>Phân trang từ đầu</h2>
${p(
  "Danh sách nào rồi cũng dài ra. Trả về cả mảng khi mới có ba mươi dòng thì tiện, nhưng lúc thành ba mươi nghìn dòng, thêm phân trang là một thay đổi phá vỡ tương thích với mọi bên đang gọi.",
  "Phân trang theo con trỏ ngay từ đầu tốn thêm một buổi, và tiết kiệm một đợt di dời sau này.",
)}
`,
  },
];

/**
 * Khóa học thêm vào để nhánh trình độ có gì để phân biệt: dữ liệu hiện tại gần như chỉ có
 * `basic`, nên học viên khai `intermediate` hay `experienced` đều không khớp được với gì.
 *
 * `roadmapSlug` quyết định LĨNH VỰC của khóa: bảng `courses` không có cột `field`, service
 * suy nó từ lộ trình đầu tiên chứa khóa đó.
 */
const COURSES = [
  {
    slug: "react-tu-component-toi-ung-dung",
    title: "React: từ component tới ứng dụng",
    description: "Dựng một ứng dụng React hoàn chỉnh: chia component, quản lý state, gọi API và xử lý lỗi.",
    level: "intermediate",
    durationHours: 18,
    roadmapSlug: "lo-trinh-frontend",
    tagSlugs: ["react", "front-end"],
    enrollmentCount: 6,
  },
  {
    slug: "css-hien-dai-flexbox-va-grid",
    title: "CSS hiện đại: Flexbox và Grid",
    description: "Dựng bố cục đáp ứng bằng hai công cụ bố cục của CSS, không dùng framework.",
    level: "basic",
    durationHours: 12,
    roadmapSlug: "lo-trinh-frontend",
    tagSlugs: ["front-end"],
    enrollmentCount: 8,
  },
  {
    slug: "thiet-ke-co-so-du-lieu-quan-he",
    title: "Thiết kế cơ sở dữ liệu quan hệ",
    description: "Chia bảng, đặt ràng buộc, viết index và đọc EXPLAIN trên PostgreSQL.",
    level: "intermediate",
    durationHours: 16,
    roadmapSlug: "lo-trinh-chua-dat-ten-l5m1u",
    tagSlugs: ["co-so-du-lieu", "back-end"],
    enrollmentCount: 5,
  },
  {
    slug: "kien-truc-backend-cho-he-thong-thuc-te",
    title: "Kiến trúc backend cho hệ thống thực tế",
    description: "Tách service, thiết kế API còn đổi được, xử lý lỗi và ghi log truy được.",
    level: "experienced",
    durationHours: 24,
    roadmapSlug: "lo-trinh-chua-dat-ten-l5m1u",
    tagSlugs: ["back-end", "devops"],
    enrollmentCount: 3,
  },
];

async function seedArticles(prisma, contents, authorId) {
  for (const article of ARTICLES) {
    const [tag] = await prisma.$queryRawUnsafe(`SELECT id FROM tags WHERE slug = $1`, article.tagSlug);
    if (tag === undefined) throw new Error(`chưa có chủ đề "${article.tagSlug}"`);

    const html = article.contentHtml.trim();

    // Chèn ở trạng thái `draft` trước: ràng buộc `articles_published_needs_date_and_body`
    // đòi có `content_ref`, mà `content_ref` thì phải có id của bài mới ghi được.
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
      authorId,
      tag.id,
      article.readMinutes,
    );

    const written = await contents.findOneAndUpdate(
      { articleId: row.id },
      { $set: { contentHtml: html, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, returnDocument: "after" },
    );

    await prisma.$executeRawUnsafe(
      `UPDATE articles SET content_ref = $2, status = 'published' WHERE id = $1::uuid`,
      row.id,
      String(written._id),
    );

    console.log(`  bài viết  ${article.slug}  [${article.tagSlug}]`);
  }
}

async function seedCourses(prisma, authorId) {
  for (const course of COURSES) {
    const [roadmap] = await prisma.$queryRawUnsafe(
      `SELECT id FROM roadmaps WHERE slug = $1`,
      course.roadmapSlug,
    );
    if (roadmap === undefined) throw new Error(`chưa có lộ trình "${course.roadmapSlug}"`);

    const [row] = await prisma.$queryRawUnsafe(
      `INSERT INTO courses (slug, title, description, level, duration_hours, instructor_id,
                            created_by, status, enrollment_count, published_at)
       VALUES ($1, $2, $3, $4::current_level, $5, $6::uuid, $6::uuid, 'published', $7, now())
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title, description = EXCLUDED.description, level = EXCLUDED.level,
         duration_hours = EXCLUDED.duration_hours, status = 'published',
         enrollment_count = EXCLUDED.enrollment_count
       RETURNING id`,
      course.slug,
      course.title,
      course.description,
      course.level,
      course.durationHours,
      authorId,
      course.enrollmentCount,
    );

    // Nối vào lộ trình — đây là chỗ khóa học lấy được LĨNH VỰC để chấm điểm. `position` đẩy
    // xuống cuối để không tranh chỗ với chương trình học đã có.
    await prisma.$executeRawUnsafe(
      `INSERT INTO roadmap_courses (roadmap_id, course_id, position, is_optional)
       VALUES ($1::uuid, $2::uuid,
               (SELECT coalesce(max(position), 0) + 1 FROM roadmap_courses WHERE roadmap_id = $1::uuid),
               false)
       ON CONFLICT (roadmap_id, course_id) DO NOTHING`,
      roadmap.id,
      row.id,
    );

    for (const tagSlug of course.tagSlugs) {
      const [tag] = await prisma.$queryRawUnsafe(`SELECT id FROM tags WHERE slug = $1`, tagSlug);
      if (tag === undefined) throw new Error(`chưa có chủ đề "${tagSlug}"`);
      await prisma.$executeRawUnsafe(
        `INSERT INTO course_tags (course_id, tag_id) VALUES ($1::uuid, $2::uuid)
         ON CONFLICT (course_id, tag_id) DO NOTHING`,
        row.id,
        tag.id,
      );
    }

    console.log(`  khóa học  ${course.slug}  [${course.level}] → ${course.roadmapSlug}`);
  }
}

async function main() {
  const prisma = new PrismaClient();
  const mongo = await MongoClient.connect(env("MONGO_URI"));
  const contents = mongo.db(env("MONGO_DB")).collection("article_contents");

  const [author] = await prisma.$queryRawUnsafe(
    `SELECT id FROM users WHERE role = 'lecturer' AND status <> 'deleted' ORDER BY created_at LIMIT 1`,
  );
  if (author === undefined) throw new Error("chưa có tài khoản giảng viên nào để gán làm tác giả");

  await seedArticles(prisma, contents, author.id);
  await seedCourses(prisma, author.id);

  await mongo.close();
  await prisma.$disconnect();
  console.log(`\nĐã seed ${ARTICLES.length} bài viết và ${COURSES.length} khóa học.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
