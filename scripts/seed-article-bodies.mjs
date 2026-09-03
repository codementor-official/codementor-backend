// Viết thân cho những bài viết mới chỉ có tiêu đề.
//
// Bảy bài dưới đây đã tồn tại trong `articles` với trạng thái `published`, nhưng thân bài
// ở Mongo chỉ là một mẩu 30–60 ký tự — mở ra là một trang gần như trắng. Đây là chỗ điền
// nội dung thật vào đúng những bài đó.
//
// Khác `seed-articles.mjs` ở chỗ nó TẠO bài mới; file này chỉ ghi thân cho bài đã có, và
// không đụng gì tới `articles` ngoài `content_ref`. Bài nào không tìm thấy theo slug thì
// bỏ qua kèm cảnh báo, không dừng cả lượt chạy.
//
//   node --env-file=.env scripts/seed-article-bodies.mjs
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

const SPRING_BOOT = `
${p(
  "Spring Boot lớn tới mức đọc tài liệu theo thứ tự mục lục là cách chắc chắn nhất để bỏ cuộc. Năm thói quen dưới đây rút ngắn quãng từ \"chạy được\" tới \"hiểu vì sao chạy\".",
)}
<h2>1. Đọc log khởi động, đừng lướt qua nó</h2>
${p(
  "Mỗi lần khởi động, Spring Boot in ra danh sách bean nó đã dựng, cổng nó mở, và cấu hình tự động nào đã kích hoạt. Phần lớn người mới cuộn qua đoạn này để tìm dòng \"Started Application\".",
  "Bật <code>debug=true</code> trong <code>application.properties</code> một lần và đọc phần <em>Positive matches</em>. Đó là câu trả lời trực tiếp cho \"vì sao tôi không viết dòng nào mà nó vẫn kết nối được cơ sở dữ liệu\".",
)}
<h2>2. Một annotation, một câu hỏi</h2>
${p(
  "Gặp <code>@Transactional</code>, đừng chỉ chép vào. Hỏi: nó bắt đầu giao dịch ở đâu, kết thúc ở đâu, và ném ngoại lệ nào thì rollback. Riêng câu cuối đã đủ giải thích phần lớn lỗi \"dữ liệu không được lưu mà chẳng báo gì\" — mặc định chỉ rollback với unchecked exception.",
)}
<h2>3. Tách cấu hình khỏi mã ngay từ bài tập đầu</h2>
${p(
  "Chuỗi kết nối, khoá API, tên hàng đợi — cho hết vào <code>application.yml</code> và đọc qua <code>@ConfigurationProperties</code>. Làm quen từ dự án nhỏ thì lúc phải chạy cùng lúc ba môi trường, bạn đã có sẵn thói quen thay vì phải sửa lại toàn bộ.",
)}
<h2>4. Viết test cho tầng service trước tầng controller</h2>
${p(
  "Controller test cần dựng cả web context và chạy chậm. Service test là JUnit thuần, chạy trong mili giây, và bắt được đúng loại lỗi hay gặp nhất: logic nghiệp vụ sai. Để controller test cho phần định tuyến và mã trạng thái.",
)}
<h2>5. Dựng lại một tính năng đã có bằng tay</h2>
${p(
  "Tự viết một bộ lọc xác thực đơn giản trước khi dùng Spring Security. Không phải để dùng bản tự viết, mà để khi đọc tài liệu Spring Security bạn biết nó đang thay bạn làm gì. Framework chỉ dễ khi bạn từng làm thủ công đúng việc nó tự động hóa.",
)}
`;

