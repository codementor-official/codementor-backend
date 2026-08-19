import { Exercise } from './exercise';
import { Slug } from './slug';
import { validateForSubmission } from './exercise-content';

const slug = (raw = 'dao-nguoc-danh-sach') => {
  const parsed = Slug.create(raw);
  if (parsed.isFail) throw parsed.error;
  return parsed.value;
};

const make = (overrides: Partial<Parameters<typeof Exercise.create>[0]> = {}) => {
  const created = Exercise.create({
    id: 'e0000000-0000-4000-8000-000000000001',
    slug: slug(),
    title: '  Đảo ngược danh sách  ',
    kind: 'code',
    difficulty: 'medium',
    authorId: 'u1',
    ...overrides,
  });
  if (created.isFail) throw created.error;
  return created.value;
};

describe('Slug', () => {
  it('chuẩn hoá về chữ thường để khớp citext của CSDL', () => {
    expect(slug('Dao-Nguoc').value).toBe('dao-nguoc');
  });

  // Không bỏ dấu trước khi lọc thì "Đệ quy" ra "quy" — mất luôn từ đầu.
  it('bỏ dấu tiếng Việt khi sinh từ tiêu đề', () => {
    const generated = Slug.fromTitle('Đệ quy và Quay lui');
    expect(generated.isOk).toBe(true);
    expect(generated.value.value).toBe('de-quy-va-quay-lui');
  });

  it('tiêu đề toàn ký tự lạ vẫn ra slug hợp lệ', () => {
    const generated = Slug.fromTitle('!!! ???');
    expect(generated.isOk).toBe(true);
  });

  it('từ chối slug sai định dạng', () => {
    for (const bad of ['-mo-dau', 'ket-thuc-', 'CO_HOA', 'ab']) {
      expect(Slug.create(bad).isFail).toBe(true);
    }
  });
});

describe('Exercise — vòng đời', () => {
  it('bài mới luôn ở draft và chưa có nội dung', () => {
    const exercise = make();
    expect(exercise.status).toBe('draft');
    expect(exercise.contentRef).toBeNull();
    expect(exercise.title).toBe('Đảo ngược danh sách');
  });

  it('chưa có nội dung thì không gửi duyệt được', () => {
    expect(make().submit().isFail).toBe(true);
  });

  it('có nội dung thì gửi duyệt được, và xoá lý do từ chối cũ', () => {
    const exercise = make();
    exercise.attachContent('mongo-id');
    expect(exercise.submit().isOk).toBe(true);
    expect(exercise.status).toBe('pending_review');
    expect(exercise.rejectionReason).toBeNull();
  });

  // Cho sửa lúc chờ duyệt nghĩa là admin có thể duyệt một bản khác bản họ đã đọc.
  it('đang chờ duyệt thì khoá sửa, hủy gửi duyệt xong lại sửa được', () => {
    const exercise = make();
    exercise.attachContent('mongo-id');
    exercise.submit();

    expect(exercise.isLockedForReview).toBe(true);
    expect(exercise.editMetadata({ title: 'Tên khác' }).isFail).toBe(true);
    expect(exercise.title).toBe('Đảo ngược danh sách');

    expect(exercise.withdraw().isOk).toBe(true);
    expect(exercise.status).toBe('draft');
    expect(exercise.editMetadata({ title: 'Tên khác' }).isOk).toBe(true);
    expect(exercise.title).toBe('Tên khác');
  });

  it('chỉ hủy gửi duyệt được khi đang chờ duyệt', () => {
    expect(make().withdraw().isFail).toBe(true);
  });

  it('bị trả về thì sửa xong gửi lại được — đó là luồng bình thường', () => {
    const exercise = make();
    exercise.attachContent('mongo-id');
    for (const status of ['changes_requested', 'rejected'] as const) {
      const rehydrated = Exercise.rehydrate('id', {
        ...(exercise as unknown as { props: Parameters<typeof Exercise.rehydrate>[1] }).props,
        status,
      });
      expect(rehydrated.submit().isOk).toBe(true);
      expect(rehydrated.status).toBe('pending_review');
    }
  });

  it('gửi duyệt lại được từ published — sửa bài đang sống thì phải qua duyệt lại', () => {
    const exercise = make();
    exercise.attachContent('mongo-id');
    exercise.submit();
    const published = Exercise.rehydrate('id', {
      ...(exercise as unknown as { props: Parameters<typeof Exercise.rehydrate>[1] }).props,
      status: 'published',
      publishedAt: new Date(),
    });
    expect(published.submit().isOk).toBe(true);
    expect(published.status).toBe('pending_review');
  });

  it('hủy gửi duyệt lại một bài đã từng công khai thì về published, không phải draft', () => {
    const exercise = make();
    exercise.attachContent('mongo-id');
    exercise.submit();
    const resubmitted = Exercise.rehydrate('id', {
      ...(exercise as unknown as { props: Parameters<typeof Exercise.rehydrate>[1] }).props,
      status: 'pending_review',
      publishedAt: new Date(),
    });
    expect(resubmitted.withdraw().isOk).toBe(true);
    expect(resubmitted.status).toBe('published');
  });
});

