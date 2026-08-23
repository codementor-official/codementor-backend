import { PrismaClient } from '@prisma/client';
import mongoose from 'mongoose';

const prisma = new PrismaClient();
const NOW = new Date();
const DAY = 86_400_000;
const GROUP_ID = '11111111-1111-4111-8111-111111111111';

const PEOPLE = [
  ['Nguyễn Trung Nguyên', 'nguyen.trung.nguyen', 11, 1890, 36, 9],
  ['Lê Thị Cẩm Tú', 'le.thi.cam.tu', 18, 1680, 32, 8],
  ['Trần Văn Bảo', 'tran.van.bao', 24, 1510, 29, 7],
  ['Phạm Minh Khang', 'pham.minh.khang', 22, 1435, 27, 6],
  ['Võ Ngọc Anh', 'vo.ngoc.anh', 20, 1320, 25, 5],
  ['Đặng Hoàng Nam', 'dang.hoang.nam', 17, 1190, 22, 5],
  ['Bùi Khánh Linh', 'bui.khanh.linh', 16, 1075, 20, 4],
  ['Đỗ Gia Hân', 'do.gia.han', 15, 960, 18, 4],
  ['Hồ Đức Thịnh', 'ho.duc.thinh', 14, 845, 16, 3],
  ['Ngô Quỳnh Mai', 'ngo.quynh.mai', 13, 760, 14, 3],
  ['Dương Nhật Minh', 'duong.nhat.minh', 12, 680, 12, 2],
  ['Lý Thu Trang', 'ly.thu.trang', 10, 590, 10, 2],
  ['Mai Quốc Huy', 'mai.quoc.huy', 9, 510, 9, 2],
  ['Tạ Phương Thảo', 'ta.phuong.thao', 8, 420, 7, 1],
  ['Phan Tuấn Kiệt', 'phan.tuan.kiet', 7, 330, 6, 1],
  ['Trương Mỹ Duyên', 'truong.my.duyen', 5, 240, 4, 1],
  ['Lâm Anh Quân', 'lam.anh.quan', 3, 120, 2, 0],
  ['Cao Thảo Vy', 'cao.thao.vy', 1, 0, 0, 0],
];

const EXERCISES = [
  ['Mảng và kỹ thuật Two Pointers', 'array-two-pointers', 'Duyệt hai đầu mảng để tìm cặp phần tử có tổng bằng target.', 'easy', 80, 25, 'Mảng & Danh sách', -24],
  ['Đảo ngược danh sách liên kết', 'reverse-linked-list', 'Đảo ngược singly linked list trong O(n) thời gian và O(1) bộ nhớ.', 'medium', 120, 35, 'Mảng & Danh sách', -21],
  ['Kiểm tra ngoặc hợp lệ bằng Stack', 'valid-parentheses-stack', 'Dùng stack để kiểm tra chuỗi ngoặc đúng thứ tự.', 'easy', 90, 25, 'Stack & Queue', -18],
  ['Mô phỏng hàng đợi ưu tiên', 'priority-queue-simulation', 'Xử lý chuỗi thao tác enqueue/dequeue theo độ ưu tiên.', 'medium', 130, 40, 'Stack & Queue', -15],
  ['Tìm kiếm nhị phân', 'binary-search', 'Tìm vị trí phần tử trên mảng tăng dần với độ phức tạp O(log n).', 'medium', 120, 35, 'Tìm kiếm', -12],
  ['Chiều cao của cây nhị phân', 'binary-tree-height', 'Tính chiều cao cây bằng duyệt đệ quy hoặc theo tầng.', 'medium', 140, 40, 'Cây', -9],
  ['Kiểm tra cây tìm kiếm nhị phân', 'validate-binary-search-tree', 'Xác định cây có thỏa điều kiện BST trên toàn bộ cây.', 'hard', 180, 55, 'Cây', -6],
  ['K phần tử lớn nhất bằng Heap', 'top-k-elements-heap', 'Dùng min-heap kích thước k để lấy các phần tử lớn nhất.', 'medium', 150, 45, 'Heap', -3],
  ['BFS tìm đường đi ngắn nhất', 'bfs-shortest-path', 'Tìm số cạnh ít nhất giữa hai đỉnh trong đồ thị không trọng số.', 'medium', 160, 45, 'Đồ thị', 2],
  ['DFS đếm thành phần liên thông', 'dfs-connected-components', 'Đếm số thành phần liên thông bằng DFS.', 'medium', 160, 45, 'Đồ thị', 5],
  ['Dijkstra trên đồ thị trọng số', 'dijkstra-shortest-path', 'Tính khoảng cách ngắn nhất từ một đỉnh tới các đỉnh còn lại.', 'hard', 220, 65, 'Đồ thị nâng cao', 8],
  ['Sắp xếp topo bằng Kahn', 'topological-sort-kahn', 'Sắp xếp topo DAG bằng indegree và queue.', 'hard', 200, 60, 'Đồ thị nâng cao', 11],
];

