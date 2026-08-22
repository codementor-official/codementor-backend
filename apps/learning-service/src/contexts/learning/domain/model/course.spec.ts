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
  earlyAccess: false,
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

  /**
   * `archived` không có đường ra cho tới khi `restore` được thêm — và với
   * `content_status` thì tác giả tự gỡ cũng rơi vào đây, nên "gỡ" mà không bật lại được
   * nghĩa là mọi lần gỡ đều vĩnh viễn.
   */
  describe('gỡ và khôi phục', () => {
    const submittable = { chapters: [{ lessonCount: 2 }], lessonsMissingContent: 0, exercisesNotUsable: 0 };
    const published = () => {
      const course = make();
      course.edit({ description: 'Mô tả khóa học' });
      course.submit(submittable);
      course.moderate('approve', null);
      return course;
    };

    it('chỉ gỡ được khóa học đang công khai', () => {
      expect(make().moderate('archive', 'Ly do kiem thu').isFail).toBe(true);
      const course = published();
      expect(course.moderate('archive', 'Ly do kiem thu').isOk).toBe(true);
      expect(course.status).toBe('archived');
    });

    it('khôi phục đưa về draft rồi đi lại vòng duyệt, giữ ngày phát hành đầu tiên', () => {
      const course = published();
      const firstPublishedAt = course.publishedAt;
      course.moderate('archive', 'Ly do kiem thu');

      expect(course.moderate('restore', null).isOk).toBe(true);
      expect(course.status).toBe('draft');

      expect(course.submit(submittable).isOk).toBe(true);
      expect(course.moderate('approve', null).isOk).toBe(true);
      expect(course.status).toBe('published');
      expect(course.publishedAt).toEqual(firstPublishedAt);
    });

    it('chỉ khôi phục được khóa học đã gỡ', () => {
      expect(make().moderate('restore', null).isFail).toBe(true);
      expect(published().moderate('restore', null).isFail).toBe(true);
    });

    // Gỡ vì nội dung sai thì tác giả phải đọc được vì sao, ở đúng ô đã đọc lý do từ chối.
    it('gỡ kèm lý do thì lý do đó thay chỗ lý do từ chối cũ', () => {
      const course = published();
      course.moderate('archive', '  Bài 3 dùng ảnh vi phạm bản quyền  ');
      expect(course.rejectionReason).toBe('Bài 3 dùng ảnh vi phạm bản quyền');
    });
  });

  describe('sửa và gửi duyệt lại khóa học đang công khai', () => {
    const submittable = { chapters: [{ lessonCount: 2 }], lessonsMissingContent: 0, exercisesNotUsable: 0 };
    const published = () => {
      const course = make();
      course.edit({ description: 'Mô tả khóa học' });
      course.submit(submittable);
      course.moderate('approve', null);
      return course;
    };

    it('gửi duyệt lại được — sửa khóa đang sống thì phải qua duyệt lại', () => {
      const course = published();
      expect(course.submit(submittable, 'Đã sửa lại chương 2').isOk).toBe(true);
      expect(course.status).toBe('pending_review');
      expect(course.submitNote).toBe('Đã sửa lại chương 2');
    });

    // Người duyệt đã đọc bản trước; không có ghi chú thì họ phải tự đoán đã đổi chỗ nào.
    it('gửi duyệt LẠI mà không kèm ghi chú thì bị từ chối', () => {
      const course = published();
      expect(course.submit(submittable).isFail).toBe(true);
      expect(course.status).toBe('published');
    });

    // Lần gửi ĐẦU từ bản nháp thì không hỏi — chưa có quyết định nào để giải thích.
    it('gửi duyệt lần đầu từ nháp không cần ghi chú', () => {
      const course = make();
      course.edit({ description: 'Mô tả khóa học' });
      expect(course.submit(submittable).isOk).toBe(true);
      expect(course.submitNote).toBeNull();
    });

    // Huỷ gửi duyệt KHÔNG BAO GIỜ được công khai nội dung — xem `Course.withdraw`.
    it('hủy gửi duyệt lại thì về draft, không phải published', () => {
      const course = published();
      course.submit(submittable, 'Đã sửa lại chương 2');
      expect(course.withdraw().isOk).toBe(true);
      expect(course.status).toBe('draft');
      expect(course.publishedAt).not.toBeNull();
    });

    // Đường sinh ra bug gốc: `publishedAt` sống sót qua archive → restore, nên suy trạng
    // thái trước khi gửi từ nó sẽ tự công khai lại một khoá vừa bị gỡ.
    it('khoá đã bị gỡ rồi khôi phục, gửi duyệt xong huỷ, vẫn phải là draft', () => {
      const course = published();
      expect(course.moderate('archive', 'Nội dung sai').isOk).toBe(true);
      expect(course.moderate('restore', null).isOk).toBe(true);
      expect(course.status).toBe('draft');

      course.submit(submittable);
      expect(course.withdraw().isOk).toBe(true);
      expect(course.status).toBe('draft');
    });
  });

  describe('xin gỡ khóa học đang công khai', () => {
    const submittable = { chapters: [{ lessonCount: 2 }], lessonsMissingContent: 0, exercisesNotUsable: 0 };
    const published = () => {
      const course = make();
      course.edit({ description: 'Mô tả khóa học' });
      course.submit(submittable);
      course.moderate('approve', null);
      return course;
    };

    it('xin gỡ giữ nguyên published, chỉ đánh dấu đang chờ', () => {
      const course = published();
      expect(course.removalRequested).toBe(false);

      expect(course.requestRemoval('Cần sửa lại nội dung chương 3').isOk).toBe(true);
      expect(course.status).toBe('published');
      expect(course.removalRequested).toBe(true);
      expect(course.rejectionReason).toBe('Cần sửa lại nội dung chương 3');
    });

    it('bắt buộc nêu lý do khi xin gỡ, và chỉ xin gỡ được nội dung đang công khai', () => {
      const course = published();
      expect(course.requestRemoval('  ').isFail).toBe(true);
      expect(make().requestRemoval('vì lý do gì đó').isFail).toBe(true);
    });

    it('admin duyệt yêu cầu xin gỡ thì đi qua đúng đường archive như mọi lần thu hồi khác', () => {
      const course = published();
      course.requestRemoval('Vi phạm bản quyền ảnh minh hoạ');
      expect(course.moderate('archive', 'Vi phạm bản quyền ảnh minh hoạ').isOk).toBe(true);
      expect(course.status).toBe('archived');
      expect(course.removalRequested).toBe(false);
    });

    it('admin từ chối yêu cầu xin gỡ thì khóa học không đổi gì, nguyện vọng bị xoá', () => {
      const course = published();
      course.requestRemoval('Cần sửa lại nội dung chương 3');

      expect(course.denyRemoval().isOk).toBe(true);
      expect(course.status).toBe('published');
      expect(course.removalRequested).toBe(false);
      expect(course.rejectionReason).toBeNull();
    });

    it('không có gì để từ chối khi chưa ai xin gỡ', () => {
      expect(published().denyRemoval().isFail).toBe(true);
    });
  });

  /** Lối lùi cho quyết định của admin — xem chú thích ở `Course.moderate`. */
  describe('admin đổi ý', () => {
    const submittable = { chapters: [{ lessonCount: 2 }], lessonsMissingContent: 0, exercisesNotUsable: 0 };
    const decided = (decision: 'reject' | 'request_changes') => {
      const course = make();
      course.edit({ description: 'Mô tả khóa học' });
      course.submit(submittable);
      course.moderate(decision, 'Chưa đạt');
      return course;
    };

    it('duyệt được khóa học vừa từ chối, không cần tác giả gửi lại', () => {
      const course = decided('reject');
      expect(course.status).toBe('rejected');
      expect(course.moderate('approve', null).isOk).toBe(true);
      expect(course.status).toBe('published');
      expect(course.rejectionReason).toBeNull();
    });

    it('duyệt được khóa học đang chờ tác giả sửa', () => {
      expect(decided('request_changes').moderate('approve', null).isOk).toBe(true);
    });

    it('không từ chối được khóa học chưa gửi duyệt', () => {
      expect(make().moderate('reject', 'Không hợp lệ').isFail).toBe(true);
    });
  });
});
