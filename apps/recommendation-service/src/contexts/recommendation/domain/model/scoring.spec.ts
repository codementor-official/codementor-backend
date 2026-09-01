import type { Candidate, LearnerPreferences } from './scoring';
import {
  POPULAR_REASON,
  RECOMMENDATION_WEIGHTS,
  isPersonalized,
  normalizePopularity,
  rankCandidates,
  scoreCandidate,
  techKeys,
  titleTechMatch,
  withJustSolved,
} from './scoring';

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'a',
    slug: 'backend-nodejs',
    title: 'Backend với Node.js',
    kind: 'roadmap',
    field: 'backend',
    level: 'intermediate',
    difficulty: null,
    technologies: ['nodejs'],
    tags: [],
    popularityRaw: 0,
    ...overrides,
  };
}

function preferences(overrides: Partial<LearnerPreferences> = {}): LearnerPreferences {
  return {
    currentLevel: 'intermediate',
    careerGoal: null,
    contentPriority: null,
    interestedFields: ['backend'],
    interestedTechnologies: ['Node.js'],
    adaptiveRecommendations: true,
    completed: true,
    ...overrides,
  };
}

describe('scoreCandidate', () => {
  it('cộng điểm lĩnh vực, trình độ và công nghệ khi hồ sơ khớp', () => {
    const { score, reasons } = scoreCandidate(candidate(), preferences(), 0);

    expect(score).toBe(34 + 20 + 20);
    expect(reasons).toHaveLength(3);
    expect(reasons[0]).toContain('Backend');
  });

  it('hồ sơ lệch lĩnh vực và trình độ cho điểm thấp hơn hẳn', () => {
    const matched = scoreCandidate(candidate(), preferences(), 0);
    const mismatched = scoreCandidate(
      candidate(),
      preferences({ currentLevel: 'none', interestedFields: ['frontend'], interestedTechnologies: ['React'] }),
      0,
    );

    expect(mismatched.score).toBeLessThan(matched.score);
    expect(mismatched.reasons).toEqual([POPULAR_REASON]);
  });

  it('trình độ lệch đúng một bậc vẫn được nửa điểm, nhưng không có lý do', () => {
    // `interestedTechnologies` rỗng để cô lập điểm trình độ: tiêu đề mặc định có nhắc
    // Node.js, và `titleTechMatch` sẽ cộng thêm nửa trọng số công nghệ vào đây.
    const { score, reasons } = scoreCandidate(
      candidate({ field: null, technologies: [] }),
      preferences({ currentLevel: 'basic', interestedTechnologies: [] }),
      0,
    );

    expect(score).toBe(10);
    expect(reasons).toEqual([POPULAR_REASON]);
  });

  it('bài tập lệch độ khó bị TRỪ điểm, không chỉ cộng ít đi', () => {
    const easyForExperienced = scoreCandidate(
      candidate({ kind: 'exercise', level: null, difficulty: 'easy', field: null, technologies: [] }),
      preferences({ currentLevel: 'experienced', interestedTechnologies: [] }),
      0,
    );

    expect(easyForExperienced.score).toBeLessThan(0);
  });

  it('khớp nhãn công nghệ tự do với slug trong CSDL', () => {
    expect(techKeys('C/C++')).toEqual(['c', 'cpp']);
    expect(techKeys('C#/.NET')).toEqual(['csharp', 'net']);
    expect(techKeys('Spring Boot')).toEqual(['springboot']);

    const { reasons } = scoreCandidate(
      candidate({ field: null, level: null, technologies: ['cpp'] }),
      preferences({ currentLevel: null, interestedTechnologies: ['C/C++'] }),
      0,
    );
    expect(reasons.some((r) => r.includes('cpp'))).toBe(true);
  });
});

describe('normalizePopularity', () => {
  it('chia theo giá trị lớn nhất của tập, và không chia cho 0', () => {
    const scaled = normalizePopularity([
      candidate({ id: 'a', popularityRaw: 5 }),
      candidate({ id: 'b', popularityRaw: 10 }),
    ]);
    expect(scaled.get('a')).toBe(50);
    expect(scaled.get('b')).toBe(100);

    const empty = normalizePopularity([candidate({ id: 'a', popularityRaw: 0 })]);
    expect(empty.get('a')).toBe(0);
  });
});

