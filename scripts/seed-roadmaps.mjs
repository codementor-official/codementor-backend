// Thêm lộ trình để trang `/roadmaps` có đủ dữ liệu mà hiển thị đúng.
//
// Trước seed này CSDL chỉ có ba lộ trình đã xuất bản. Hệ quả trên giao diện: dải "Lộ trình
// dành cho bạn" là lưới bốn cột nhưng chỉ lấp được ba ô, và thanh phân trang — vốn tự ẩn
// khi chỉ có một trang — không bao giờ xuất hiện. Cả hai đều là thiếu DỮ LIỆU, không phải
// lỗi giao diện.
//
// Các lộ trình dưới đây dùng lại khóa học đã có, không tạo khóa mới.
//
// Idempotent theo `slug`, và theo (lộ trình, khóa) cho phần nối.
//
//   node --env-file=.env scripts/seed-roadmaps.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PrismaClient } from "@prisma/client";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function env(key) {
  const line = readFileSync(join(repoRoot, ".env"), "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
  if (line === null) throw new Error(`thiếu ${key} trong .env`);
  return line[1].trim();
}
env("DATABASE_URL");

/**
 * `courseSlugs` xếp theo đúng thứ tự học. Vị trí bắt đầu từ 1 và tăng dần theo mảng.
 *
 * Lưu ý về `field` của khóa học: bảng `courses` không có cột lĩnh vực, service suy nó từ
 * lộ trình chứa khóa đó có `position` NHỎ NHẤT. Nên các lộ trình ở đây cố tình xếp khóa
 * dùng chung xuống vị trí sau, để không cướp mất lĩnh vực mà lộ trình cũ đang gán cho nó.
 */
const ROADMAPS = [
  {
    slug: "lo-trinh-backend-developer",
    title: "Lộ trình Backend Developer",
    field: "backend",
    level: "basic",
    estimatedHours: 60,
    shortDescription:
      "Từ một ngôn ngữ nền tảng tới một dịch vụ chạy được thật: dữ liệu, API và vận hành.",
    description:
      "Bắt đầu bằng một ngôn ngữ và cấu trúc dữ liệu, rồi tới nơi backend thật sự khó — thiết kế bảng, viết API còn đổi được, và nhìn được vào bên trong hệ thống khi có sự cố. Mỗi khóa mở khóa cái tiếp theo, nên bạn không phải tự đoán nên học gì trước.",
    prerequisiteNote: "Không cần kinh nghiệm lập trình trước đó.",
    popularity: 12,
    courseSlugs: [
      "python-co-ban",
      "cau-truc-du-lieu-co-ban",
      "thiet-ke-co-so-du-lieu-quan-he",
      "kien-truc-backend-cho-he-thong-thuc-te",
    ],
  },
  {
    slug: "lo-trinh-fullstack-javascript",
    title: "Lộ trình Fullstack JavaScript",
    field: "fullstack",
    level: "intermediate",
    estimatedHours: 72,
    shortDescription: "Một ngôn ngữ cho cả hai đầu: giao diện, máy chủ và cơ sở dữ liệu.",
    description:
      "Đi hết một vòng của ứng dụng web bằng JavaScript: cú pháp và bất đồng bộ, bố cục CSS, React ở phía trình duyệt, Node.js ở phía máy chủ, và cơ sở dữ liệu quan hệ đứng sau. Hợp với người đã viết được vài trang tĩnh và muốn dựng một sản phẩm hoàn chỉnh.",
    prerequisiteNote: "Nên biết HTML cơ bản trước khi bắt đầu.",
    popularity: 15,
    courseSlugs: [
      "javascript-cho-nguoi-moi",
      "css-hien-dai-flexbox-va-grid",
      "react-tu-component-toi-ung-dung",
      "nhap-mon-node-js",
      "thiet-ke-co-so-du-lieu-quan-he",
    ],
  },
  {
    slug: "lo-trinh-cau-truc-du-lieu-giai-thuat",
    title: "Lộ trình Cấu trúc dữ liệu & Giải thuật",
    field: "foundation",
    level: "basic",
    estimatedHours: 40,
    shortDescription: "Nền tảng dùng chung cho mọi hướng, và cũng là thứ phỏng vấn hay hỏi.",
    description:
      "Mảng, chuỗi, danh sách liên kết, ngăn xếp, hàng đợi, cây và đồ thị — cài đặt bằng tay trước khi dùng thư viện, để biết mỗi cấu trúc trả giá bằng gì. Đi kèm ngân hàng bài luyện tập để luyện đúng chủ đề vừa học.",
    prerequisiteNote: "Cần biết một ngôn ngữ lập trình bất kỳ ở mức cơ bản.",
    popularity: 18,
    courseSlugs: ["cau-truc-du-lieu-co-ban", "python-co-ban"],
  },
  {
    slug: "lo-trinh-frontend-nang-cao",
    title: "Lộ trình Frontend nâng cao",
    field: "frontend",
    level: "intermediate",
    estimatedHours: 44,
    shortDescription: "Bố cục vững, React hiểu sâu, và biết khi nào KHÔNG cần tối ưu.",
    description:
      "Dành cho người đã dựng được giao diện nhưng hay gặp bố cục vỡ và ứng dụng chậm không rõ lý do. Đi vào box model và hai công cụ bố cục của CSS, rồi tới vòng đời render của React và cách đo trước khi tối ưu.",
    prerequisiteNote: "Cần viết được HTML/CSS và JavaScript cơ bản.",
    popularity: 9,
    courseSlugs: ["css-hien-dai-flexbox-va-grid", "react-tu-component-toi-ung-dung"],
  },
];