const DOCUMENTS = [
  ['Cheat sheet Cấu trúc dữ liệu', 'Tổng hợp', 'Tóm tắt Array, Stack, Queue, Tree, Heap, Graph và độ phức tạp thao tác.', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures', 'published'],
  ['Bảng độ phức tạp Big-O', 'Độ phức tạp', 'So sánh O(1), O(log n), O(n), O(n log n) bằng ví dụ trực quan.', 'https://www.bigocheatsheet.com/', 'published'],
  ['Trực quan hóa Array và Linked List', 'Mảng & Danh sách', 'Mô phỏng chèn, xóa và duyệt trên mảng, danh sách liên kết.', 'https://visualgo.net/en/list', 'published'],
  ['Stack và Queue qua hình ảnh', 'Stack & Queue', 'Minh họa LIFO, FIFO và các thao tác cơ bản.', 'https://visualgo.net/en/list', 'published'],
  ['Binary Search: từ ý tưởng đến code', 'Tìm kiếm', 'Invariant và các lỗi off-by-one thường gặp.', 'https://cp-algorithms.com/num_methods/binary_search.html', 'published'],
  ['Tree Traversal: Pre/In/Post-order', 'Cây', 'Tổng hợp ba cách duyệt DFS trên cây nhị phân.', 'https://en.wikipedia.org/wiki/Tree_traversal', 'published'],
  ['Binary Search Tree Notes', 'Cây', 'Tính chất BST, insert, delete và kiểm tra hợp lệ.', 'https://en.wikipedia.org/wiki/Binary_search_tree', 'published'],
  ['Heap và Priority Queue', 'Heap', 'Cấu trúc heap, heapify và ứng dụng top-k.', 'https://en.wikipedia.org/wiki/Heap_(data_structure)', 'published'],
  ['BFS & DFS Handbook', 'Đồ thị', 'Khi nào dùng BFS, DFS và cách quản lý visited.', 'https://cp-algorithms.com/graph/breadth-first-search.html', 'published'],
  ['Dijkstra từng bước', 'Đồ thị nâng cao', 'Giải thích relaxation và priority queue.', 'https://cp-algorithms.com/graph/dijkstra.html', 'published'],
  ['Topological Sorting', 'Đồ thị nâng cao', 'Hai cách sắp xếp topo: DFS và Kahn.', 'https://cp-algorithms.com/graph/topological-sort.html', 'published'],
  ['Bộ câu hỏi ôn tập giữa kỳ', 'Tổng hợp', 'Câu hỏi tự kiểm tra Array, Stack, Queue và Tree.', 'https://en.wikipedia.org/wiki/Data_structure', 'published'],
  ['Ghi chú buổi chữa bài Graph', 'Đồ thị', 'Các lỗi phổ biến khi biểu diễn adjacency list.', 'https://visualgo.net/en/dfsbfs', 'pending'],
  ['Thảo luận Amortized Analysis', 'Độ phức tạp', 'Bản nháp về chi phí trung bình của dynamic array.', 'https://en.wikipedia.org/wiki/Amortized_analysis', 'pending'],
  ['Đề cương thi thử số 2', 'Tổng hợp', 'Đề cương đang chờ chủ nhóm duyệt.', 'https://en.wikipedia.org/wiki/Algorithm', 'pending'],
  ['Đáp án cũ cần cập nhật', 'Tổng hợp', 'Tài liệu ẩn vì một số đáp án chưa chính xác.', 'https://en.wikipedia.org/wiki/Data_structure', 'hidden'],
];

async function main() {
  const [owner, loginMember] = await Promise.all([
    prisma.users.findUnique({ where: { email: 'workspace.owner.e2e@codementor.test' } }),
    prisma.users.findUnique({ where: { email: 'workspace.member.e2e@codementor.test' } }),
  ]);
  if (!owner || !loginMember) throw new Error('Cần hai account Workspace E2E trong bảng users trước khi seed demo');
  const authSynced = process.env.WORKSPACE_DEMO_PASSWORD ? await syncDemoPasswords([owner.email, loginMember.email], process.env.WORKSPACE_DEMO_PASSWORD) : false;

  const users = await seedUsers();
  const group = await seedWorkspace(owner.id);
  await removeLegacyWorkspaceExercises(group.id);
  const memberships = await seedMemberships(group.id, owner, loginMember, users);
  await seedRolePermissions(group.id);
  await seedStats(owner.id, loginMember.id, memberships);
  const documents = await seedDocuments(group.id, owner.id, memberships);
  const exercises = await seedExercises(owner.id);
  await seedMongoContents(exercises);
  const linked = await seedGroupExercises(group.id, owner.id, exercises, documents);
  const { assignments, submissions } = await seedLearningData(group.id, owner.id, memberships, linked);
  await seedActivities(group.id, owner.id, memberships, linked, assignments, submissions, documents);

  const memberCount = await prisma.group_members.count({ where: { group_id: group.id, status: 'active' } });
  const latest = await prisma.group_activities.findFirst({ where: { group_id: group.id }, orderBy: { created_at: 'desc' } });
  await prisma.study_groups.update({ where: { id: group.id }, data: { member_count: memberCount, last_activity_at: latest?.created_at ?? NOW, updated_at: NOW } });
  console.log(JSON.stringify({ workspace: group.slug, members: memberCount, documents: await prisma.group_documents.count({ where: { group_id: group.id } }), exercises: linked.length, assignments: assignments.length, submissions: submissions.length, activities: await prisma.group_activities.count({ where: { group_id: group.id } }), authSynced }, null, 2));
}

async function seedUsers() {
  return Promise.all(PEOPLE.map(([name, handle], index) => prisma.users.upsert({
    where: { email: `${handle}@codementor.test` },
    create: { id: uuid('51000000-0000-4000-8000', index + 1), email: `${handle}@codementor.test`, handle: `demo-${handle.replaceAll('.', '-')}`, display_name: name, avatar_url: avatar(name), bio: 'Thành viên nhóm ôn tập Cấu trúc dữ liệu và Giải thuật.', external_id: `workspace-demo-${String(index + 1).padStart(2, '0')}`, status: 'active', email_verified_at: ago(40 - index), last_active_at: ago(Math.min(index, 12)) },
    update: { display_name: name, avatar_url: avatar(name), bio: 'Thành viên nhóm ôn tập Cấu trúc dữ liệu và Giải thuật.', status: 'active', last_active_at: ago(Math.min(index, 12)) },
  })));
}

function seedWorkspace(ownerId) {
  const data = { name: 'Nhóm Ôn tập Cấu trúc Dữ liệu', description: 'Nhóm học tập thực hành Cấu trúc dữ liệu & Giải thuật: học theo tuần, chữa bài định kỳ, chia sẻ tài liệu và theo dõi tiến độ minh bạch.', topic: 'Cấu trúc dữ liệu & Giải thuật', owner_id: ownerId, invite_code: 'KLTNDEMO01', status: 'active', last_activity_at: NOW, created_at: ago(35) };
  return prisma.study_groups.upsert({ where: { slug: 'workspace-demo-klt' }, create: { id: GROUP_ID, slug: 'workspace-demo-klt', ...data, member_count: 20, created_at: ago(35) }, update: data });
}

async function removeLegacyWorkspaceExercises(groupId) {
  const legacy = await prisma.group_exercises.findMany({ where: { group_id: groupId, exercises: { slug: { in: ['demo-binary-search-workspace', 'demo-linked-list-workspace'] } } }, select: { id: true } });
  const ids = legacy.map((item) => item.id);
  if (ids.length === 0) return;
  await prisma.submissions.deleteMany({ where: { assignments: { group_exercise_id: { in: ids } } } });
  await prisma.assignments.deleteMany({ where: { group_exercise_id: { in: ids } } });
  await prisma.group_exercises.deleteMany({ where: { id: { in: ids }, group_id: groupId } });
}

async function seedMemberships(groupId, owner, loginMember, users) {
  const completed = [12, 12, 11, 10, 10, 9, 8, 7, 7, 6, 6, 5, 4, 3, 2, 1, 0, 0];
  const profiles = [{ user: owner, role: 'owner', joinedDays: 35, completed: 0 }, { user: loginMember, role: 'deputy', joinedDays: 32, completed: 12 }, ...users.map((user, index) => ({ user, role: index === 0 ? 'deputy' : 'member', joinedDays: PEOPLE[index][2], completed: completed[index] }))];
  const result = [];
  for (const [index, profile] of profiles.entries()) {
    const membership = await prisma.group_members.upsert({ where: { group_id_user_id: { group_id: groupId, user_id: profile.user.id } }, create: { id: uuid('61000000-0000-4000-8000', index + 1), group_id: groupId, user_id: profile.user.id, role: profile.role, status: 'active', joined_at: ago(profile.joinedDays) }, update: { role: profile.role, status: 'active', joined_at: ago(profile.joinedDays) } });
    result.push({ ...profile, membership });
  }
  return result;
}

async function seedRolePermissions(groupId) {
  const permissions = ['upload_doc', 'create_exercise', 'edit_exercise', 'delete_doc', 'review_submission', 'remove_member'];
  const grants = { deputy: new Set(['upload_doc', 'create_exercise', 'edit_exercise', 'review_submission']), member: new Set(['upload_doc']) };
  await prisma.$transaction(['deputy', 'member'].flatMap((role) => permissions.map((permission) => prisma.group_role_permissions.upsert({ where: { group_id_role_permission: { group_id: groupId, role, permission } }, create: { group_id: groupId, role, permission, allowed: grants[role].has(permission) }, update: { allowed: grants[role].has(permission) } }))));
}

async function seedStats(ownerId, loginMemberId, memberships) {
  const rows = memberships.map((profile, index) => {
    if (profile.user.id === ownerId) return [profile.user.id, 2450, 44, 12];
    if (profile.user.id === loginMemberId) return [profile.user.id, 2180, 40, 10];
    const fixture = PEOPLE[index - 2];
    return [profile.user.id, fixture[3], fixture[4], fixture[5]];
  });
  await prisma.$transaction(rows.map(([userId, xp, solved, streak]) => prisma.user_stats.upsert({ where: { user_id: userId }, create: { user_id: userId, xp, solved_count: solved, current_streak_days: streak, longest_streak_days: streak + 4, last_solved_on: solved ? ago(Math.max(0, 8 - streak)) : null }, update: { xp, solved_count: solved, current_streak_days: streak, longest_streak_days: streak + 4, last_solved_on: solved ? ago(Math.max(0, 8 - streak)) : null } })));
}

async function seedDocuments(groupId, ownerId, memberships) {
  const result = [];
  for (const [index, [title, topic, preview, url, status]] of DOCUMENTS.entries()) {
    const id = uuid('21000000-0000-4000-8000', index + 1);
    const uploaderId = index % 4 === 0 ? memberships[2 + (index % (memberships.length - 2))].user.id : ownerId;
    const data = { group_id: groupId, title, doc_type: 'Link', topic, uploader_id: uploaderId, storage_key: null, url, preview_text: preview, status, ai_verdict: 'valid', reviewed_by: status === 'published' ? ownerId : null, reviewed_at: status === 'published' ? ago(Math.max(1, 25 - index)) : null, uploaded_at: ago(Math.max(1, 28 - index)) };
    result.push(await prisma.group_documents.upsert({ where: { id }, create: { id, ...data }, update: data }));
  }
  return result;
}

async function seedExercises(ownerId) {
  const result = [];
  for (const [index, [title, suffix, summary, difficulty, xp, minutes]] of EXERCISES.entries()) {
    const data = { title, summary, difficulty, status: 'draft', visibility: 'public', source: 'manual', xp_reward: xp, estimated_minutes: minutes, time_limit_ms: 1500, memory_limit_kb: 262144, author_id: ownerId, published_at: null };
    result.push(await prisma.exercises.upsert({ where: { slug: `demo-dsa-${suffix}` }, create: { id: uuid('31000000-0000-4000-8000', index + 1), slug: `demo-dsa-${suffix}`, ...data, created_at: ago(31 - index) }, update: data }));
  }
  return result;
}

async function seedMongoContents(exercises) {
  if (!process.env.MONGO_URI) throw new Error('Thiếu MONGO_URI để seed nội dung bài tập');
  const mongo = await mongoose.createConnection(process.env.MONGO_URI, { dbName: process.env.MONGO_DB || 'codementor', autoIndex: false, ignoreUndefined: true }).asPromise();
  try {
    const collection = mongo.collection('exercise_contents');
    for (const [index, exercise] of exercises.entries()) {
      const contentRef = await upsertContent(collection, exercise.id, contentFor(EXERCISES[index]));
      await prisma.exercises.update({ where: { id: exercise.id }, data: { content_ref: contentRef, status: 'published', published_at: ago(30 - index) } });
    }
  } finally { await mongo.close(); }
}

async function seedGroupExercises(groupId, ownerId, exercises, documents) {
  const result = [];
  for (const [index, exercise] of exercises.entries()) {
    const fixture = EXERCISES[index];
    const data = { assigned_by: ownerId, due_at: fromNow(fixture[7]), attempt_limit: index % 3 === 0 ? 5 : 3, allow_retry: true, allow_late_submission: index < 8, phase: fixture[6], reference_document_id: documents[index].id, created_at: ago(29 - index) };
    result.push(await prisma.group_exercises.upsert({ where: { group_id_exercise_id: { group_id: groupId, exercise_id: exercise.id } }, create: { id: uuid('41000000-0000-4000-8000', index + 1), group_id: groupId, exercise_id: exercise.id, ...data }, update: data }));
  }
  return result;
}

async function seedLearningData(groupId, ownerId, memberships, linked) {
  const learners = memberships.filter((profile) => profile.role !== 'owner');
  const assignments = [];
  for (const [memberIndex, profile] of learners.entries()) {
    for (const [exerciseIndex, groupExercise] of linked.entries()) {
      const completed = exerciseIndex < profile.completed;
      const inProgress = !completed && (exerciseIndex === profile.completed || (profile.completed === 0 && memberIndex % 2 === 0 && exerciseIndex === 0));
      const late = completed && exerciseIndex < 8 && (memberIndex + exerciseIndex) % 5 === 0;
      const status = late ? 'late' : completed ? 'done' : inProgress ? 'inprogress' : 'notstarted';
      const createdAt = ago(Math.max(1, 29 - exerciseIndex));
      const startedAt = status === 'notstarted' ? null : new Date(createdAt.getTime() + DAY * (1 + memberIndex % 3));
      const data = { group_id: groupId, status, review_status: completed ? 'approved' : 'pending', feedback: completed ? feedback(memberIndex, exerciseIndex) : null, started_at: startedAt, reviewed_by: completed ? ownerId : null, reviewed_at: completed ? ago((memberIndex + exerciseIndex) % 20) : null, created_at: createdAt };
      const record = await prisma.assignments.upsert({ where: { group_exercise_id_member_id: { group_exercise_id: groupExercise.id, member_id: profile.membership.id } }, create: { group_exercise_id: groupExercise.id, member_id: profile.membership.id, ...data }, update: data });
      assignments.push({ ...record, profile, groupExercise, memberIndex, exerciseIndex });
    }
  }

  await prisma.submissions.deleteMany({ where: { assignments: { group_id: groupId } } });
  const submissions = [];
  for (const assignment of assignments) {
    const completed = ['done', 'late'].includes(assignment.status);
    if (!completed && assignment.status !== 'inprogress') continue;
    const attempts = completed ? 1 + ((assignment.memberIndex + assignment.exerciseIndex) % 3) : 1 + ((assignment.memberIndex + assignment.exerciseIndex) % 2);
    let finalAt = ago((assignment.memberIndex * 3 + assignment.exerciseIndex * 2) % 27);
    if (assignment.status === 'late' && assignment.groupExercise.due_at) finalAt = new Date(assignment.groupExercise.due_at.getTime() + DAY * (1 + (assignment.memberIndex + assignment.exerciseIndex) % 2));
    if (finalAt > NOW) finalAt = NOW;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const accepted = completed && attempt === attempts;
      const submittedAt = new Date(finalAt.getTime() - DAY * (attempts - attempt));
      submissions.push({ user_id: assignment.profile.user.id, exercise_id: assignment.groupExercise.exercise_id, assignment_id: assignment.id, language: attempt % 4 === 0 ? 'python' : 'javascript', source_code: `// workspace-demo-seed\n// ${assignment.profile.user.display_name} - attempt ${attempt}`, verdict: accepted ? 'accepted' : ['wrong_answer', 'runtime_error', 'timeout'][(assignment.memberIndex + assignment.exerciseIndex + attempt) % 3], score: accepted ? 78 + ((assignment.memberIndex * 7 + assignment.exerciseIndex * 3) % 23) : 25 + ((assignment.memberIndex * 5 + assignment.exerciseIndex * 4 + attempt) % 41), passed_tests: accepted ? 10 : 2 + ((assignment.memberIndex + assignment.exerciseIndex + attempt) % 7), total_tests: 10, runtime_ms: 18 + ((assignment.memberIndex * 11 + assignment.exerciseIndex * 7 + attempt) % 130), memory_kb: 20480 + ((assignment.memberIndex + assignment.exerciseIndex) % 8) * 1024, attempt_number: attempt, is_late: Boolean(assignment.groupExercise.due_at && submittedAt > assignment.groupExercise.due_at), note: accepted ? 'Hoàn thành trong đợt ôn tập demo.' : 'Cần xem lại edge case và độ phức tạp.', submitted_at: submittedAt });
    }
  }
  await prisma.submissions.createMany({ data: submissions });

  for (const assignment of assignments) {
    const rows = submissions.filter((row) => row.assignment_id === assignment.id);
    const accepted = rows.find((row) => row.verdict === 'accepted');
    const data = { status: accepted ? 'solved' : rows.length ? 'attempted' : 'todo', best_score: rows.length ? Math.max(...rows.map((row) => row.score ?? 0)) : null, attempt_count: rows.length, first_solved_at: accepted?.submitted_at ?? null, last_attempt_at: rows.at(-1)?.submitted_at ?? null };
    await prisma.assignments.update({ where: { id: assignment.id }, data: { updated_at: rows.at(-1)?.submitted_at ?? assignment.created_at } });
    await prisma.exercise_progress.upsert({ where: { user_id_exercise_id: { user_id: assignment.profile.user.id, exercise_id: assignment.groupExercise.exercise_id } }, create: { user_id: assignment.profile.user.id, exercise_id: assignment.groupExercise.exercise_id, ...data }, update: data });
  }
  for (const groupExercise of linked) {
    const rows = submissions.filter((row) => row.exercise_id === groupExercise.exercise_id);
    const accepted = rows.filter((row) => row.verdict === 'accepted');
    await prisma.exercises.update({ where: { id: groupExercise.exercise_id }, data: { solver_count: new Set(accepted.map((row) => row.user_id)).size, attempt_count: rows.length, acceptance_rate: rows.length ? Math.round(accepted.length / rows.length * 10_000) / 100 : 0 } });
  }
  return { assignments, submissions };
}