describe('rankCandidates', () => {
  const items = [
    candidate({ id: 'match', field: 'backend', popularityRaw: 1 }),
    candidate({ id: 'popular', field: 'mobile', level: 'none', technologies: [], popularityRaw: 50 }),
  ];

  it('cá nhân hóa đẩy mục khớp hồ sơ lên trên mục phổ biến', () => {
    expect(rankCandidates(items, preferences())[0].id).toBe('match');
  });

  it('tắt adaptive_recommendations thì xếp thuần theo độ phổ biến', () => {
    const ranked = rankCandidates(items, preferences({ adaptiveRecommendations: false }));

    expect(ranked[0].id).toBe('popular');
    expect(ranked.every((item) => item.reasons.length > 0)).toBe(true);
    expect(ranked[0].reasons).toEqual([POPULAR_REASON]);
  });

  it('chưa làm onboarding cũng rơi về phổ biến', () => {
    expect(isPersonalized(preferences({ completed: false }))).toBe(false);
    expect(rankCandidates(items, preferences({ completed: false }))[0].id).toBe('popular');
    expect(rankCandidates(items, null)[0].id).toBe('popular');
  });

  it('mọi mục luôn có ít nhất một lý do để hiện lên thẻ', () => {
    expect(rankCandidates(items, preferences()).every((item) => item.reasons.length > 0)).toBe(true);
  });
});

describe('titleTechMatch', () => {
  it('nhận ra công nghệ nêu trong tiêu đề', () => {
    expect(titleTechMatch('Nhập môn Node.js', ['Node.js'])).toBe('Node.js');
    expect(titleTechMatch('Python cơ bản', ['SQL', 'Python'])).toBe('Python');
  });

  it('đòi đủ mọi từ của nhãn nhiều từ', () => {
    expect(titleTechMatch('Spring Boot cho người mới', ['Spring Boot'])).toBe('Spring Boot');
    expect(titleTechMatch('Khởi động với Boot Camp', ['Spring Boot'])).toBeNull();
  });

  it('không khớp theo chuỗi con, và bỏ qua khóa quá ngắn', () => {
    // "django" chứa "go" nhưng không phải Go; "C" trong "C/C++" khớp với mọi thứ.
    expect(titleTechMatch('Django cho người mới', ['Go'])).toBeNull();
    expect(titleTechMatch('Cấu trúc dữ liệu', ['C/C++'])).toBeNull();
    expect(titleTechMatch('Lập trình C++ nâng cao', ['C/C++'])).toBe('C/C++');
  });

  it('không nhầm Java với JavaScript', () => {
    expect(titleTechMatch('JavaScript cho người mới', ['Java'])).toBeNull();
  });
});

describe('scoreCandidate — khớp công nghệ qua tiêu đề', () => {
  const preferences = {
    currentLevel: null,
    careerGoal: null,
    contentPriority: null,
    interestedFields: [],
    interestedTechnologies: ['Node.js'],
    adaptiveRecommendations: true,
    completed: true,
  };

  it('cộng nửa trọng số khi ứng viên không gắn công nghệ nào', () => {
    const item = candidate({ title: 'Nhập môn Node.js', technologies: [], popularityRaw: 0 });
    const { score, reasons } = scoreCandidate(item, preferences, 0);

    expect(score).toBe(10);
    expect(reasons).toEqual(['Liên quan đến Node.js bạn quan tâm']);
  });

  it('không đoán từ tiêu đề khi ứng viên ĐÃ gắn công nghệ', () => {
    const item = candidate({ title: 'Nhập môn Node.js', technologies: ['react'], popularityRaw: 0 });
    const { reasons } = scoreCandidate(item, preferences, 0);

    expect(reasons).toEqual([POPULAR_REASON]);
  });
});

describe('scoreCandidate — chủ đề theo hành vi', () => {
  const neutral = {
    currentLevel: null,
    careerGoal: null,
    contentPriority: null,
    interestedFields: [],
    interestedTechnologies: [],
    adaptiveRecommendations: true,
    completed: true,
  };

  const affinity = new Map([
    ['Đồ thị', { solved: 0, attempted: 3 }],
    ['Mảng', { solved: 4, attempted: 0 }],
  ]);

  it('cộng đủ trọng số cho chủ đề còn dở dang', () => {
    const item = candidate({ kind: 'exercise', field: null, level: null, tags: ['Đồ thị'] });
    const { score, reasons } = scoreCandidate(item, neutral, 0, { affinity });

    expect(score).toBe(22);
    expect(reasons).toEqual(['Bạn còn dở dang ở chủ đề Đồ thị']);
  });

  it('chủ đề đã giải được cộng ít hơn chủ đề còn mắc', () => {
    const stuck = scoreCandidate(
      candidate({ kind: 'exercise', field: null, level: null, tags: ['Đồ thị'] }),
      neutral,
      0,
      { affinity },
    );
    const familiar = scoreCandidate(
      candidate({ kind: 'exercise', field: null, level: null, tags: ['Mảng'] }),
      neutral,
      0,
      { affinity },
    );

    expect(familiar.score).toBeGreaterThan(0);
    expect(familiar.score).toBeLessThan(stuck.score);
    expect(familiar.reasons).toEqual(['Cùng chủ đề Mảng bạn đang luyện']);
  });

  it('một chủ đề còn mắc thắng cả những chủ đề đã giải trên cùng bài', () => {
    const { reasons } = scoreCandidate(
      candidate({ kind: 'exercise', field: null, level: null, tags: ['Mảng', 'Đồ thị'] }),
      neutral,
      0,
      { affinity },
    );

    expect(reasons).toEqual(['Bạn còn dở dang ở chủ đề Đồ thị']);
  });

  it('học viên chưa làm bài nào thì chủ đề không đổi gì', () => {
    const item = candidate({ kind: 'exercise', field: null, level: null, tags: ['Đồ thị'] });
    const { score, reasons } = scoreCandidate(item, neutral, 0);

    expect(score).toBe(0);
    expect(reasons).toEqual([POPULAR_REASON]);
  });
});

