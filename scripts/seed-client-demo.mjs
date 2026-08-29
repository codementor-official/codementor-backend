import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = new Date('2026-08-29T09:00:00.000Z');
const DAY = 86_400_000;
const ago = (days) => new Date(BASE.getTime() - days * DAY);

async function seedLearner(user, roadmap, completedCourseCount, partialPercent) {
  await prisma.roadmap_enrollments.upsert({
    where: { user_id_roadmap_id: { user_id: user.id, roadmap_id: roadmap.id } },
    create: {
      user_id: user.id,
      roadmap_id: roadmap.id,
      status: 'active',
      started_at: ago(28),
      last_activity_at: ago(1),
    },
    update: { status: 'active', completed_at: null, last_activity_at: ago(1) },
  });

  const roadmapCourses = await prisma.roadmap_courses.findMany({
    where: { roadmap_id: roadmap.id },
    include: {
      courses: {
        include: {
          chapters: {
            orderBy: { position: 'asc' },
            include: {
              lessons_lessons_course_id_chapter_idTochapters: {
                orderBy: { position: 'asc' },
              },
            },
          },
        },
      },
    },
    orderBy: { position: 'asc' },
  });

  for (const [courseIndex, item] of roadmapCourses.entries()) {
    if (courseIndex > completedCourseCount) break;
    const enrollment = await prisma.course_enrollments.upsert({
      where: { user_id_course_id: { user_id: user.id, course_id: item.course_id } },
      create: {
        user_id: user.id,
        course_id: item.course_id,
        via_roadmap_id: roadmap.id,
        status: 'active',
        started_at: ago(25 - courseIndex * 5),
        last_activity_at: ago(Math.max(1, 6 - courseIndex)),
      },
      update: {
        via_roadmap_id: roadmap.id,
        status: 'active',
        completed_at: null,
        last_activity_at: ago(Math.max(1, 6 - courseIndex)),
      },
    });

    const lessons = item.courses.chapters.flatMap(
      (chapter) => chapter.lessons_lessons_course_id_chapter_idTochapters,
    );
    const completionTarget =
      courseIndex < completedCourseCount
        ? lessons.length
        : Math.max(1, Math.floor(lessons.length * partialPercent));
    for (const [lessonIndex, lesson] of lessons.entries()) {
      if (lessonIndex >= completionTarget) break;
      const completedAt = ago(Math.max(1, 20 - courseIndex * 5 - lessonIndex));
      await prisma.lesson_progress.upsert({
        where: { user_id_lesson_id: { user_id: user.id, lesson_id: lesson.id } },
        create: {
          user_id: user.id,
          lesson_id: lesson.id,
          status: 'completed',
          time_spent_seconds: 900 + lessonIndex * 180,
          started_at: new Date(completedAt.getTime() - 1_800_000),
          completed_at: completedAt,
        },
        update: {
          status: 'completed',
          time_spent_seconds: 900 + lessonIndex * 180,
          completed_at: completedAt,
        },
      });
    }

    // Triggers refresh the caches, but old databases may have been seeded before the
    // trigger migration. Calling the canonical functions keeps both cases consistent.
    await prisma.$executeRaw`SELECT fn_refresh_course_progress(${user.id}::uuid, ${enrollment.course_id}::uuid)`;
  }
  await prisma.$executeRaw`SELECT fn_refresh_roadmap_progress(${user.id}::uuid, ${roadmap.id}::uuid)`;
}