const ARTICLES = [
  {
    slug: "5-ky-thuat-giup-ban-hoc-spring-boot-hieu-qua-hon",
    excerpt: "Năm thói quen rút ngắn quãng đường từ 'chạy được' tới 'hiểu vì sao chạy'.",
    takeaway: "Framework chỉ dễ khi bạn từng làm thủ công đúng việc nó tự động hóa.",
    readMinutes: 8,
    contentHtml: SPRING_BOOT,
  },
  {
    // Bản trùng: cùng tiêu đề, khác slug. Xem ghi chú ở cuối file.
    slug: "5-ky-thuat-giup-ban-hoc-spring-boot-hieu-qua-hon-s91h9",
    excerpt: "Năm thói quen rút ngắn quãng đường từ 'chạy được' tới 'hiểu vì sao chạy'.",
    takeaway: "Framework chỉ dễ khi bạn từng làm thủ công đúng việc nó tự động hóa.",
    readMinutes: 8,
    contentHtml: SPRING_BOOT,
  },
  {
    slug: "hieu-ve-index-trong-postgresql",
    excerpt: "Index không phải phép màu. Biết nó là gì thì biết luôn khi nào nó vô dụng.",
    takeaway: "Index tăng tốc đọc và làm chậm ghi. Mỗi index phải trả lời được nó phục vụ truy vấn nào.",
    readMinutes: 9,
    contentHtml: `
${p(
  "Cách hiểu index dễ nhất là nghĩ về mục lục cuối sách. Muốn tìm chữ \"đệ quy\" xuất hiện ở đâu, bạn không lật từng trang — bạn tra mục lục, nó chỉ tới trang 47. Cơ sở dữ liệu làm đúng vậy.",
  "Và cũng như mục lục, nó có giá: mỗi lần thêm một trang mới vào sách, mục lục phải cập nhật theo.",
)}
<h2>B-tree, loại index bạn dùng 90% thời gian</h2>
${p(
  "Mặc định của PostgreSQL là B-tree, giữ khoá theo thứ tự đã sắp. Nhờ thứ tự đó nó phục vụ được nhiều hơn một kiểu truy vấn: so sánh bằng, so sánh lớn/nhỏ, khoảng giá trị, và cả <code>ORDER BY</code> — vì đọc index theo thứ tự là đã có sẵn kết quả sắp xếp.",
)}
<h2>Ba lý do index bị bỏ qua</h2>
${p(
  "<strong>Kiểu dữ liệu hai bên khác nhau.</strong> Cột <code>varchar</code> so với tham số kiểu số buộc PostgreSQL ép kiểu từng dòng, và một cột đã bị bọc trong hàm thì index trên cột đó không dùng được nữa.",
  "<strong>Hàm bọc quanh cột.</strong> <code>WHERE lower(email) = $1</code> không dùng được index trên <code>email</code>. Cần một index trên chính biểu thức <code>lower(email)</code>.",
  "<strong>Truy vấn lấy quá nhiều dòng.</strong> Cần 80% số dòng của bảng thì quét tuần tự nhanh hơn đi vòng qua index rồi quay lại bảng. Bộ tối ưu biết điều này và cố tình bỏ qua index — đó là quyết định đúng, không phải lỗi.",
)}
<h2>Index tổ hợp và thứ tự cột</h2>
${p(
  "Index trên <code>(user_id, created_at)</code> phục vụ được truy vấn lọc theo <code>user_id</code>, và cả lọc theo <code>user_id</code> rồi sắp theo <code>created_at</code>. Nhưng truy vấn chỉ lọc theo <code>created_at</code> thì không — giống như mục lục sắp theo họ rồi mới tới tên: tra theo tên thì vô dụng.",
  "Quy tắc thực dụng: cột dùng để so sánh bằng đứng trước, cột dùng cho khoảng giá trị và sắp xếp đứng sau.",
)}
<h2>Cách kiểm tra, không phải cách đoán</h2>
${p(
  "<code>EXPLAIN ANALYZE</code> trước mỗi truy vấn đáng quan tâm. Thấy <code>Seq Scan</code> trên bảng lớn là dấu hiệu đáng xem lại; thấy <code>Index Scan</code> là index đang có tác dụng. Con số <code>rows</code> mà bộ tối ưu ước lượng lệch xa thực tế thường có nghĩa thống kê đã cũ — chạy <code>ANALYZE</code>.",
)}
`,
  },
  {
    slug: "toi-uu-truy-van-postgresql-cho-nguoi-moi",
    excerpt: "Bốn nguyên nhân giải thích gần hết các truy vấn chậm gặp trong dự án thật.",
    takeaway: "Đo trước khi sửa. EXPLAIN ANALYZE trả lời được câu hỏi mà đọc mã không trả lời nổi.",
    readMinutes: 8,
    contentHtml: `
${p(
  "Truy vấn chậm hiếm khi chậm vì lý do lạ. Bốn nguyên nhân dưới đây giải thích gần hết những gì tôi từng gặp, và cả bốn đều nhìn ra được bằng một lệnh.",
)}
<h2>Bắt đầu bằng EXPLAIN ANALYZE</h2>
${p(
  "<code>EXPLAIN</code> cho biết kế hoạch bộ tối ưu định chạy. Thêm <code>ANALYZE</code> thì nó chạy thật và báo lại thời gian từng bước cùng số dòng thực tế.",
  "Thứ đáng nhìn đầu tiên không phải tổng thời gian, mà là chỗ <em>ước lượng lệch xa thực tế nhất</em>. Bộ tối ưu chọn kế hoạch dựa trên ước lượng; ước lượng sai thì kế hoạch sai, và mọi thứ sau đó đều sai theo.",
)}
<h2>1. Vấn đề N+1</h2>
${p(
  "Lấy 100 bài viết rồi lặp qua từng bài để lấy tác giả là 101 lượt đi lại cơ sở dữ liệu. Mỗi lượt chỉ vài mili giây nên trên máy cá nhân không ai thấy gì; qua mạng thật thì thành vài trăm mili giây.",
  "Sửa bằng một <code>JOIN</code>, hoặc một truy vấn thứ hai dùng <code>WHERE author_id = ANY($1)</code>. Đây là loại lỗi hay đến từ ORM chứ không từ SQL viết tay.",
)}
<h2>2. Join làm nhân số dòng</h2>
${p(
  "Join sang một bảng quan hệ một-nhiều rồi <code>SELECT</code> cột của bảng gốc sẽ nhân bản dòng gốc lên. Thường lộ ra ở chỗ tổng cộng sai gấp mấy lần.",
  "Khi chỉ cần một con số từ bảng bên kia, dùng truy vấn con tương quan hoặc <code>LATERAL</code> thay vì join thẳng.",
)}
<h2>3. Lấy nhiều hơn thứ cần</h2>
${p(
  "<code>SELECT *</code> trên bảng có cột văn bản dài kéo cả nội dung đó qua mạng cho mỗi dòng, kể cả khi màn hình chỉ hiện tiêu đề. Liệt kê đúng cột cần cũng là thứ cho phép PostgreSQL dùng <em>index-only scan</em> — trả lời hoàn toàn từ index, không chạm vào bảng.",
)}
<h2>4. Phân trang bằng OFFSET lớn</h2>
${p(
  "<code>OFFSET 10000</code> buộc cơ sở dữ liệu dựng đủ 10.000 dòng đầu rồi vứt đi. Trang càng sâu càng chậm, một cách tuyến tính.",
  "Phân trang theo con trỏ — <code>WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT 20</code> — giữ tốc độ như nhau ở mọi trang, vì nó luôn bắt đầu từ đúng chỗ cần.",
)}
`,
  },
  {
    slug: "bay-meo-debug-nhanh-hon-voi-chrome-devtools",
    excerpt: "Bảy thứ trong DevTools mà phần lớn người dùng hằng ngày vẫn chưa bật tới.",
    takeaway: "Breakpoint có điều kiện thay được hàng chục dòng console.log.",
    readMinutes: 7,
    contentHtml: `
${p(
  "Phần lớn chúng ta dùng DevTools ở mức mở Console rồi rải <code>console.log</code>. Bảy thứ dưới đây đều nằm sẵn ở đó và tiết kiệm nhiều thời gian hơn hẳn.",
)}
<h2>1. Breakpoint có điều kiện</h2>
${p(
  "Chuột phải vào số dòng, chọn <em>Add conditional breakpoint</em>, gõ <code>id === 42</code>. Chương trình chỉ dừng đúng lần lặp bạn quan tâm, thay vì bấm Continue ba trăm lần hay in ra ba trăm dòng.",
)}
<h2>2. Logpoint</h2>
${p(
  "Cùng menu đó có <em>Add logpoint</em>: in một biểu thức mỗi lần chạy qua dòng ấy, mà không sửa mã nguồn. Nghĩa là không có <code>console.log</code> nào bị bỏ quên trong commit.",
)}
<h2>3. Dừng khi DOM thay đổi</h2>
${p(
  "Trong tab Elements, chuột phải một phần tử → <em>Break on</em> → <em>attribute modifications</em>. Đây là cách nhanh nhất tìm ra đoạn mã nào đang đổi class hay style của phần tử đó, khi bạn không biết nó nằm ở đâu.",
)}
<h2>4. Copy as fetch</h2>
${p(
  "Tab Network, chuột phải một request → <em>Copy</em> → <em>Copy as fetch</em>. Dán thẳng vào Console để chạy lại với tham số khác, đủ cả header và cookie. Nhanh hơn dựng lại request bằng tay rất nhiều.",
)}
<h2>5. Chặn request</h2>
${p(
  "Chuột phải một request → <em>Block request URL</em>. Đây là cách kiểm tra giao diện xử lý ra sao khi một API hỏng, mà không phải đụng vào máy chủ.",
)}
<h2>6. Điều tiết mạng và CPU</h2>
${p(
  "Network throttling ai cũng biết; ít người biết tab Performance còn có CPU throttling. Đặt mức 4× hoặc 6× là gần với máy di động tầm trung — nơi phần lớn người dùng thật đang mở trang của bạn.",
)}
<h2>7. $0 và $_ trong Console</h2>
${p(
  "<code>$0</code> là phần tử vừa chọn trong tab Elements, <code>$_</code> là kết quả biểu thức vừa chạy. Hai biến này bỏ được rất nhiều thao tác trung gian khi thử nhanh một ý.",
)}
`,
  },
  {
    slug: "clean-code-cho-nguoi-moi-di-lam",
    excerpt: "Bốn thói quen làm mã dễ đọc hơn, không cần thuộc lòng nguyên tắc nào.",
    takeaway: "Mã được đọc nhiều lần hơn được viết. Tối ưu cho lần đọc.",
    readMinutes: 7,
    contentHtml: `
${p(
  "\"Clean code\" hay bị hiểu thành một danh sách nguyên tắc phải thuộc. Thực tế nó chỉ là một câu hỏi lặp lại: người đọc đoạn này sau sáu tháng — nhiều khả năng là chính bạn — có hiểu ngay không?",
)}
<h2>Tên nói ý định, không nói kiểu dữ liệu</h2>
${p(
  "<code>userList</code> không nói gì hơn <code>users</code>, mà lại hứa một cấu trúc cụ thể. <code>activeUsers</code> thì nói được điều đáng nói: đây là tập đã lọc, và lọc theo gì.",
  "Với hàm cũng vậy: <code>process()</code> đúng với mọi hàm trên đời. <code>calculateMonthlyFee()</code> chỉ đúng với một hàm.",
)}
<h2>Hàm làm một việc, ở một mức trừu tượng</h2>
${p(
  "Dấu hiệu dễ thấy hơn số dòng: một hàm vừa gọi <code>saveOrder()</code> vừa nối chuỗi định dạng ngày tháng là đang trộn hai mức — một mức nghiệp vụ, một mức thao tác chuỗi. Người đọc phải liên tục đổi tầm nhìn.",
  "Không phải quy tắc \"hàm không quá 20 dòng\". Một hàm 40 dòng làm đúng một việc ở đúng một mức đọc dễ hơn ba hàm 10 dòng gọi vòng qua nhau.",
)}
<h2>Trả về sớm thay vì lồng sâu</h2>
${p(
  "Kiểm tra điều kiện không hợp lệ rồi <code>return</code> ngay ở đầu hàm, phần thân chính đứng ở tầng thụt lề ngoài cùng. Bốn tầng <code>if</code> lồng nhau buộc người đọc giữ bốn điều kiện trong đầu cùng lúc; trả về sớm thì mỗi điều kiện xử lý xong là quên được.",
)}
<h2>Chú thích giải thích VÌ SAO</h2>
${p(
  "<code>// tăng i lên 1</code> là tiếng ồn — mã đã nói điều đó. <code>// API bên thứ ba trả về 1-based, không phải 0-based</code> mới đáng viết, vì không có cách nào đọc ra được từ mã.",
  "Nói chung: mã trả lời <em>làm gì</em>, chú thích trả lời <em>vì sao</em>. Thấy mình đang viết chú thích cho câu hỏi \"làm gì\" thì thường là dấu hiệu nên đổi tên biến hoặc tách hàm.",
)}
`,
  },
  {
    slug: "ba-thoi-quen-giup-code-review-nhe-nhang-hon",
    excerpt: "Review căng thẳng thường không phải vì người review khó tính, mà vì PR quá lớn.",
    takeaway: "PR nhỏ được review kỹ hơn và nhanh hơn. Kích thước là thứ tác giả kiểm soát được.",
    readMinutes: 6,
    contentHtml: `
${p(
  "Code review hay bị coi là chuyện của người review. Phần lớn thứ quyết định buổi review dễ hay khó lại nằm ở tay tác giả, và nằm ở trước khi PR được mở.",
)}
<h2>1. Giữ PR nhỏ</h2>
${p(
  "PR 60 dòng nhận được góp ý cụ thể. PR 1.500 dòng nhận được \"nhìn ổn\" — không phải vì nó ổn, mà vì không ai giữ nổi 1.500 dòng trong đầu cùng lúc.",
  "Refactor lớn thì tách: một PR đổi cấu trúc mà không đổi hành vi, một PR đổi hành vi. Người review kiểm được từng cái một, thay vì phải phân biệt hai loại thay đổi trộn lẫn trong cùng một diff.",
)}
<h2>2. Tự review trước khi mở PR</h2>
${p(
  "Đọc lại diff của chính mình trên giao diện web trước khi bấm nút. Bạn sẽ tự bắt được mã debug bỏ quên, tên biến đặt vội, một tệp lỡ commit — đúng những thứ chiếm phần lớn số góp ý nhưng chẳng nói lên điều gì về thiết kế.",
  "Mỗi góp ý loại đó bị loại bỏ trước là một vòng qua lại được tiết kiệm.",
)}
<h2>3. Viết mô tả trả lời \"vì sao\"</h2>
${p(
  "Diff đã cho biết bạn thay đổi gì. Cái nó không cho biết là vì sao lại chọn cách này, và bạn đã cân nhắc rồi bỏ cách nào.",
  "Ba dòng — vấn đề, hướng đã chọn, hướng đã loại và lý do — biến buổi review từ giải mã ý định thành đánh giá một quyết định đã nêu rõ.",
)}
<h2>Về phía người review</h2>
${p(
  "Nói rõ mức độ của mỗi góp ý. \"Chỗ này rò kết nối\" và \"tôi thích tên kia hơn\" mà viết cùng một giọng thì tác giả không biết cái nào phải sửa, cái nào tuỳ ý. Một tiền tố <em>nit:</em> cho góp ý nhỏ giải quyết gần hết chuyện này.",
)}
`,
  },
];