async function seedActivities(groupId, ownerId, memberships, linked, assignments, submissions, documents) {
  await prisma.group_activities.deleteMany({ where: { group_id: groupId } });
  const rows = [];
  const add = (actorId, action, targetType, targetId, createdAt) => rows.push({ id: uuid('81000000-0000-4000-8000', rows.length + 1), group_id: groupId, actor_id: actorId, action, target_type: targetType, target_id: targetId, created_at: createdAt });
  memberships.slice(1).forEach((profile) => add(profile.user.id, 'đã tham gia nhóm học tập', 'membership', profile.membership.id, ago(profile.joinedDays)));
  linked.forEach((item, index) => add(ownerId, `đã tạo bài tập “${EXERCISES[index][0]}”`, 'exercise', item.id, ago(29 - index)));
  documents.slice(0, 10).forEach((document) => add(document.uploader_id, `đã chia sẻ tài liệu “${document.title}”`, 'document', document.id, document.uploaded_at));
  [25, 18, 11, 4].forEach((days, index) => add(ownerId, ['đã đăng thông báo lịch ôn tập và mục tiêu tuần', 'đã nhắc lịch chữa bài Stack & Queue tối thứ Sáu', 'đã công bố kết quả thi thử giữa kỳ', 'đã cập nhật kế hoạch ôn Graph và Heap tuần này'][index], 'announcement', groupId, ago(days)));
  submissions.filter((row) => row.verdict === 'accepted').slice(0, 26).forEach((row) => { const item = assignments.find((assignment) => assignment.id === row.assignment_id); if (item) add(row.user_id, `đã hoàn thành bài “${EXERCISES[item.exerciseIndex][0]}”`, 'submission', item.id, row.submitted_at); });
  submissions.filter((row) => row.verdict !== 'accepted').slice(0, 16).forEach((row) => { const item = assignments.find((assignment) => assignment.id === row.assignment_id); if (item) add(row.user_id, `đã nộp lại bài “${EXERCISES[item.exerciseIndex][0]}”`, 'submission', item.id, row.submitted_at); });
  await prisma.group_activities.createMany({ data: rows.sort((a, b) => a.created_at - b.created_at) });
}