describe('Exercise — điều kiện fork và xoá', () => {
  const published = (visibility: 'public' | 'group') =>
    Exercise.rehydrate('id', {
      slug: slug(),
      title: 'Bài mẫu',
      summary: null,
      kind: 'code',
      difficulty: 'easy',
      status: 'published',
      visibility,
      xpReward: 0,
      estimatedMinutes: null,
      timeLimitMs: 1000,
      memoryLimitKb: 262_144,
      authorId: 'u2',
      contentRef: 'mongo-id',
      forkedFromId: null,
      rejectionReason: null,
      publishedAt: new Date(),
      updatedAt: new Date(),
    });

  it('chỉ fork được bài public đã published', () => {
    expect(published('public').isForkable).toBe(true);
    // Bài của nhóm học tập không thuộc catalog chung nên không phải hàng công khai.
    expect(published('group').isForkable).toBe(false);
    expect(make().isForkable).toBe(false);
  });

  it('bài đã published thì không xoá cứng, phải gỡ bằng trạng thái', () => {
    expect(make().isDeletable).toBe(true);
    expect(published('public').isDeletable).toBe(false);
  });
});

describe('Exercise — ràng buộc metadata khớp CHECK của CSDL', () => {
  it('chặn giới hạn thời gian và bộ nhớ ngoài khoảng CSDL cho phép', () => {
    const exercise = make();
    expect(exercise.editMetadata({ timeLimitMs: 50 }).isFail).toBe(true);
    expect(exercise.editMetadata({ timeLimitMs: 70_000 }).isFail).toBe(true);
    expect(exercise.editMetadata({ memoryLimitKb: 512 }).isFail).toBe(true);
    expect(exercise.editMetadata({ timeLimitMs: 2000 }).isOk).toBe(true);
    expect(exercise.timeLimitMs).toBe(2000);
  });

  it('chặn XP âm và thời lượng không dương', () => {
    const exercise = make();
    expect(exercise.editMetadata({ xpReward: -1 }).isFail).toBe(true);
    expect(exercise.editMetadata({ estimatedMinutes: 0 }).isFail).toBe(true);
    expect(exercise.editMetadata({ estimatedMinutes: null }).isOk).toBe(true);
  });

  it('tiêu đề rỗng bị chặn ngay từ lúc tạo', () => {
    expect(Exercise.create({
      id: 'x', slug: slug(), title: '   ', kind: 'code', difficulty: 'easy', authorId: 'u1',
    }).isFail).toBe(true);
  });
});

