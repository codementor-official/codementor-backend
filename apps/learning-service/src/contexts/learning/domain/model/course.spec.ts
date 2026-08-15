import { Course } from './course';
import { bearsExercise, validateCurriculum, type ChapterDraft } from './curriculum';

const make = () => {
  const created = Course.create({
    id: 'c0000000-0000-4000-8000-000000000001',
    slug: 'nhap-mon-node',
    title: '  Nhập môn Node.js  ',
    level: 'basic',
    createdBy: 'u1',
  });
  if (created.isFail) throw created.error;
  return created.value;
};

const lesson = (over: Partial<ChapterDraft['lessons'][number]> = {}) => ({
  title: 'Bài học',
  type: 'article' as const,
  durationMinutes: 10,
  isPreview: false,
  isOptional: false,
  exerciseId: null,
  ...over,
});

const chapter = (over: Partial<ChapterDraft> = {}): ChapterDraft => ({
  title: 'Chương',
  description: null,
  isOptional: false,
  lessons: [lesson()],
  ...over,
});

describe('Course', () => {
  it('khóa học mới ở draft, người soạn cũng là người đứng lớp', () => {
    const course = make();
    expect(course.status).toBe('draft');
    expect(course.title).toBe('Nhập môn Node.js');
    expect(course.instructorId).toBe('u1');
  });

  it('không có setter cho hai cột do trigger giữ', () => {
    const course = make();
    expect(course.totalChapters).toBe(0);
    expect(course.totalLessons).toBe(0);
    expect('setTotalChapters' in course).toBe(false);
  });

  describe('recalculateDurationHours', () => {
    // Cột là số nguyên GIỜ với CHECK `> 0`. Làm tròn xuống thì khóa 20 phút ra 0 và
    // bị CSDL từ chối.
    it('làm tròn LÊN, khóa dưới một giờ vẫn là 1', () => {
      const course = make();
      course.recalculateDurationHours([20]);
      expect(course.durationHours).toBe(1);
      course.recalculateDurationHours([60, 5]);
      expect(course.durationHours).toBe(2);
    });

    it('bài chưa điền thời lượng tính là 0', () => {
      const course = make();
      course.recalculateDurationHours([60, null, 60]);
      expect(course.durationHours).toBe(2);
    });

    it('không còn bài nào thì về null chứ không phải 0', () => {
      const course = make();
      course.recalculateDurationHours([60]);
      course.recalculateDurationHours([]);
      expect(course.durationHours).toBeNull();
    });
  });

  describe('submit', () => {
    const ready = () => {
      const course = make();
      course.edit({ description: 'Mô tả khóa học' });
      return course;
    };
    const ok = { chapters: [{ lessonCount: 2 }], lessonsMissingContent: 0, exercisesNotUsable: 0 };

    it('đủ điều kiện thì sang chờ duyệt', () => {
      const course = ready();
      expect(course.submit(ok).isOk).toBe(true);
      expect(course.status).toBe('pending_review');
    });

    it('chương rỗng bị chặn và đếm rõ bao nhiêu', () => {
      const result = ready().submit({
        ...ok,
        chapters: [{ lessonCount: 2 }, { lessonCount: 0 }, { lessonCount: 0 }],
      });
      expect(result.isFail).toBe(true);
      expect(result.error.message).toContain('2 chương chưa có bài nào');
    });

    it('bài lý thuyết chưa có nội dung bị chặn', () => {
      const result = ready().submit({ ...ok, lessonsMissingContent: 3 });
      expect(result.isFail).toBe(true);
      expect(result.error.message).toContain('3 bài lý thuyết chưa có nội dung');
    });

    // Bài code chưa công khai của người khác thì học viên mở ra không thấy gì.
    it('bài code không dùng được bị chặn', () => {
      const result = ready().submit({ ...ok, exercisesNotUsable: 1 });
      expect(result.isFail).toBe(true);
      expect(result.error.message).toContain('chưa công khai và không phải của bạn');
    });

    it('thiếu mô tả bị chặn', () => {
      expect(make().submit(ok).isFail).toBe(true);
    });
  });

  it('slug đổi được khi chưa công khai, khoá lại sau đó', () => {
    const course = make();
    expect(course.edit({ slug: 'Node-Co-Ban' }).isOk).toBe(true);
    expect(course.slug).toBe('node-co-ban');
    expect(course.edit({ slug: '-sai-' }).isFail).toBe(true);
  });

  it('ảnh bìa chỉ nhận http và https', () => {
    const course = make();
    expect(course.edit({ coverImageUrl: 'javascript:alert(1)' }).isFail).toBe(true);
    expect(course.edit({ coverImageUrl: 'https://cdn.test/a.png' }).isOk).toBe(true);
  });
});

describe('validateCurriculum', () => {
  it('cây hợp lệ thì qua', () => {
    expect(validateCurriculum([chapter(), chapter()]).isOk).toBe(true);
  });

  it('chỉ mấy kiểu bài tập mới gắn được bài code', () => {
    expect(bearsExercise('exercise')).toBe(true);
    expect(bearsExercise('challenge')).toBe(true);
    expect(bearsExercise('article')).toBe(false);
    expect(bearsExercise('video')).toBe(false);

    const bad = validateCurriculum([
      chapter({ lessons: [lesson({ type: 'article', exerciseId: 'e1' })] }),
    ]);
    expect(bad.isFail).toBe(true);
    expect(bad.error.message).toContain('không gắn được bài code');
  });

  // Tiến độ khoá theo (user, exercise) nên hai ô cùng một bài thì một ô không xong được.
  it('cùng một bài code hai lần trong một chương bị chặn', () => {
    const result = validateCurriculum([
      chapter({
        lessons: [
          lesson({ type: 'exercise', exerciseId: 'e1' }),
          lesson({ type: 'exercise', exerciseId: 'e1' }),
        ],
      }),
    ]);
    expect(result.isFail).toBe(true);
    expect(result.error.message).toContain('hai lần');
  });

  it('cùng bài code ở HAI chương khác nhau thì được', () => {
    expect(
      validateCurriculum([
        chapter({ lessons: [lesson({ type: 'exercise', exerciseId: 'e1' })] }),
        chapter({ lessons: [lesson({ type: 'exercise', exerciseId: 'e1' })] }),
      ]).isOk,
    ).toBe(true);
  });

  it('chỉ ra đúng chương và bài khi tiêu đề rỗng', () => {
    const result = validateCurriculum([chapter(), chapter({ lessons: [lesson({ title: '  ' })] })]);
    expect(result.isFail).toBe(true);
    expect(result.error.message).toContain('bài 1 của chương 2');
  });

  it('thời lượng không dương bị chặn', () => {
    expect(
      validateCurriculum([chapter({ lessons: [lesson({ durationMinutes: 0 })] })]).isFail,
    ).toBe(true);
  });

  it('id trùng trong cùng một lần ghi bị chặn', () => {
    expect(
      validateCurriculum([
        chapter({ id: 'ch1', lessons: [lesson({ id: 'l1' })] }),
        chapter({ id: 'ch1', lessons: [] }),
      ]).isFail,
    ).toBe(true);
  });
});