async function seedPersonalSubmissions(user) {
  const exercises = await prisma.exercises.findMany({
    where: { status: 'published', visibility: 'public' },
    orderBy: [{ published_at: 'asc' }, { id: 'asc' }],
    take: 6,
  });
  for (const [index, exercise] of exercises.entries()) {
    const accepted = index !== 4;
    const submittedAt = ago(12 - index * 2);
    await prisma.submissions.upsert({
      where: {
        user_id_exercise_id_attempt_number: {
          user_id: user.id,
          exercise_id: exercise.id,
          attempt_number: 1,
        },
      },
      create: {
        id: `a1000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        user_id: user.id,
        exercise_id: exercise.id,
        language: index % 2 ? 'python' : 'javascript',
        source_code: `// deterministic client demo submission ${index + 1}`,
        verdict: accepted ? 'accepted' : 'wrong_answer',
        score: accepted ? 85 + index * 2 : 55,
        passed_tests: accepted ? 10 : 6,
        total_tests: 10,
        runtime_ms: 24 + index * 7,
        memory_kb: 20_480 + index * 512,
        attempt_number: 1,
        submitted_at: submittedAt,
      },
      update: {
        verdict: accepted ? 'accepted' : 'wrong_answer',
        score: accepted ? 85 + index * 2 : 55,
        passed_tests: accepted ? 10 : 6,
        total_tests: 10,
        submitted_at: submittedAt,
      },
    });
    await prisma.exercise_progress.upsert({
      where: { user_id_exercise_id: { user_id: user.id, exercise_id: exercise.id } },
      create: {
        user_id: user.id,
        exercise_id: exercise.id,
        status: accepted ? 'solved' : 'attempted',
        best_score: accepted ? 85 + index * 2 : 55,
        attempt_count: 1,
        first_solved_at: accepted ? submittedAt : null,
        last_attempt_at: submittedAt,
      },
      update: {
        status: accepted ? 'solved' : 'attempted',
        best_score: accepted ? 85 + index * 2 : 55,
        attempt_count: 1,
        first_solved_at: accepted ? submittedAt : null,
        last_attempt_at: submittedAt,
      },
    });
  }
  return exercises.length;
}

async function main() {
  const [owner, member, roadmaps] = await Promise.all([
    prisma.users.findUnique({ where: { email: 'workspace.owner.e2e@codementor.test' } }),
    prisma.users.findUnique({ where: { email: 'workspace.member.e2e@codementor.test' } }),
    prisma.roadmaps.findMany({
      where: { status: 'published' },
      orderBy: [{ published_at: 'asc' }, { id: 'asc' }],
      take: 2,
    }),
  ]);
  if (!owner || !member) throw new Error('Chạy seed:workspace-demo trước để có hai tài khoản demo');
  if (roadmaps.length === 0) throw new Error('Cần ít nhất một lộ trình published');

  await prisma.study_groups.updateMany({
    where: { slug: 'workspace-demo-klt' },
    data: { privacy: 'public', join_policy: 'approval' },
  });
  await seedLearner(owner, roadmaps[0], 1, 0.6);
  await seedLearner(member, roadmaps[1] ?? roadmaps[0], 0, 0.45);
  const personalSubmissions = await seedPersonalSubmissions(owner);
  const [reportedExercise, reportedArticle] = await Promise.all([
    prisma.exercises.findFirst({ where: { status: 'published' }, orderBy: { updated_at: 'desc' } }),
    prisma.articles.findFirst({ where: { status: 'published' }, orderBy: { updated_at: 'desc' } }),
  ]);
  const demoReports = [
    reportedExercise && {
      reporterId: member.id,
      targetType: 'EXERCISE',
      targetId: reportedExercise.id,
      targetRef: `/solve/${reportedExercise.id}`,
      category: 'MISLEADING',
      note: 'Một test case mẫu chưa khớp với phần mô tả đầu vào, cần kiểm tra lại.',
    },
    reportedArticle && {
      reporterId: owner.id,
      targetType: 'POST',
      targetId: reportedArticle.id,
      targetRef: `/articles/${reportedArticle.slug}`,
      category: 'COPYRIGHT',
      note: 'Cần kiểm tra lại nguồn trích dẫn được nhắc trong phần cuối bài viết.',
    },
  ].filter(Boolean);
  for (const report of demoReports) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO content_reports
         (reporter_id, target_type, target_id, target_ref, category, note, status)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, 'PENDING')
       ON CONFLICT (reporter_id, target_type, target_id) DO UPDATE SET
         target_ref = EXCLUDED.target_ref, category = EXCLUDED.category,
         note = EXCLUDED.note, status = 'PENDING', resolution_note = NULL,
         resolved_by = NULL, resolved_at = NULL, updated_at = now()`,
      report.reporterId,
      report.targetType,
      report.targetId,
      report.targetRef,
      report.category,
      report.note,
    );
  }

  console.log(
    JSON.stringify(
      {
        users: [owner.email, member.email],
        roadmaps: roadmaps.map((roadmap) => roadmap.slug),
        publicWorkspace: 'workspace-demo-klt',
        personalSubmissions,
        contentReports: demoReports.length,
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
