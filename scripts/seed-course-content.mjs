// Chương trình học cho những khóa mới chỉ có vỏ.
//
// `seed-recommendation-demo.mjs` tạo bốn khóa để xếp hạng có gì mà chấm, nhưng không tạo
// chương và bài học nào — nên thẻ hiện "0 chương · 0 bài học" và mở khóa ra là trang trắng.
// File này bù đúng phần đó.
//
// Tách riêng vì đây là việc khác: seed kia lo hàng trong catalogue, seed này lo nội dung
// bên trong. Chạy được độc lập, và thêm khóa mới sau này chỉ phải sửa một mảng ở đây.
//
// Idempotent theo (khóa, vị trí chương) và (chương, vị trí bài): chạy lại thì cập nhật
// đúng chương/bài đó chứ không đẻ thêm bản sao.
//
//   node --env-file=.env scripts/seed-course-content.mjs
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
 * `type` để `article`: bài lý thuyết đọc được ngay bằng `contentHtml`. Không dùng `video`
 * vì nó đòi `media.url` trỏ tới một tệp có thật, mà seed thì không đi kèm kho video nào —
 * một bài video không có nguồn phát còn trống hơn cả bài chưa soạn.
 */
const COURSES = [
  {
    slug: "css-hien-dai-flexbox-va-grid",
    chapters: [
      {
        title: "Nền tảng bố cục",
        description: "Hộp, luồng tài liệu và lý do bố cục hay vỡ.",
        lessons: [
          {
            title: "Box model: thứ quyết định kích thước thật",
            minutes: 18,
            isPreview: true,
            summary: "Vì sao đặt width 300px mà phần tử lại rộng 340px.",
            objectives: [
              "Phân biệt content-box và border-box",
              "Giải thích được chiều rộng thực tế của một phần tử",
            ],
            html: `
${p(
  "Mỗi phần tử là một hộp gồm bốn lớp: nội dung, padding, border, margin. Câu hỏi làm người mới vấp là <em>width áp lên lớp nào?</em>",
  "Mặc định của CSS là <code>content-box</code>: <code>width: 300px</code> chỉ nói về phần nội dung. Thêm <code>padding: 20px</code> và <code>border: 1px</code> thì phần tử chiếm 342px trên màn hình. Đó là lý do bố cục vỡ ngay khi bạn thêm padding.",
)}
<h2>border-box và vì sao gần như ai cũng bật nó</h2>
${p(
  "<code>box-sizing: border-box</code> đổi nghĩa của <code>width</code>: 300px giờ tính cả padding và border, phần nội dung tự co lại. Nghĩa là thêm padding không còn làm phần tử rộng ra.",
  "Vì hầu như lúc nào đó cũng là điều bạn muốn, đặt một lần ở đầu tệp CSS: <code>*, *::before, *::after { box-sizing: border-box; }</code>",
)}
<h2>Margin không nằm trong hộp</h2>
${p(
  "Margin là khoảng cách tới phần tử khác, không phải một phần kích thước phần tử. <code>border-box</code> cũng không gộp nó vào. Và margin theo chiều dọc của hai phần tử liền nhau <em>gộp lại</em> — hai margin 20px cạnh nhau cho khoảng cách 20px, không phải 40px.",
)}
`,
          },
          {
            title: "Luồng tài liệu, display và vị trí",
            minutes: 20,
            summary: "block, inline, inline-block và bốn giá trị của position.",
            objectives: ["Chọn đúng giá trị display", "Biết khi nào cần position: absolute"],
            html: `
${p(
  "Mặc định trình duyệt xếp phần tử theo <em>luồng tài liệu</em>: block xuống dòng và chiếm hết chiều ngang, inline nằm cùng hàng và chỉ rộng bằng nội dung.",
  "<code>inline-block</code> ở giữa: nằm cùng hàng như inline, nhưng nhận được width, height và margin dọc như block.",
)}
<h2>Bốn giá trị position đáng nhớ</h2>
${p(
  "<code>static</code> là mặc định — phần tử ở đúng chỗ luồng đặt nó. <code>relative</code> giữ chỗ cũ trong luồng nhưng vẽ lệch đi, và quan trọng hơn: nó tạo mốc cho con dùng <code>absolute</code>.",
  "<code>absolute</code> rời khỏi luồng và định vị theo tổ tiên gần nhất không phải <code>static</code>. Quên đặt <code>relative</code> cho cha là lý do phổ biến nhất khiến một phần tử absolute nhảy ra góc màn hình.",
  "<code>fixed</code> neo theo khung nhìn, <code>sticky</code> chạy theo luồng cho tới khi chạm ngưỡng rồi dính lại.",
)}
`,
          },
        ],
      },
      {
        title: "Flexbox",
        description: "Bố cục một chiều và cách chia phần dư.",
        lessons: [
          {
            title: "Trục chính, trục phụ và cách căn",
            minutes: 22,
            summary: "justify-content và align-items khác nhau ở chỗ nào.",
            objectives: ["Xác định được trục chính", "Căn phần tử theo cả hai chiều"],
            html: `
${p(
  "Flexbox làm việc trên một chiều. Chiều đó gọi là <em>trục chính</em>, do <code>flex-direction</code> quyết định: <code>row</code> thì trục chính nằm ngang, <code>column</code> thì nằm dọc.",
  "Nắm được điều này là gỡ được nhầm lẫn phổ biến nhất: <code>justify-content</code> luôn căn theo <strong>trục chính</strong>, <code>align-items</code> luôn căn theo <strong>trục phụ</strong>. Đổi <code>flex-direction</code> thì hai thuộc tính đó đổi vai cho nhau.",
)}
<h2>Căn giữa cả hai chiều</h2>
${p(
  "Ba dòng: <code>display: flex; justify-content: center; align-items: center;</code> Đây là lời giải cho bài toán từng tốn của web rất nhiều năm.",
)}
<h2>Chia phần dư</h2>
${p(
  "<code>flex: 1</code> trên các con nghĩa là chia đều chỗ trống. Viết đủ là <code>flex: 1 1 0%</code> — được phép giãn, được phép co, và bắt đầu tính từ 0 nên kích thước nội dung không ảnh hưởng tỉ lệ.",
  "Khác với <code>flex: 1 1 auto</code>, ở đó nội dung dài hơn sẽ được phần rộng hơn. Hai cái này hay bị nhầm và cho ra bố cục lệch không rõ lý do.",
)}
`,
          },
          {
            title: "Thanh điều hướng và nhóm nút",
            minutes: 20,
            summary: "Những bố cục thực tế mà Flexbox giải quyết gọn nhất.",
            objectives: ["Dựng navbar hai đầu", "Xử lý xuống dòng bằng flex-wrap"],
            html: `
${p(
  "Bố cục hay gặp nhất: logo bên trái, nhóm liên kết bên phải. <code>display: flex; justify-content: space-between;</code> trên thẻ cha là xong — không cần float, không cần position.",
  "Muốn một phần tử tự đẩy phần còn lại sang phải, đặt <code>margin-left: auto</code> lên chính nó. Margin auto trong flex nuốt hết chỗ trống còn lại, và thường gọn hơn việc bọc thêm một lớp div.",
)}
<h2>Khi không đủ chỗ</h2>
${p(
  "Mặc định flex ép mọi phần tử vào một hàng và co chúng lại. <code>flex-wrap: wrap</code> cho phép xuống hàng khi chật, và đi cùng <code>gap</code> thì có ngay một hàng thẻ đáp ứng mà không cần media query nào.",
  "<code>gap</code> đáng dùng hơn margin cho khoảng cách giữa các phần tử: nó không tạo khoảng thừa ở hai đầu, nên không phải viết luật <code>:last-child</code> để gỡ lại.",
)}
`,
          },
        ],
      },
      {
        title: "Grid",
        description: "Bố cục hai chiều và bố cục đáp ứng không cần media query.",
        lessons: [
          {
            title: "Định nghĩa khung: cột, hàng và đơn vị fr",
            minutes: 24,
            summary: "grid-template và đơn vị fr.",
            objectives: ["Khai báo lưới cột", "Dùng fr thay vì phần trăm"],
            html: `
${p(
  "Grid bắt đầu bằng việc khai báo khung: <code>grid-template-columns: 200px 1fr 200px</code> tạo ba cột, hai bên cố định, giữa chiếm phần còn lại.",
  "<code>fr</code> là phần của chỗ <em>còn trống</em>. Khác phần trăm ở chỗ nó đã trừ sẵn <code>gap</code>, nên không có chuyện ba cột 33.33% cộng với gap thành tràn hàng.",
)}
<h2>repeat và minmax</h2>
${p(
  "<code>repeat(3, 1fr)</code> gọn hơn viết <code>1fr 1fr 1fr</code>. Ghép với <code>minmax()</code> thì đặt được giới hạn: <code>repeat(3, minmax(0, 1fr))</code> — ba cột đều nhau và <em>được phép co nhỏ hơn nội dung</em>.",
  "Cái <code>minmax(0, …)</code> đó không thừa: mặc định một track lưới không co nhỏ hơn nội dung của nó, nên một chuỗi dài không xuống dòng sẽ làm cả lưới tràn ngang.",
)}
`,
          },
          {
            title: "Lưới đáp ứng không cần media query",
            minutes: 22,
            summary: "auto-fit và minmax thay cho các điểm ngắt.",
            objectives: ["Dựng lưới thẻ tự đổi số cột", "Phân biệt auto-fit và auto-fill"],
            html: `
${p(
  "Một dòng thay được ba media query:",
)}
<pre><code>grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));</code></pre>
${p(
  "Nghĩa là: nhét được bao nhiêu cột rộng tối thiểu 260px thì nhét, phần dư chia đều. Màn hình rộng ra thì số cột tự tăng, hẹp lại thì tự giảm — không điểm ngắt nào được viết ra.",
)}
<h2>auto-fit và auto-fill</h2>
${p(
  "Hai cái chỉ khác nhau khi số phần tử ÍT hơn số cột chứa được. <code>auto-fill</code> giữ lại các cột rỗng, nên ba thẻ trên màn hình rộng sẽ nằm co lại bên trái. <code>auto-fit</code> gộp cột rỗng đi, nên ba thẻ giãn ra lấp đầy hàng.",
  "Muốn thẻ giữ nguyên kích thước và xếp từ trái sang thì dùng <code>auto-fill</code>; muốn chúng luôn lấp đầy hàng thì <code>auto-fit</code>.",
)}
<h2>Dùng chung với Flexbox</h2>
${p(
  "Thực tế hai thứ đi cùng nhau: Grid dựng khung trang, rồi trong từng ô là Flexbox xếp nội dung theo một chiều. Không phải chọn một bỏ một.",
)}
`,
          },
        ],
      },
    ],
  },
  {
    slug: "react-tu-component-toi-ung-dung",
    chapters: [
      {
        title: "Component và state",
        description: "Đơn vị nhỏ nhất của React và cách nó nhớ.",
        lessons: [
          {
            title: "Props, state và ranh giới giữa chúng",
            minutes: 22,
            isPreview: true,
            summary: "Cái gì nên là props, cái gì nên là state.",
            objectives: ["Phân biệt props và state", "Đặt state ở đúng tầng"],
            html: `
${p(
  "Props là dữ liệu cha truyền xuống — component không được sửa. State là dữ liệu component tự giữ và tự đổi. Ranh giới nghe rõ ràng, nhưng chỗ hay sai là <em>đặt state ở tầng nào</em>.",
)}
<h2>Quy tắc: đặt state ở tổ tiên chung gần nhất</h2>
${p(
  "Hai component cần đọc cùng một giá trị thì state phải nằm ở tổ tiên chung gần nhất của chúng, rồi truyền xuống bằng props. Đặt cao hơn mức cần thì mỗi lần đổi sẽ render lại cả một nhánh không liên quan.",
  "Ngược lại, state chỉ một component dùng thì để ngay trong nó. Đẩy lên trên \"cho tiện\" là cách nhanh nhất biến một cây component thành thứ không ai dám sửa.",
)}
<h2>State là ảnh chụp, không phải biến</h2>
${p(
  "Trong một lần render, giá trị state không đổi. Gọi <code>setCount(count + 1)</code> hai lần liên tiếp chỉ tăng 1, vì cả hai lần đều đọc cùng một <code>count</code> cũ.",
  "Cần dựa trên giá trị trước đó thì truyền hàm: <code>setCount(c => c + 1)</code>. React sẽ đưa vào giá trị mới nhất, kể cả khi nhiều lần cập nhật được gộp chung.",
)}
`,
          },
          {
            title: "Danh sách, key và render có điều kiện",
            minutes: 18,
            summary: "Vì sao key không được là chỉ số mảng.",
            objectives: ["Chọn key đúng", "Tránh lỗi state dính nhầm phần tử"],
            html: `
${p(
  "React dùng <code>key</code> để biết phần tử nào trong danh sách là phần tử nào giữa hai lần render. Lấy chỉ số mảng làm key thì mọi thứ vẫn chạy — cho tới khi danh sách bị chèn, xoá hoặc sắp lại.",
  "Xoá phần tử đầu tiên: phần tử thứ hai giờ mang key 0, tức key mà phần tử vừa xoá đang giữ. React kết luận đây vẫn là phần tử cũ, chỉ đổi nội dung — nên state bên trong nó (ô input đang gõ dở, checkbox đã tích) ở lại nhầm chỗ.",
  "Dùng id ổn định từ dữ liệu. Không có id thật thì sinh một lần lúc tạo phần tử, đừng sinh trong lúc render.",
)}
<h2>Render có điều kiện</h2>
${p(
  "<code>{count && &lt;Badge /&gt;}</code> có một bẫy: khi <code>count</code> bằng 0, React in ra số <strong>0</strong> chứ không phải không in gì. Dùng <code>{count > 0 && …}</code> hoặc toán tử ba ngôi để tránh.",
)}
`,
          },
        ],
      },
      {
        title: "Hiệu ứng và dữ liệu",
        description: "useEffect, gọi API và dọn dẹp.",
        lessons: [
          {
            title: "useEffect: khi nào cần và khi nào không",
            minutes: 24,
            summary: "Phần lớn effect trong dự án thật là không cần thiết.",
            objectives: ["Nhận ra effect thừa", "Viết hàm dọn dẹp đúng"],
            html: `
${p(
  "<code>useEffect</code> để đồng bộ với thứ <em>ngoài</em> React: mạng, DOM thật, timer, đăng ký sự kiện. Nếu việc bạn định làm chỉ liên quan tới dữ liệu trong React, gần như chắc chắn không cần effect.",
)}
<h2>Hai effect thừa hay gặp</h2>
${p(
  "<strong>Tính giá trị dẫn xuất.</strong> Có <code>firstName</code> và <code>lastName</code>, đừng dùng effect để set <code>fullName</code> vào state. Tính thẳng trong lúc render — một biến thường là đủ, và nó không bao giờ lệch pha.",
  "<strong>Đồng bộ state theo props.</strong> Dùng effect để chép prop vào state tạo ra một lần render thừa với giá trị cũ. Cần \"reset khi prop đổi\" thì đổi <code>key</code> của component, React sẽ dựng lại nó với state mới tinh.",
)}
<h2>Dọn dẹp</h2>
${p(
  "Hàm trả về từ effect chạy trước lần chạy kế tiếp và khi component biến mất. Thiếu nó thì timer vẫn chạy, listener vẫn bám, và request về muộn vẫn set state cho một component đã gỡ.",
  "Với gọi API, cách gọn nhất là một cờ: đặt <code>cancelled = true</code> trong phần dọn dẹp và kiểm tra nó trước khi set state.",
)}
`,
          },
          {
            title: "Gọi API: tải, lỗi và trạng thái rỗng",
            minutes: 22,
            summary: "Ba trạng thái phải xử lý, không phải một.",
            objectives: ["Xử lý đủ loading/error/empty", "Không nuốt lỗi"],
            html: `
${p(
  "Một màn hình đọc dữ liệu từ máy chủ có ít nhất bốn trạng thái, và mã hay chỉ xử lý một: đang tải, lỗi, rỗng, và có dữ liệu.",
  "Bỏ qua trạng thái lỗi là lỗi tốn kém nhất. Một API trả 404 mà giao diện hiện \"chưa có gì\" trông y hệt trường hợp thật sự chưa có gì — không nhìn ra được từ màn hình, và thường chỉ phát hiện khi có người gọi thẳng vào API.",
)}
<h2>Rỗng khác lỗi</h2>
${p(
  "\"Chưa có khóa học nào\" và \"không tải được danh sách\" là hai câu khác nhau, dẫn tới hai hành động khác nhau của người dùng. Gộp chúng vào một trạng thái là bỏ mất thông tin duy nhất giúp họ biết nên làm gì tiếp.",
)}
<h2>Chạy song song</h2>
${p(
  "Cần nhiều nguồn thì <code>Promise.all</code> chạy chúng cùng lúc thay vì nối đuôi. Muốn một nguồn hỏng không kéo sập cả trang thì dùng <code>Promise.allSettled</code> và xử lý từng kết quả — mỗi khối tự báo lỗi của riêng nó.",
)}
`,
          },
        ],
      },
      {
        title: "Dựng ứng dụng",
        description: "Chia component, tái sử dụng logic và tránh tối ưu sớm.",
        lessons: [
          {
            title: "Custom hook: tách logic khỏi giao diện",
            minutes: 20,
            summary: "Khi nào một đoạn logic đáng thành hook riêng.",
            objectives: ["Viết custom hook", "Biết khi nào chưa cần tách"],
            html: `
${p(
  "Custom hook chỉ là một hàm bắt đầu bằng <code>use</code> và gọi hook khác. Không có phép màu nào — giá trị của nó là tách <em>logic</em> ra khỏi <em>cách hiển thị</em>.",
  "Dấu hiệu đáng tách: cùng một bộ state + effect xuất hiện ở component thứ hai. Lần đầu thì cứ để nguyên tại chỗ; tách sớm khi chưa biết hình dạng chung thường ra một hook nhận bảy tham số.",
)}
<h2>Hook trả về gì</h2>
${p(
  "Trả về object có tên rõ ràng (<code>{ items, isLoading, error }</code>) thay vì mảng, trừ khi hook chỉ trả đúng hai giá trị theo kiểu <code>useState</code>. Tên gọi khiến nơi dùng đọc được mà không phải nhớ thứ tự.",
)}
`,
          },
          {
            title: "Hiệu năng: đo trước, memo sau",
            minutes: 20,
            summary: "Bọc memo khắp nơi thường làm ứng dụng chậm đi.",
            objectives: ["Hiểu chi phí thật của render lại", "Dùng profiler"],
            html: `
${p(
  "\"Render lại\" không có nghĩa là trình duyệt vẽ lại màn hình. React chạy lại hàm component, so mô tả mới với cũ, rồi chỉ đụng vào phần DOM thật sự khác. Phần đắt nằm ở bước cuối, và bước cuối thường không xảy ra.",
)}
<h2>Vì sao memo hay vô tác dụng</h2>
${p(
  "<code>memo</code> so sánh props theo tham chiếu. Cha truyền xuống một object hay một hàm tạo mới mỗi lần render thì phép so sánh luôn khác, con vẫn render lại — chỉ khác là giờ có thêm một phép so sánh vô ích mỗi lần.",
  "Nghĩa là <code>memo</code> chỉ có tác dụng khi đi kèm việc giữ ổn định tham chiếu ở phía cha. Ba thay đổi phối hợp mới ra kết quả, nên để dành nó cho chỗ đã đo được.",
)}
<h2>Cách rẻ hơn memo</h2>
${p(
  "Đẩy state xuống gần nơi dùng nó. State nằm càng thấp thì càng ít component phải render lại khi nó đổi — và cách này không thêm dòng nào phải bảo trì.",
)}
`,
          },
        ],
      },
    ],
  },
  {
    slug: "thiet-ke-co-so-du-lieu-quan-he",
    chapters: [
      {
        title: "Mô hình hoá dữ liệu",
        description: "Chia bảng, khoá và quan hệ.",
        lessons: [
          {
            title: "Khoá chính, khoá ngoại và ràng buộc",
            minutes: 22,
            isPreview: true,
            summary: "Vì sao ràng buộc thuộc về cơ sở dữ liệu chứ không phải tầng ứng dụng.",
            objectives: ["Chọn khoá chính", "Đặt ràng buộc ở đúng tầng"],
            html: `
${p(
  "Khoá chính định danh một dòng và không bao giờ đổi. Đó là lý do nên tránh dùng dữ liệu nghiệp vụ làm khoá: email đổi được, số điện thoại đổi được, mã nhân viên có ngày sẽ đổi cấu trúc.",
  "Khoá thay thế — số tự tăng hoặc UUID — không mang ý nghĩa nào, nên không có lý do gì để đổi.",
)}
<h2>Ràng buộc đặt ở cơ sở dữ liệu</h2>
${p(
  "Khoá ngoại, <code>NOT NULL</code>, <code>UNIQUE</code>, <code>CHECK</code> — đặt được ở tầng dữ liệu thì đặt ở đó. Kiểm tra trong mã ứng dụng chỉ có tác dụng với đường đi qua đúng đoạn mã ấy; seed script, migration chạy tay, hay một service khác viết sau này thì không.",
  "Dữ liệu sống lâu hơn mã. Một ràng buộc trong cơ sở dữ liệu vẫn còn hiệu lực sau khi tầng ứng dụng đã được viết lại lần thứ ba.",
)}
<h2>ON DELETE nói lên ý định</h2>
${p(
  "<code>CASCADE</code> xoá con theo cha — đúng cho quan hệ sở hữu thật sự, như bình luận thuộc về bài viết. <code>RESTRICT</code> chặn việc xoá cha khi còn con — đúng khi con có giá trị độc lập. Chọn sai <code>CASCADE</code> là cách mất dữ liệu im lặng.",
)}
`,
          },
          {
            title: "Chuẩn hoá và khi nào nên đi ngược lại",
            minutes: 20,
            summary: "Chuẩn hoá trước, phi chuẩn hoá khi đo được là cần.",
            objectives: ["Nhận ra dữ liệu trùng lặp", "Biết khi nào cột đếm là hợp lý"],
            html: `
${p(
  "Chuẩn hoá là mỗi sự thật được lưu đúng một chỗ. Tên tác giả nằm ở bảng <code>users</code>, bài viết chỉ giữ <code>author_id</code>. Đổi tên thì đổi một dòng, và mọi nơi hiển thị đều đúng theo.",
  "Bắt đầu ở chuẩn hoá, chỉ đi ngược lại khi đo được là cần. Chiều ngược khó sửa hơn nhiều: dữ liệu trùng lặp sẽ lệch nhau, và lúc phát hiện ra thì không còn biết bản nào đúng.",
)}
<h2>Ngoại lệ hợp lý: cột đếm</h2>
${p(
  "Số lượt ghi danh, số thành viên nhóm — đọc liên tục, mà đếm lại mỗi lần thì tốn. Giữ một cột đếm là hợp lý, với một điều kiện: phải có đường rõ ràng để dựng lại nó từ dữ liệu gốc khi lệch.",
  "Không có đường dựng lại thì cột đếm sai là sai vĩnh viễn, và không ai biết nó đã sai từ lúc nào.",
)}
`,
          },
        ],
      },
      {
        title: "Truy vấn và index",
        description: "Viết truy vấn đọc được và chạy nhanh.",
        lessons: [
          {
            title: "JOIN và bẫy nhân dòng",
            minutes: 22,
            summary: "Vì sao tổng cộng đôi khi gấp ba lần thực tế.",
            objectives: ["Phân biệt các loại join", "Tránh nhân bản dòng khi tổng hợp"],
            html: `
${p(
  "<code>INNER JOIN</code> chỉ giữ dòng khớp cả hai bên. <code>LEFT JOIN</code> giữ hết bên trái, bên phải không khớp thì <code>NULL</code>. Nhầm hai cái là cách phổ biến nhất làm mất dòng mà không ai để ý.",
)}
<h2>Nhân dòng</h2>
${p(
  "Join sang bảng quan hệ một-nhiều thì mỗi dòng bên trái được nhân lên bằng số dòng khớp bên phải. Một khóa học có 5 bài học, join sang <code>lessons</code> rồi <code>SUM(course.price)</code> sẽ cho ra giá gấp 5 lần.",
  "Cần một con số từ bảng bên kia thì dùng truy vấn con tương quan, hoặc gộp trước rồi mới join. Đừng gộp sau khi đã nhân.",
)}
<h2>LEFT JOIN và mệnh đề WHERE</h2>
${p(
  "Đặt điều kiện của bảng bên phải vào <code>WHERE</code> sẽ biến <code>LEFT JOIN</code> thành <code>INNER JOIN</code> — vì dòng <code>NULL</code> không thoả điều kiện nên bị loại. Muốn giữ chúng thì điều kiện phải nằm trong <code>ON</code>.",
)}
`,
          },
          {
            title: "Đọc EXPLAIN và đặt index đúng chỗ",
            minutes: 24,
            summary: "Đo trước khi thêm index.",
            objectives: ["Đọc được kế hoạch truy vấn", "Chọn thứ tự cột cho index tổ hợp"],
            html: `
${p(
  "<code>EXPLAIN ANALYZE</code> chạy thật và báo lại thời gian từng bước cùng số dòng thực tế. Thứ đáng nhìn đầu tiên không phải tổng thời gian, mà là chỗ ước lượng lệch xa thực tế nhất — bộ tối ưu chọn kế hoạch dựa trên ước lượng, ước lượng sai thì kế hoạch sai theo.",
)}
<h2>Thứ tự cột trong index tổ hợp</h2>
${p(
  "Index trên <code>(user_id, created_at)</code> phục vụ được truy vấn lọc theo <code>user_id</code>, và lọc theo <code>user_id</code> rồi sắp theo <code>created_at</code>. Nhưng truy vấn chỉ lọc theo <code>created_at</code> thì không dùng được nó.",
  "Quy tắc thực dụng: cột so sánh bằng đứng trước, cột dùng cho khoảng giá trị và sắp xếp đứng sau.",
)}
<h2>Cái giá của index</h2>
${p(
  "Mỗi index tăng tốc đọc và làm chậm ghi — thêm một dòng là thêm một lần cập nhật cho mỗi index. Index không phục vụ truy vấn nào thì chỉ còn lại phần chi phí. Mỗi index nên trả lời được câu: nó có mặt vì truy vấn nào?",
)}
`,
          },
        ],
      },
      {
        title: "Giao dịch và migration",
        description: "Giữ dữ liệu đúng khi có nhiều thứ chạy cùng lúc.",
        lessons: [
          {
            title: "Giao dịch và mức cô lập",
            minutes: 20,
            summary: "ACID nói gì, và điều gì vẫn xảy ra ở mức mặc định.",
            objectives: ["Xác định ranh giới giao dịch", "Biết mức cô lập mặc định cho phép gì"],
            html: `
${p(
  "Giao dịch bảo đảm một nhóm thao tác hoặc thành công hết, hoặc không có gì xảy ra. Chuyển tiền là ví dụ kinh điển: trừ bên này và cộng bên kia phải cùng thành công.",
  "Ranh giới giao dịch nên trùng với một thao tác nghiệp vụ, không rộng hơn. Giữ giao dịch mở trong lúc gọi một API bên ngoài là cách giữ khoá hàng giây đồng hồ và làm nghẽn cả hệ thống.",
)}
<h2>Mức mặc định của PostgreSQL</h2>
${p(
  "Mặc định là <code>READ COMMITTED</code>: bạn chỉ thấy dữ liệu đã commit, nhưng hai lần đọc trong cùng một giao dịch có thể ra kết quả khác nhau nếu giao dịch khác vừa commit ở giữa.",
  "Nghĩa là mẫu \"đọc rồi kiểm tra rồi ghi\" không an toàn ở mức này. Đọc số dư, thấy đủ, rồi trừ — giữa hai bước đó một giao dịch khác có thể đã trừ trước. Cần <code>SELECT … FOR UPDATE</code> để khoá dòng, hoặc đẩy phép tính vào chính câu <code>UPDATE</code>.",
)}
`,
          },
          {
            title: "Migration an toàn trên bảng đang chạy",
            minutes: 18,
            summary: "Thêm cột NOT NULL vào bảng lớn là cách khoá bảng.",
            objectives: ["Chia migration thành các bước không khoá", "Triển khai theo hai pha"],
            html: `
${p(
  "Trên bảng nhỏ, migration nào cũng nhanh. Trên bảng đang có tải, vài lệnh tưởng vô hại sẽ khoá bảng đủ lâu để mọi request xếp hàng và timeout.",
)}
<h2>Thêm cột NOT NULL</h2>
${p(
  "Thêm cột <code>NOT NULL</code> kèm giá trị mặc định trên bảng lớn từng là thao tác phải viết lại toàn bộ bảng. Cách an toàn vẫn là ba bước tách rời: thêm cột cho phép <code>NULL</code>, điền dữ liệu theo lô, rồi mới đặt ràng buộc.",
)}
<h2>Đổi tên cột cần hai lần triển khai</h2>
${p(
  "Đổi tên trong một bước sẽ làm hỏng bản mã đang chạy ngay khi migration xong. Cách an toàn: thêm cột mới, cho ứng dụng ghi cả hai và đọc cột mới, chép dữ liệu cũ sang, rồi ở lần triển khai sau mới bỏ cột cũ.",
  "Chậm hơn, và đó là cái giá của việc không có phút nào hệ thống hỏng.",
)}
`,
          },
        ],
      },
    ],
  },
  {
    slug: "kien-truc-backend-cho-he-thong-thuc-te",
    chapters: [
      {
        title: "Ranh giới service",
        description: "Chia hệ thống theo cái gì, và khi nào đừng chia.",
        lessons: [
          {
            title: "Chia theo nghiệp vụ, không theo tầng kỹ thuật",
            minutes: 24,
            isPreview: true,
            summary: "Vì sao 'service cho controller, service cho database' là chia sai.",
            objectives: ["Xác định ranh giới theo miền nghiệp vụ", "Nhận ra ranh giới sai"],
            html: `
${p(
  "Cách chia sai phổ biến nhất là chia theo tầng kỹ thuật: một service lo API, một service lo cơ sở dữ liệu. Mỗi thay đổi nghiệp vụ khi đó phải sửa cả hai và triển khai cùng lúc — mọi chi phí của hệ phân tán, không lợi ích nào.",
  "Chia đúng là chia theo miền nghiệp vụ: một service sở hữu trọn vẹn chuyện thanh toán, một service sở hữu trọn vẹn chuyện học tập. Thay đổi trong một miền dừng lại trong một service.",
)}
<h2>Dấu hiệu ranh giới đặt sai</h2>
${p(
  "Hai service phải triển khai cùng lúc mới chạy được. Một service phải gọi service kia mới trả lời nổi một request đơn giản. Hai service ghi vào cùng một bảng.",
  "Cả ba đều nói cùng một chuyện: đường cắt nằm sai chỗ, và thứ bạn có là một khối duy nhất bị xẻ ra qua đường mạng.",
)}
<h2>Khi nào đừng chia</h2>
${p(
  "Hệ thống chưa có tải, đội chưa tới mười người, miền nghiệp vụ chưa ổn định — một khối gọn gàng với các module rõ ràng gần như luôn là lựa chọn đúng. Ranh giới trong cùng một tiến trình sửa lại rẻ; ranh giới qua mạng thì không.",
)}
`,
          },
          {
            title: "Đọc dữ liệu của service khác",
            minutes: 20,
            summary: "Ba cách, và cái giá của từng cách.",
            objectives: ["So sánh gọi đồng bộ, sao chép và view chỉ đọc"],
            html: `
${p(
  "Sớm muộn một service cần dữ liệu do service khác sở hữu. Có ba cách, và không cách nào miễn phí.",
)}
<h2>Gọi đồng bộ</h2>
${p(
  "Đơn giản nhất và luôn mới nhất. Cái giá là ràng buộc thời gian chạy: bên kia chậm thì bạn chậm, bên kia sập thì bạn sập. Một chuỗi ba lời gọi nối đuôi có độ khả dụng thấp hơn từng mắt xích.",
)}
<h2>Sao chép qua sự kiện</h2>
${p(
  "Service phát sự kiện khi dữ liệu đổi, bên quan tâm giữ một bản sao đọc được ngay. Không còn ràng buộc thời gian chạy, đổi lại là nhất quán cuối cùng — bản sao trễ vài giây, và mã của bạn phải chịu được điều đó.",
  "Đây là lựa chọn đúng khi \"trễ vài giây\" chấp nhận được. Với số dư tài khoản thì không.",
)}
<h2>View chỉ đọc</h2>
${p(
  "Cho phép đọc thẳng qua một view chỉ đọc đã định nghĩa rõ. Rẻ về hạ tầng, và giữ được một ranh giới danh nghĩa: bên đọc phụ thuộc vào view chứ không vào cấu trúc bảng thật, nên bên sở hữu vẫn đổi bảng được miễn giữ nguyên view.",
)}
`,
          },
        ],
      },
      {
        title: "API và lỗi",
        description: "Thiết kế còn đổi được, và hỏng có kiểm soát.",
        lessons: [
          {
            title: "Thiết kế API để còn đổi ý được",
            minutes: 22,
            summary: "Thêm trường thì an toàn, đổi ý nghĩa một trường thì không.",
            objectives: ["Phân biệt thay đổi tương thích và phá vỡ", "Bỏ trường theo quy trình"],
            html: `
${p(
  "Khác biệt lớn nhất giữa hàm nội bộ và API công khai không phải kỹ thuật, mà là quyền sửa. API đã có người gọi thì mỗi thay đổi là một lần làm hỏng thứ đang chạy ở nơi bạn không nhìn thấy.",
)}
<h2>Thêm được, đổi thì không</h2>
${p(
  "Thêm một trường vào phản hồi gần như luôn an toàn: bên gọi chưa biết thì bỏ qua. Đổi kiểu, đổi ý nghĩa, hay bỏ một trường thì không — và nguy hiểm nhất là đổi <em>ý nghĩa</em> mà giữ nguyên tên, vì không công cụ nào phát hiện được.",
  "Cần ý nghĩa khác thì thêm trường mới bên cạnh, đánh dấu trường cũ sẽ bỏ, rồi bỏ sau khi không còn ai gọi.",
)}
<h2>Lỗi cũng là hợp đồng</h2>
${p(
  "Mã lỗi được bên gọi xử lý bằng mã, y như dữ liệu thành công. Đổi một thông báo lỗi thành mã khác là thay đổi phá vỡ tương thích, dù không trường dữ liệu nào bị đụng.",
  "Cho lỗi một hình dạng ổn định ngay từ đầu — một mã máy đọc được, một câu cho người đọc — và giữ nguyên phần máy đọc.",
)}
`,
          },
          {
            title: "Xử lý lỗi và thử lại",
            minutes: 20,
            summary: "Thử lại không đúng cách biến sự cố nhỏ thành sự cố lớn.",
            objectives: ["Phân loại lỗi tạm thời và vĩnh viễn", "Dùng idempotency key"],
            html: `
${p(
  "Không phải lỗi nào cũng đáng thử lại. Lỗi 400 thử lại bao nhiêu lần cũng vẫn 400 — chỉ tốn thêm lượt gọi. Chỉ thử lại với lỗi <em>tạm thời</em>: timeout, 503, mất kết nối.",
)}
<h2>Thử lại phải có backoff và giới hạn</h2>
${p(
  "Thử lại ngay lập tức khi dịch vụ phía dưới đang quá tải là đổ thêm tải vào đúng lúc nó yếu nhất. Giãn khoảng cách theo cấp số nhân, cộng một lượng ngẫu nhiên để hàng nghìn client không cùng thử lại một thời điểm.",
  "Và phải có trần. Thử lại vô hạn biến một sự cố năm phút thành một hàng đợi tồn đọng nhiều giờ.",
)}
<h2>Idempotency</h2>
${p(
  "Request tạo đơn hàng bị timeout — đơn đã tạo hay chưa? Không biết được từ phía client. Thử lại thì có nguy cơ tạo hai đơn.",
  "Cách xử lý là <em>idempotency key</em>: client sinh một khoá cho mỗi ý định, gửi kèm mọi lần thử. Server thấy khoá đã xử lý thì trả lại kết quả cũ thay vì làm lại. Mọi API tạo dữ liệu có tiền bạc đi kèm đều nên có.",
)}
`,
          },
        ],
      },
      {
        title: "Vận hành",
        description: "Nhìn được vào bên trong khi có sự cố.",
        lessons: [
          {
            title: "Log truy được và một id xuyên suốt",
            minutes: 20,
            summary: "Thứ đáng làm trước khi dựng thêm dashboard.",
            objectives: ["Log có cấu trúc", "Truyền correlation id qua các service"],
            html: `
${p(
  "Khi có sự cố, phản xạ thường thấy là dựng thêm dashboard. Biểu đồ cho biết <em>có</em> chuyện xảy ra và lúc nào — nhưng gần như không bao giờ cho biết <em>vì sao</em>. Câu trả lời nằm trong log, và log chỉ dùng được nếu đã chuẩn bị trước.",
)}
<h2>Một id đi hết vòng đời request</h2>
${p(
  "Sinh một id ở cửa ngõ, gắn vào mọi log của mọi service mà request đi qua, và trả về trong phản hồi lỗi. Người dùng báo lỗi kèm id, bạn lọc đúng id đó và thấy toàn bộ đường đi.",
  "Không có nó, mỗi lần điều tra là ghép thủ công theo mốc thời gian giữa nhiều service — vừa chậm vừa hay ghép nhầm khi tải cao.",
)}
<h2>Mức log dùng đúng nghĩa</h2>
${p(
  "<code>ERROR</code> để dành cho thứ cần người xử lý. Một request hỏng vì người dùng nhập sai không phải <code>ERROR</code>. Đánh nhầm mức khiến cảnh báo kêu suốt, và cảnh báo kêu suốt thì chẳng ai nhìn nữa.",
  "Thước đo đơn giản: thấy một dòng <code>ERROR</code> mà bạn không định làm gì cả, nó không phải <code>ERROR</code>.",
)}
`,
          },
          {
            title: "Kiểm tra sức khoẻ và triển khai không gián đoạn",
            minutes: 18,
            summary: "liveness và readiness khác nhau, và nhầm chúng gây sự cố.",
            objectives: ["Phân biệt liveness và readiness", "Tắt service đúng cách"],
            html: `
${p(
  "<em>Liveness</em> trả lời: tiến trình này còn sống không, hay cần khởi động lại? <em>Readiness</em> trả lời: nó đã sẵn sàng nhận request chưa?",
  "Nhầm hai cái gây sự cố thật. Cho kiểm tra kết nối cơ sở dữ liệu vào liveness nghĩa là cơ sở dữ liệu chớp một nhịp thì toàn bộ service bị khởi động lại — biến một trục trặc hai giây thành một sự cố hai phút.",
)}
<h2>Tắt đúng cách</h2>
${p(
  "Nhận tín hiệu dừng thì việc đầu tiên là báo readiness thất bại, để bộ cân bằng tải ngừng gửi request mới. Sau đó mới xử lý nốt request đang dở rồi mới thoát.",
  "Thoát ngay khi nhận tín hiệu sẽ cắt ngang những request đang chạy — và với người dùng thì đó là lỗi, dù bản triển khai mới hoàn toàn tốt.",
)}
`,
          },
        ],
      },
    ],
  },
];

