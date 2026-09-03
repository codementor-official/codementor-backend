import type { Candidate, LearnerPreferences } from './scoring';
import {
  POPULAR_REASON,
  RECOMMENDATION_WEIGHTS,
  SIMILARITY_REASON,
  buildIdf,
  buildProfileVector,
  candidateText,
  cosine,
  isPersonalized,
  normalizePopularity,
  rankCandidates,
  scoreCandidate,
  techKeys,
  titleTechMatch,
  tokenize,
  vectorize,
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

describe('quy bậc trình độ về thang độ khó', () => {
  const bare = { level: null, field: null, technologies: [], tags: [] };

  it('học viên đã có kinh nghiệm ăn TRỌN điểm trình độ ở bài khó', () => {
    const { score, reasons } = scoreCandidate(
      candidate({ kind: 'exercise', difficulty: 'hard', ...bare }),
      preferences({ currentLevel: 'experienced', interestedFields: [], interestedTechnologies: [] }),
      0,
    );

    expect(score).toBe(RECOMMENDATION_WEIGHTS.level);
    expect(reasons).toEqual(['Độ khó phù hợp với trình độ hiện tại']);
  });

  it('mỗi bậc trình độ đều có một độ khó khớp trọn điểm', () => {
    const matches: [string, string][] = [
      ['none', 'easy'],
      ['basic', 'easy'],
      ['intermediate', 'medium'],
      ['experienced', 'hard'],
    ];

    for (const [currentLevel, difficulty] of matches) {
      const { score } = scoreCandidate(
        candidate({ kind: 'exercise', difficulty, ...bare }),
        preferences({ currentLevel, interestedFields: [], interestedTechnologies: [] }),
        0,
      );
      expect([currentLevel, score]).toEqual([currentLevel, RECOMMENDATION_WEIGHTS.level]);
    }
  });
});

describe('khớp công nghệ', () => {
  it('ứng viên gắn nhãn kỹ không bị phạt so với ứng viên gắn đúng một nhãn', () => {
    const wanted = preferences({
      currentLevel: null,
      interestedFields: [],
      interestedTechnologies: ['Node.js'],
    });
    const focused = candidate({ field: null, level: null, technologies: ['nodejs'], tags: [] });
    const rich = candidate({
      field: null,
      level: null,
      technologies: ['nodejs', 'docker', 'redis', 'postgres', 'nginx'],
      tags: [],
    });

    expect(scoreCandidate(rich, wanted, 0).score).toBe(scoreCandidate(focused, wanted, 0).score);
    expect(scoreCandidate(rich, wanted, 0).score).toBe(RECOMMENDATION_WEIGHTS.technology);
  });
});

describe('isPersonalized', () => {
  it('có lịch sử là đủ để cá nhân hóa, kể cả khi chưa từng làm onboarding', () => {
    expect(isPersonalized(null, true)).toBe(true);
    expect(isPersonalized(preferences({ completed: false }), true)).toBe(true);
  });

  it('không hồ sơ và không lịch sử thì rơi về nội dung phổ biến', () => {
    expect(isPersonalized(null, false)).toBe(false);
    expect(isPersonalized(preferences({ completed: false }), false)).toBe(false);
  });

  it('tắt gợi ý thích ứng là opt-out tuyệt đối, lịch sử cũng không lật lại được', () => {
    expect(isPersonalized(preferences({ adaptiveRecommendations: false }), true)).toBe(false);
  });

  it('hồ sơ đã hoàn thành vẫn cá nhân hóa được khi chưa có lịch sử', () => {
    expect(isPersonalized(preferences(), false)).toBe(true);
  });
});

describe('content-based: TF-IDF + cosine', () => {
  it('tách được từ tiếng Việt có dấu — techKeys thì không', () => {
    expect(tokenize('Đệ quy và Quy hoạch động')).toEqual(['đệ', 'quy', 'và', 'quy', 'hoạch', 'động']);
    // techKeys bỏ mọi ký tự ngoài [a-z0-9] và không tách theo khoảng trắng: cả câu dính
    // thành một khối rụng hết dấu. Dùng nó để vector hóa là mất sạch tiếng Việt.
    expect(techKeys('Đệ quy hoạch động')).toEqual(['quyhochng']);
  });

  it('cosine bằng 1 với chính nó và 0 khi không chung token nào', () => {
    const idf = buildIdf(['quy hoạch động', 'đồ thị', 'con trỏ']);

    expect(cosine(vectorize('quy hoạch động', idf), vectorize('quy hoạch động', idf))).toBeCloseTo(1);
    expect(cosine(vectorize('quy hoạch động', idf), vectorize('con trỏ', idf))).toBe(0);
  });

  it('kéo nội dung gần lịch sử lên trên nội dung xa nó', () => {
    const near = candidate({ id: 'near', title: 'Quy hoạch động trên cây', ...{ field: null, level: null, technologies: [], tags: [] } });
    const far = candidate({ id: 'far', title: 'Cấu hình Nginx cho web tĩnh', ...{ field: null, level: null, technologies: [], tags: [] } });
    const neutralProfile = preferences({
      currentLevel: null,
      interestedFields: [],
      interestedTechnologies: [],
    });

    const ranked = rankCandidates([far, near], neutralProfile, {
      history: [{ text: 'Quy hoạch động cơ bản', weight: 1 }],
    });

    expect(ranked.map((item) => item.id)).toEqual(['near', 'far']);
    expect(ranked[0].reasons).toContain(SIMILARITY_REASON);
    expect(ranked[1].reasons).not.toContain(SIMILARITY_REASON);
  });

  it('lịch sử rỗng thì không cộng điểm tương đồng — xếp hạng thuần theo luật', () => {
    const item = candidate();

    const withoutHistory = rankCandidates([item], preferences(), { history: [] });
    const baseline = scoreCandidate(item, preferences(), 0);

    expect(withoutHistory[0].score).toBe(baseline.score);
    expect(withoutHistory[0].reasons).not.toContain(SIMILARITY_REASON);
  });

  it('mục lịch sử nặng hơn kéo hồ sơ về phía nó', () => {
    const idf = buildIdf(['quy hoạch động', 'đồ thị liên thông', 'con trỏ hàm']);
    const profile = buildProfileVector(
      [
        { text: 'quy hoạch động', weight: 1.5 },
        { text: 'con trỏ hàm', weight: 0.5 },
      ],
      idf,
    );

    expect(cosine(profile, vectorize('quy hoạch động', idf))).toBeGreaterThan(
      cosine(profile, vectorize('con trỏ hàm', idf)),
    );
  });

  it('văn bản ứng viên gom cả tiêu đề, chủ đề, lĩnh vực và công nghệ', () => {
    expect(candidateText(candidate({ tags: ['Đệ quy'] }))).toBe(
      'Backend với Node.js Đệ quy backend nodejs',
    );
  });
});

describe('chủ đề khớp hồ sơ khai (không cần lịch sử)', () => {
  // Bài viết như CSDL thật trả về: không lĩnh vực, không trình độ, không công nghệ —
  // chỉ có tên chủ đề.
  const article = (tags: string[], title = 'Bài viết nào đó') =>
    candidate({ kind: 'article', title, field: null, level: null, difficulty: null, technologies: [], tags });

  const fresh = (overrides: Partial<LearnerPreferences> = {}) =>
    preferences({ currentLevel: null, interestedFields: [], interestedTechnologies: [], ...overrides });

  it('khớp lĩnh vực đã khai với tên chủ đề khác từ vựng', () => {
    // enum `backend` ↔ chủ đề "Back-end": techKeys rút cả hai về "backend".
    const { score, reasons } = scoreCandidate(
      article(['Back-end']),
      fresh({ interestedFields: ['backend'] }),
      0,
    );

    expect(score).toBe(RECOMMENDATION_WEIGHTS.profileTopic);
    expect(reasons).toEqual(['Thuộc chủ đề Back-end bạn quan tâm']);
  });

  it('khớp cả nhãn công nghệ đã khai', () => {
    const { reasons } = scoreCandidate(
      article(['Tailwind CSS']),
      fresh({ interestedTechnologies: ['Tailwind CSS'] }),
      0,
    );

    expect(reasons).toEqual(['Thuộc chủ đề Tailwind CSS bạn quan tâm']);
  });

  it('chủ đề không liên quan thì không cộng gì', () => {
    const { score, reasons } = scoreCandidate(
      article(['Kiểm thử']),
      fresh({ interestedFields: ['backend'] }),
      0,
    );

    expect(score).toBe(0);
    expect(reasons).toEqual([POPULAR_REASON]);
  });

  it('không cộng hai lần cho ứng viên ĐÃ có lĩnh vực', () => {
    // Lộ trình có `field` nên đã ăn điểm ở nhánh lĩnh vực; chủ đề trùng tên không được
    // cộng thêm một lần nữa.
    const roadmap = candidate({
      field: 'backend',
      level: null,
      technologies: [],
      tags: ['Back-end'],
    });
    const { score } = scoreCandidate(roadmap, fresh({ interestedFields: ['backend'] }), 0);

    expect(score).toBe(RECOMMENDATION_WEIGHTS.field);
  });

  it('người mới xong onboarding xếp bài viết khác hẳn bảng phổ biến', () => {
    // Chính là ca người dùng báo: trước khi sửa, cả hai bài chỉ chấm theo độ phổ biến nên
    // bài phổ biến hơn luôn đứng trên, khai gì cũng vậy.
    const wanted = article(['Back-end'], 'Hiểu về index trong PostgreSQL');
    const popular = { ...article(['Kiểm thử'], 'Jira cho tester mới'), id: 'pop', popularityRaw: 50 };

    const ranked = rankCandidates(
      [popular, { ...wanted, id: 'want', popularityRaw: 1 }],
      fresh({ interestedFields: ['backend'] }),
    );

    expect(ranked[0].id).toBe('want');
  });
});
