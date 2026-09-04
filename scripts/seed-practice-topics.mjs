#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TOPICS = [
  ['mang', 'Mảng', 'algorithms'],
  ['danh-sach-lien-ket', 'Danh sách liên kết', 'algorithms'],
  ['chuoi', 'Chuỗi', 'algorithms'],
  ['sap-xep', 'Sắp xếp', 'algorithms'],
  ['tim-kiem-nhi-phan', 'Tìm kiếm nhị phân', 'algorithms'],
  ['vong-lap', 'Vòng lặp', 'algorithms'],
  ['cay', 'Cây', 'algorithms'],
  ['do-thi', 'Đồ thị', 'algorithms'],
  ['quy-hoach-dong', 'Quy hoạch động', 'algorithms'],
  ['nhap-mon', 'Nhập môn', 'foundations'],
  ['lo-trinh-hoc', 'Lộ trình học', 'foundations'],
  ['front-end', 'Front-end', 'web'],
  ['javascript', 'JavaScript', 'web'],
  ['react', 'React', 'web'],
  ['tailwind-css', 'Tailwind CSS', 'web'],
  ['back-end', 'Back-end', 'systems'],
  ['devops', 'DevOps', 'systems'],
  ['co-so-du-lieu', 'Cơ sở dữ liệu', 'database'],
  ['python', 'Python', 'data_ai'],
];

/**
 * Mapping có chủ ý cho kho bài public. Không dùng dữ liệu Workspace: bài `visibility=group`
 * phải luôn ở ngoài `/practice`, kể cả khi trùng chủ đề.
 */
const EXERCISE_TOPICS = {
  'bai-tap-chua-dat-ten-eufsx': ['mang', 'vong-lap'],
  'min-num': ['mang', 'vong-lap'],
  'sap-xep-mang': ['mang', 'sap-xep'],
  'demo-binary-search-workspace': ['mang', 'tim-kiem-nhi-phan'],
  'tim-so-lon-nhat': ['mang', 'vong-lap'],
  'bai-tap-chua-dat-ten-br78r': ['front-end'],
  'py-tong-hai-so': ['nhap-mon'],
  'py-dao-nguoc-chuoi': ['chuoi'],
  'demo-linked-list-workspace': ['danh-sach-lien-ket'],
  'py-dem-so-chan': ['mang', 'vong-lap'],
};

const COURSE_TOPICS = {
  'css-hien-dai-flexbox-va-grid': ['front-end', 'tailwind-css'],
  'cau-truc-du-lieu-co-ban': ['mang', 'chuoi', 'danh-sach-lien-ket'],
  'javascript-cho-nguoi-moi': ['javascript', 'front-end', 'nhap-mon'],
  'kien-truc-backend-cho-he-thong-thuc-te': ['back-end', 'devops', 'co-so-du-lieu'],
  'nhap-mon-node-js': ['javascript', 'back-end', 'nhap-mon'],
  'python-co-ban': ['python', 'nhap-mon'],
  'react-tu-component-toi-ung-dung': ['react', 'javascript', 'front-end'],
  'thiet-ke-co-so-du-lieu-quan-he': ['co-so-du-lieu', 'back-end'],
  'khoa-hoc-chua-dat-ten': ['nhap-mon', 'lo-trinh-hoc'],
};

const ROADMAP_TOPICS = {
  'lo-trinh-backend-developer': ['back-end', 'co-so-du-lieu', 'devops'],
  'lo-trinh-cau-truc-du-lieu-giai-thuat': [
    'mang',
    'danh-sach-lien-ket',
    'cay',
    'do-thi',
    'quy-hoach-dong',
  ],
  'lo-trinh-frontend': ['front-end', 'javascript', 'react'],
  'lo-trinh-frontend-nang-cao': ['front-end', 'javascript', 'react', 'tailwind-css'],
  'lo-trinh-fullstack-javascript': ['javascript', 'react', 'back-end', 'co-so-du-lieu'],
  'lo-trinh-nhap-mon': ['nhap-mon', 'lo-trinh-hoc'],
  'lo-trinh-chua-dat-ten-l5m1u': ['back-end', 'devops'],
};

async function replaceRawLinks(table, ownerColumn, ownerId, topicIds) {
  if (table === 'course_tags') {
    await prisma.$transaction([
      prisma.$executeRaw`DELETE FROM course_tags WHERE course_id = ${ownerId}::uuid`,
      ...topicIds.map(
        (tagId) => prisma.$executeRaw`
        INSERT INTO course_tags (course_id, tag_id) VALUES (${ownerId}::uuid, ${tagId}::uuid)
        ON CONFLICT DO NOTHING`,
      ),
    ]);
    return;
  }
  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM roadmap_tags WHERE roadmap_id = ${ownerId}::uuid`,
    ...topicIds.map(
      (tagId) => prisma.$executeRaw`
      INSERT INTO roadmap_tags (roadmap_id, tag_id) VALUES (${ownerId}::uuid, ${tagId}::uuid)
      ON CONFLICT DO NOTHING`,
    ),
  ]);
}

async function main() {
  const topicBySlug = new Map();
  for (const [slug, name, category] of TOPICS) {
    const topic = await prisma.tags.upsert({
      where: { slug },
      create: { slug, name, category },
      update: { name, category },
      select: { id: true, slug: true, name: true },
    });
    topicBySlug.set(slug, topic);
  }

  let taggedCourses = 0;
  for (const [slug, topicSlugs] of Object.entries(COURSE_TOPICS)) {
    const rows =
      await prisma.$queryRaw`SELECT id FROM courses WHERE slug = ${slug}::citext AND status = 'published' LIMIT 1`;
    if (!rows[0]) continue;
    await replaceRawLinks(
      'course_tags',
      'course_id',
      rows[0].id,
      topicSlugs.map((topic) => topicBySlug.get(topic)?.id).filter(Boolean),
    );
    taggedCourses += 1;
  }

  let taggedRoadmaps = 0;
  for (const [slug, topicSlugs] of Object.entries(ROADMAP_TOPICS)) {
    const rows =
      await prisma.$queryRaw`SELECT id FROM roadmaps WHERE slug = ${slug}::citext AND status = 'published' LIMIT 1`;
    if (!rows[0]) continue;
    await replaceRawLinks(
      'roadmap_tags',
      'roadmap_id',
      rows[0].id,
      topicSlugs.map((topic) => topicBySlug.get(topic)?.id).filter(Boolean),
    );
    taggedRoadmaps += 1;
  }

  let taggedExercises = 0;
  let skippedExercises = 0;
  for (const [exerciseSlug, topicSlugs] of Object.entries(EXERCISE_TOPICS)) {
    const exercise = await prisma.exercises.findFirst({
      where: { slug: exerciseSlug, status: 'published', visibility: 'public' },
      select: { id: true },
    });
    if (!exercise) {
      skippedExercises += 1;
      continue;
    }

    const topicIds = topicSlugs.map((slug) => topicBySlug.get(slug)?.id).filter(Boolean);
    await prisma.$transaction([
      prisma.exercise_tags.deleteMany({ where: { exercise_id: exercise.id } }),
      prisma.exercise_tags.createMany({
        data: topicIds.map((tagId) => ({ exercise_id: exercise.id, tag_id: tagId })),
        skipDuplicates: true,
      }),
    ]);
    taggedExercises += 1;
  }

  console.log(
    JSON.stringify(
      {
        topics: TOPICS.length,
        taggedExercises,
        skippedExercises,
        taggedCourses,
        taggedRoadmaps,
        scope: 'public + published only',
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