async function seedCourse(prisma, lessonContents, course) {
  const [row] = await prisma.$queryRawUnsafe(`SELECT id FROM courses WHERE slug = $1`, course.slug);
  if (row === undefined) {
    console.warn(`  BỎ QUA  ${course.slug} — không có khóa học nào mang slug này`);
    return null;
  }

  let lessonCount = 0;
  for (const [chapterIndex, chapter] of course.chapters.entries()) {
    const position = chapterIndex + 1;

    // Khoá idempotent là (course_id, position): bảng không có ràng buộc duy nhất nào để
    // `ON CONFLICT` bám vào, nên tìm trước rồi mới quyết định thêm hay sửa.
    const [existing] = await prisma.$queryRawUnsafe(
      `SELECT id FROM chapters WHERE course_id = $1::uuid AND position = $2`,
      row.id,
      position,
    );

    let chapterId;
    if (existing === undefined) {
      const [created] = await prisma.$queryRawUnsafe(
        `INSERT INTO chapters (course_id, title, description, position)
         VALUES ($1::uuid, $2, $3, $4) RETURNING id`,
        row.id,
        chapter.title,
        chapter.description,
        position,
      );
      chapterId = created.id;
    } else {
      await prisma.$executeRawUnsafe(
        `UPDATE chapters SET title = $2, description = $3, updated_at = now() WHERE id = $1::uuid`,
        existing.id,
        chapter.title,
        chapter.description,
      );
      chapterId = existing.id;
    }

    for (const [lessonIndex, lesson] of chapter.lessons.entries()) {
      const lessonPosition = lessonIndex + 1;
      const [found] = await prisma.$queryRawUnsafe(
        `SELECT id FROM lessons WHERE chapter_id = $1::uuid AND position = $2`,
        chapterId,
        lessonPosition,
      );

      let lessonId;
      if (found === undefined) {
        const [created] = await prisma.$queryRawUnsafe(
          `INSERT INTO lessons (chapter_id, course_id, title, type, duration_minutes,
                                is_preview, position)
           VALUES ($1::uuid, $2::uuid, $3, 'article'::lesson_type, $4, $5, $6) RETURNING id`,
          chapterId,
          row.id,
          lesson.title,
          lesson.minutes,
          lesson.isPreview ?? false,
          lessonPosition,
        );
        lessonId = created.id;
      } else {
        await prisma.$executeRawUnsafe(
          `UPDATE lessons SET title = $2, duration_minutes = $3, is_preview = $4,
                              type = 'article'::lesson_type, updated_at = now()
            WHERE id = $1::uuid`,
          found.id,
          lesson.title,
          lesson.minutes,
          lesson.isPreview ?? false,
        );
        lessonId = found.id;
      }

      const written = await lessonContents.findOneAndUpdate(
        { lessonId },
        {
          $set: {
            contentHtml: lesson.html.trim(),
            summary: lesson.summary,
            objectives: lesson.objectives,
            updatedAt: new Date(),
          },
          $setOnInsert: { lessonId, createdAt: new Date() },
        },
        { upsert: true, returnDocument: "after" },
      );

      await prisma.$executeRawUnsafe(
        `UPDATE lessons SET content_ref = $2 WHERE id = $1::uuid`,
        lessonId,
        String(written._id),
      );

      lessonCount += 1;
    }
  }

  // `total_chapters`/`total_lessons` là cột đếm phi chuẩn hoá mà thẻ khóa học đọc thẳng;
  // đếm lại từ dữ liệu thật thay vì cộng dồn, để chạy lại seed không làm số phình lên.
  await prisma.$executeRawUnsafe(
    `UPDATE courses SET
       total_chapters = (SELECT count(*) FROM chapters WHERE course_id = courses.id),
       total_lessons  = (SELECT count(*) FROM lessons  WHERE course_id = courses.id),
       updated_at = now()
     WHERE id = $1::uuid`,
    row.id,
  );

  return { chapters: course.chapters.length, lessons: lessonCount };
}

async function main() {
  const prisma = new PrismaClient();
  const mongo = await MongoClient.connect(env("MONGO_URI"));
  const lessonContents = mongo.db(env("MONGO_DB")).collection("lesson_contents");

  let chapters = 0;
  let lessons = 0;
  for (const course of COURSES) {
    const result = await seedCourse(prisma, lessonContents, course);
    if (result === null) continue;
    chapters += result.chapters;
    lessons += result.lessons;
    console.log(`  ${course.slug}  →  ${result.chapters} chương, ${result.lessons} bài học`);
  }

  await mongo.close();
  await prisma.$disconnect();
  console.log(`\nĐã seed ${chapters} chương và ${lessons} bài học.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
