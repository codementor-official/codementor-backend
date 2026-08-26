import type { Candidate, LearnerPreferences } from './scoring';
import {
  POPULAR_REASON,
  isPersonalized,
  normalizePopularity,
  rankCandidates,
  scoreCandidate,
  techKeys,
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
    const { score, reasons } = scoreCandidate(
      candidate({ field: null, technologies: [] }),
      preferences({ currentLevel: 'basic' }),
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