async function main() {
  const prisma = new PrismaClient();
  const mongo = await MongoClient.connect(env("MONGO_URI"));
  const contents = mongo.db(env("MONGO_DB")).collection("article_contents");

  let written = 0;
  for (const article of ARTICLES) {
    const [row] = await prisma.$queryRawUnsafe(
      `SELECT id FROM articles WHERE slug = $1`,
      article.slug,
    );
    if (row === undefined) {
      console.warn(`  BỎ QUA  ${article.slug} — không có bài nào mang slug này`);
      continue;
    }

    const html = article.contentHtml.trim();

    // `sections` phải bị xoá: bài cũ đang giữ một mẩu `sections` stub, mà trình đọc phía
    // client ưu tiên `contentHtml`. Để cả hai thì Mongo giữ một bản nội dung chết không ai
    // đọc, và lần sau nhìn vào lại tưởng bài có hai thân khác nhau.
    await contents.updateOne(
      { articleId: row.id },
      {
        $set: { contentHtml: html, updatedAt: new Date() },
        $unset: { sections: "" },
        $setOnInsert: { articleId: row.id, createdAt: new Date() },
      },
      { upsert: true },
    );
    const saved = await contents.findOne({ articleId: row.id }, { projection: { _id: 1 } });

    await prisma.$executeRawUnsafe(
      `UPDATE articles
          SET excerpt = $2, takeaway = $3, read_minutes = $4,
              content_ref = $5, status = 'published',
              published_at = COALESCE(published_at, now())
        WHERE id = $1::uuid`,
      row.id,
      article.excerpt,
      article.takeaway,
      article.readMinutes,
      String(saved._id),
    );

    console.log(`  ${article.slug}  (${html.length} ký tự)`);
    written += 1;
  }

  await mongo.close();
  await prisma.$disconnect();
  console.log(`\nĐã viết thân cho ${written}/${ARTICLES.length} bài.`);
  console.log(
    "\nLƯU Ý: hai slug `5-ky-thuat-…` và `5-ky-thuat-…-s91h9` là HAI hàng khác nhau mang\n" +
      "cùng một tiêu đề, nên ô đề xuất hiện hai dòng nhìn y hệt. Seed này điền cùng nội dung\n" +
      "cho cả hai để không bài nào trống; nên xoá bớt một hàng thay vì giữ cả hai.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