async function upsertContent(collection, exerciseId, content) {
  await collection.updateOne({ exerciseId }, { $set: { ...content, kind: 'code', updatedAt: NOW }, $setOnInsert: { exerciseId, createdAt: NOW } }, { upsert: true });
  const row = await collection.findOne({ exerciseId }, { projection: { _id: 1 } });
  if (!row?._id) throw new Error(`Không seed được nội dung bài ${exerciseId}`);
  return row._id.toString();
}

function contentFor([title, , summary]) {
  return { statement: `${summary}\n\nHãy phân tích độ phức tạp và cài đặt lời giải ổn định cho mọi trường hợp biên.`, ioMode: 'function', signature: { functionName: 'solve', parameters: [{ name: 'items', type: { kind: 'list', of: { kind: 'integer' } } }], returnType: { kind: 'integer' } }, constraints: ['1 ≤ items.length ≤ 100000', 'Giá trị nằm trong miền số nguyên 32-bit'], hints: [{ order: 1, text: `Xác định invariant chính của bài ${title}.`, xpPenalty: 10 }], examples: [{ input: '[1, 2, 3, 4]', output: '4', explanation: 'Ví dụ nhỏ để kiểm tra xử lý đầu vào.' }], testCases: [{ order: 1, args: [[1, 2, 3, 4]], expected: 4, visibility: 'public' }, { order: 2, args: [[7]], expected: 1, visibility: 'hidden' }, { order: 3, args: [[2, 2, 5]], expected: 3, visibility: 'hidden' }], languages: [{ id: 'javascript', label: 'JavaScript', monaco: 'javascript', starterCode: 'function solve(items) {\n  // TODO\n}', referenceSolution: 'function solve(items) { return items.length; }' }, { id: 'python', label: 'Python', monaco: 'python', starterCode: 'def solve(items):\n    # TODO\n    pass', referenceSolution: 'def solve(items):\n    return len(items)' }], evaluation: { checker: 'exact', stopOnFirstFailure: false } };
}