async function main() {
  const prisma = new PrismaClient();

  const [author] = await prisma.$queryRawUnsafe(
    `SELECT id FROM users WHERE role = 'lecturer' AND status <> 'deleted' ORDER BY created_at LIMIT 1`,
  );
  if (author === undefined) throw new Error("chưa có tài khoản giảng viên nào để gán làm tác giả");

  for (const roadmap of ROADMAPS) {
    const [row] = await prisma.$queryRawUnsafe(
      `INSERT INTO roadmaps (slug, title, short_description, description, field, level,
                             estimated_hours, prerequisite_note, status, popularity_score,
                             created_by, published_at)
       VALUES ($1, $2, $3, $4, $5::roadmap_field, $6::current_level, $7, $8,
               'published', $9, $10::uuid, now())
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title, short_description = EXCLUDED.short_description,
         description = EXCLUDED.description, field = EXCLUDED.field, level = EXCLUDED.level,
         estimated_hours = EXCLUDED.estimated_hours,
         prerequisite_note = EXCLUDED.prerequisite_note,
         status = 'published', popularity_score = EXCLUDED.popularity_score,
         updated_at = now()
       RETURNING id`,
      roadmap.slug,
      roadmap.title,
      roadmap.shortDescription,
      roadmap.description,
      roadmap.field,
      roadmap.level,
      roadmap.estimatedHours,
      roadmap.prerequisiteNote,
      roadmap.popularity,
      author.id,
    );

    let linked = 0;
    for (const [index, courseSlug] of roadmap.courseSlugs.entries()) {
      const [course] = await prisma.$queryRawUnsafe(
        `SELECT id FROM courses WHERE slug = $1`,
        courseSlug,
      );
      if (course === undefined) {
        console.warn(`    bỏ qua khóa "${courseSlug}" — không tìm thấy`);
        continue;
      }

      // Bảng không có ràng buộc duy nhất trên (roadmap_id, course_id), nên tìm trước rồi
      // mới quyết định thêm hay chỉ cập nhật vị trí.
      const [existing] = await prisma.$queryRawUnsafe(
        `SELECT id FROM roadmap_courses WHERE roadmap_id = $1::uuid AND course_id = $2::uuid`,
        row.id,
        course.id,
      );
      if (existing === undefined) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO roadmap_courses (roadmap_id, course_id, position, is_optional)
           VALUES ($1::uuid, $2::uuid, $3, false)`,
          row.id,
          course.id,
          index + 1,
        );
      } else {
        await prisma.$executeRawUnsafe(
          `UPDATE roadmap_courses SET position = $2 WHERE id = $1::uuid`,
          existing.id,
          index + 1,
        );
      }
      linked += 1;
    }

    console.log(`  ${roadmap.slug}  [${roadmap.field}/${roadmap.level}]  ${linked} khóa`);
  }

  const [{ n }] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM roadmaps WHERE status = 'published'`,
  );
  await prisma.$disconnect();
  console.log(`\nĐã seed ${ROADMAPS.length} lộ trình. Tổng lộ trình đã xuất bản: ${n}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