describe('withJustSolved', () => {
  it('đếm bài vừa nộp đạt như một lần giải được, dù CSDL chưa kịp biết', () => {
    const merged = withJustSolved(new Map(), ['Đồ thị']);

    expect(merged.get('Đồ thị')).toEqual({ solved: 1, attempted: 0 });
  });

  it('chủ đề vừa chinh phục thôi không còn bị chào là dở dang', () => {
    const before = new Map([['Đồ thị', { solved: 0, attempted: 2 }]]);
    const item = candidate({ kind: 'exercise', field: null, level: null, tags: ['Đồ thị'] });
    const preferences = {
      currentLevel: null,
      careerGoal: null,
      contentPriority: null,
      interestedFields: [],
      interestedTechnologies: [],
      adaptiveRecommendations: true,
      completed: true,
    };

    expect(scoreCandidate(item, preferences, 0, { affinity: before }).reasons).toEqual([
      'Bạn còn dở dang ở chủ đề Đồ thị',
    ]);
    expect(
      scoreCandidate(item, preferences, 0, { affinity: withJustSolved(before, ['Đồ thị']) })
        .reasons,
    ).toEqual(['Cùng chủ đề Đồ thị bạn đang luyện']);
  });

  it('không đụng tới bản đồ gốc', () => {
    const before = new Map([['Mảng', { solved: 1, attempted: 0 }]]);
    withJustSolved(before, ['Mảng']);

    expect(before.get('Mảng')).toEqual({ solved: 1, attempted: 0 });
  });
});

describe('bài viết và nhóm học tập', () => {
  const neutral = preferences({
    currentLevel: null,
    interestedFields: [],
    interestedTechnologies: [],
  });

  it('bài viết ăn điểm chủ đề học viên còn dở dang bên phần luyện tập', () => {
    // `articles.tag_id` và `exercise_tags` cùng trỏ vào bảng `tags`, nên bản đồ chủ đề đếm
    // từ `exercise_progress` chấm được bài viết mà không cần thêm nguồn nào.
    const article = candidate({
      kind: 'article',
      field: null,
      level: null,
      technologies: [],
      tags: ['Đệ quy'],
    });
    const affinity = new Map([['Đệ quy', { solved: 0, attempted: 3 }]]);

    const { score, reasons } = scoreCandidate(article, neutral, 0, { affinity });

    expect(reasons).toEqual(['Bạn còn dở dang ở chủ đề Đệ quy']);
    expect(score).toBe(RECOMMENDATION_WEIGHTS.topic);
  });

  it('nhóm không có lĩnh vực lẫn trình độ vẫn xếp hạng được bằng độ phổ biến', () => {
    const quiet = candidate({ id: 'q', kind: 'group', field: null, level: null, technologies: [], tags: [], popularityRaw: 2 });
    const busy = candidate({ id: 'b', kind: 'group', field: null, level: null, technologies: [], tags: [], popularityRaw: 90 });

    const ranked = rankCandidates([quiet, busy], neutral);

    expect(ranked.map((item) => item.id)).toEqual(['b', 'q']);
    expect(ranked[0].reasons).toEqual([POPULAR_REASON]);
  });

  it('ưu tiên lý thuyết nhích bài viết lên như nhích khóa học', () => {
    const theory = preferences({
      contentPriority: 'theory',
      currentLevel: null,
      interestedFields: [],
      interestedTechnologies: [],
    });
    const article = candidate({ kind: 'article', field: null, level: null, technologies: [], tags: [] });
    const exercise = candidate({ kind: 'exercise', field: null, level: null, technologies: [], tags: [] });

    expect(scoreCandidate(article, theory, 0).score).toBe(5);
    expect(scoreCandidate(exercise, theory, 0).score).toBe(0);
  });
});