describe('validateForSubmission', () => {
  const full = {
    statement: 'đề bài',
    languages: [{ id: 'py', label: 'Python', referenceSolution: 'x' }],
    testCases: [
      { order: 1, input: 'a', expected: 'b', visibility: 'public' as const },
      { order: 2, input: 'c', expected: 'd', visibility: 'hidden' as const },
      { order: 3, input: 'e', expected: 'f', visibility: 'hidden' as const },
    ],
  };

  it('đủ điều kiện thì qua', () => {
    expect(validateForSubmission('code', full).isOk).toBe(true);
  });

  it('thiếu lời giải mẫu thì chặn, và nói rõ ngôn ngữ nào', () => {
    const result = validateForSubmission('code', {
      ...full,
      languages: [{ id: 'py', label: 'Python' }],
    });
    expect(result.isFail).toBe(true);
    expect(result.error.message).toContain('Python');
  });

  it('dưới 3 test case thì chặn', () => {
    expect(validateForSubmission('code', { ...full, testCases: full.testCases.slice(0, 2) }).isFail).toBe(true);
  });

  // Không có case công khai thì học viên không thấy ví dụ nào trong workspace.
  it('không có test case công khai thì chặn', () => {
    const hiddenOnly = full.testCases.map((t) => ({ ...t, visibility: 'hidden' as const }));
    expect(validateForSubmission('code', { ...full, testCases: hiddenOnly }).isFail).toBe(true);
  });

  it('bài lý thuyết chỉ cần nội dung', () => {
    expect(validateForSubmission('theory', {}).isFail).toBe(true);
    expect(validateForSubmission('theory', { theory: { contentHtml: '<p>x</p>' } }).isOk).toBe(true);
  });

  describe('chế độ chữ ký hàm', () => {
    const fn = {
      statement: 'đề bài',
      ioMode: 'function' as const,
      signature: {
        functionName: 'solve_quadratic',
        parameters: [
          { name: 'a', type: { kind: 'float' } },
          { name: 'b', type: { kind: 'float' } },
        ],
        returnType: { kind: 'list', of: { kind: 'float' } },
      },
      languages: [{ id: 'py', label: 'Python', referenceSolution: 'x' }],
      testCases: [
        { order: 1, args: [1, -3], expected: [2.0], visibility: 'public' as const },
        { order: 2, args: [1, 2], expected: [], visibility: 'hidden' as const },
        { order: 3, args: [1, 5], expected: [1.0], visibility: 'hidden' as const },
      ],
    };

    it('đủ điều kiện thì qua', () => {
      expect(validateForSubmission('code', fn).isOk).toBe(true);
    });

    it('thiếu chữ ký thì chặn', () => {
      const withoutSignature = { ...fn, signature: undefined };
      expect(validateForSubmission('code', withoutSignature).isFail).toBe(true);
    });

    // Tên hàm được sinh ra ở cả ba ngôn ngữ; trùng từ khoá là lỗi cú pháp trong code hệ
    // thống sinh, không phải trong code học viên.
    it('tên hàm trùng từ khoá Java thì chặn', () => {
      const result = validateForSubmission('code', {
        ...fn,
        signature: { ...fn.signature, functionName: 'class' },
      });
      expect(result.isFail).toBe(true);
      expect(result.error.message).toContain('từ khoá');
    });

    it('tên hàm không phải snake_case thì chặn', () => {
      expect(
        validateForSubmission('code', {
          ...fn,
          signature: { ...fn.signature, functionName: 'solveQuadratic' },
        }).isFail,
      ).toBe(true);
    });

    it('args lệch số tham số thì chặn, và nói rõ case nào', () => {
      const result = validateForSubmission('code', {
        ...fn,
        testCases: [{ ...fn.testCases[0], args: [1] }, ...fn.testCases.slice(1)],
      });
      expect(result.isFail).toBe(true);
      expect(result.error.message).toContain('test case 1');
    });

    // `expected: null` là một đáp án hợp lệ (hàm trả về null); chỉ vắng mặt mới là thiếu.
    it('null vẫn tính là có đáp án', () => {
      expect(
        validateForSubmission('code', {
          ...fn,
          testCases: [{ ...fn.testCases[0], expected: null }, ...fn.testCases.slice(1)],
        }).isOk,
      ).toBe(true);
    });

    it('thiếu đáp án thì chặn', () => {
      const noExpected = { ...fn.testCases[0], expected: undefined };
      const result = validateForSubmission('code', {
        ...fn,
        testCases: [noExpected, ...fn.testCases.slice(1)],
      });
      expect(result.isFail).toBe(true);
      expect(result.error.message).toContain('đáp án');
    });

    // Bài stdin cũ không mang `ioMode`; các kiểm tra của chế độ hàm không được đụng tới nó.
    it('không áp lên bài stdin cũ', () => {
      expect(validateForSubmission('code', full).isOk).toBe(true);
    });
  });

  /**
   * `archived` không có đường ra cho tới khi `restore` được thêm: `submit` chỉ nhận
   * draft/changes_requested/rejected. `publishedAt ??=` ở nhánh approve đã lường trước
   * chuyện gỡ rồi duyệt lại — đây là đoạn đường còn thiếu.
   */
  describe('gỡ và khôi phục', () => {
    const published = () => {
      const exercise = make();
      exercise.attachContent('mongo-id');
      exercise.submit();
      exercise.moderate('approve', null);
      return exercise;
    };

    it('chỉ gỡ được bài đang công khai', () => {
      expect(make().moderate('archive', null).isFail).toBe(true);
      const exercise = published();
      expect(exercise.moderate('archive', null).isOk).toBe(true);
      expect(exercise.status).toBe('archived');
    });

    it('khôi phục đưa về draft rồi đi lại vòng duyệt, giữ ngày phát hành đầu tiên', () => {
      const exercise = published();
      const firstPublishedAt = exercise.publishedAt;
      exercise.moderate('archive', null);

      expect(exercise.moderate('restore', null).isOk).toBe(true);
      expect(exercise.status).toBe('draft');

      expect(exercise.submit().isOk).toBe(true);
      expect(exercise.moderate('approve', null).isOk).toBe(true);
      expect(exercise.status).toBe('published');
      expect(exercise.publishedAt).toEqual(firstPublishedAt);
    });

    it('chỉ khôi phục được bài đã gỡ', () => {
      expect(make().moderate('restore', null).isFail).toBe(true);
      expect(published().moderate('restore', null).isFail).toBe(true);
    });

    // Gỡ vì bài sai thì tác giả phải đọc được vì sao, ở đúng ô họ đã đọc lý do từ chối.
    it('gỡ kèm lý do thì lý do đó thay chỗ lý do từ chối cũ', () => {
      const exercise = published();
      exercise.moderate('archive', '  Testcase sai từ case 3  ');
      expect(exercise.rejectionReason).toBe('Testcase sai từ case 3');
    });
  });

  /**
   * Hai lối lùi cho quyết định của admin. Thiếu chúng thì một lần nhấn nhầm chỉ sửa được
   * bằng UPDATE thẳng vào CSDL, hoặc bằng cách phiền tác giả gửi lại bài.
   */
  describe('admin đổi ý', () => {
    const rejected = () => {
      const exercise = make();
      exercise.attachContent('mongo-id');
      exercise.submit();
      exercise.moderate('reject', 'Đề chưa rõ ràng');
      return exercise;
    };

    it('duyệt được bài mình vừa từ chối, không cần tác giả gửi lại', () => {
      const exercise = rejected();
      expect(exercise.status).toBe('rejected');
      expect(exercise.moderate('approve', null).isOk).toBe(true);
      expect(exercise.status).toBe('published');
      expect(exercise.rejectionReason).toBeNull();
    });

    it('duyệt được bài đang chờ tác giả sửa', () => {
      const exercise = make();
      exercise.attachContent('mongo-id');
      exercise.submit();
      exercise.moderate('request_changes', 'Thiếu ví dụ');
      expect(exercise.moderate('approve', null).isOk).toBe(true);
      expect(exercise.status).toBe('published');
    });

    // Duyệt thì lùi được, còn từ chối thì không: bài draft chưa ai gửi lên để mà từ chối.
    it('không từ chối được bài chưa gửi duyệt', () => {
      expect(make().moderate('reject', 'Không hợp lệ').isFail).toBe(true);
    });
  });
});