const uuid = (prefix, index) => `${prefix}-${String(index).padStart(12, '0')}`;
const ago = (days) => new Date(NOW.getTime() - days * DAY);
const fromNow = (days) => new Date(NOW.getTime() + days * DAY);
const avatar = (name) => `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}`;
const feedback = (member, exercise) => ['Tốt, lời giải rõ ràng và đúng độ phức tạp.', 'Đã đạt. Có thể bổ sung giải thích edge case.', 'Kết quả đúng, cách đặt tên biến dễ đọc.'][(member + exercise) % 3];

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());

async function syncDemoPasswords(emails, password) {
  const baseUrl = (process.env.KEYCLOAK_URL || '').replace(/\/$/, '');
  const realm = process.env.KEYCLOAK_REALM || 'codementor';
  if (!baseUrl) throw new Error('Thiếu KEYCLOAK_URL để đồng bộ account demo');
  const serviceClientId = process.env.KEYCLOAK_USER_SERVICE_CLIENT_ID;
  const serviceClientSecret = process.env.KEYCLOAK_USER_SERVICE_CLIENT_SECRET;
  const tokenRealm = serviceClientId && serviceClientSecret ? realm : 'master';
  const tokenBody = serviceClientId && serviceClientSecret ? new URLSearchParams({ grant_type: 'client_credentials', client_id: serviceClientId, client_secret: serviceClientSecret }) : new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: process.env.KEYCLOAK_ADMIN_USERNAME || '', password: process.env.KEYCLOAK_ADMIN_PASSWORD || '' });
  const response = await fetch(`${baseUrl}/realms/${encodeURIComponent(tokenRealm)}/protocol/openid-connect/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: tokenBody });
  if (!response.ok) throw new Error(`Không đăng nhập được Keycloak admin (${response.status})`);
  const { access_token: token } = await response.json();
  for (const email of emails) {
    const lookup = await fetch(`${baseUrl}/admin/realms/${encodeURIComponent(realm)}/users?email=${encodeURIComponent(email)}&exact=true`, { headers: { authorization: `Bearer ${token}` } });
    const [account] = lookup.ok ? await lookup.json() : [];
    if (!account?.id) throw new Error(`Account ${email} chưa tồn tại trên Keycloak`);
    const reset = await fetch(`${baseUrl}/admin/realms/${encodeURIComponent(realm)}/users/${account.id}/reset-password`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'password', value: password, temporary: false }) });
    if (!reset.ok) throw new Error(`Không đồng bộ được mật khẩu account demo (${reset.status})`);
  }
  return true;
}
