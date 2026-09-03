import { RecommendUseCase } from './recommend.usecase';
import type { CandidateRepository } from '../domain/port/candidate.repository';
import type { Candidate } from '../domain/model/scoring';

function candidate(id: string): Candidate {
  return {
    id,
    slug: `khoa-${id}`,
    title: `Khóa ${id}`,
    kind: 'course',
    field: 'backend',
    level: 'basic',
    difficulty: null,
    technologies: [],
    tags: [],
    popularityRaw: 10,
  };
}

/** Chỉ trả về ứng viên khi KHÔNG lọc — tức học viên đã ghi danh hết những gì đã xuất bản. */
function repositoryWithNothingFresh(calls: boolean[]): CandidateRepository {
  const list = async (_userId: string, excludeSeen: boolean) => {
    calls.push(excludeSeen);
    return excludeSeen ? [] : [candidate('a'), candidate('b')];
  };
  return {
    findPreferences: async () => null,
    findTagAffinity: async () => [],
    findHistoryProfile: async () => [],
    findExerciseTags: async () => [],
    findArticleTags: async () => [],
    listRoadmaps: list,
    listCourses: list,
    listExercises: list,
    listArticles: list,
    listGroups: list,
  };
}

describe('RecommendUseCase', () => {
  it.each([{ adaptiveRecommendations: false, completed: true }, { adaptiveRecommendations: false, completed: false }])(
    'does not read personal tag or content history after explicit opt-out: %s', async (settings) => {
      const repository = repositoryWithNothingFresh([]);
      repository.findPreferences = async () => settings ? {
        currentLevel: 'basic', careerGoal: null, contentPriority: null,
        interestedFields: [], interestedTechnologies: [], ...settings,
      } : null;
      const history = jest.fn(async () => [{ tag: 'Array', solved: 2, attempted: 1 }]);
      const exerciseTags = jest.fn(async () => ['Array']);
      const articleTags = jest.fn(async () => ['Array']);
      repository.findTagAffinity = history;
      const contentHistory = jest.fn(async () => [{ text: 'Array sorting', weight: 1 }]);
      repository.findHistoryProfile = contentHistory;
      repository.findExerciseTags = exerciseTags;
      repository.findArticleTags = articleTags;
      const usecase = new RecommendUseCase(repository);
      const results = await Promise.all([
        usecase.courses('user', 6), usecase.roadmaps('user', 6), usecase.exercises('user', 6),
        usecase.groups('user', 6), usecase.articles('user', 6),
        usecase.nextExercise('user', 'a'), usecase.relatedArticles('user', 'a', 6),
      ]);
      expect(results.every((result) => !result.personalized)).toBe(true);
      expect(history).not.toHaveBeenCalled();
      expect(contentHistory).not.toHaveBeenCalled();
      expect(exerciseTags).not.toHaveBeenCalled();
      expect(articleTags).not.toHaveBeenCalled();
    },
  );

  it.each([null, { adaptiveRecommendations: true, completed: false }])(
    'uses upstream content history without requiring completed onboarding: %s', async (settings) => {
      const repository = repositoryWithNothingFresh([]);
      repository.findPreferences = async () => settings ? {
        currentLevel: null, careerGoal: null, contentPriority: null,
        interestedFields: [], interestedTechnologies: [], ...settings,
      } : null;
      repository.findHistoryProfile = async () => [{ text: 'Khóa a backend', weight: 1 }];
      const result = await new RecommendUseCase(repository).courses('user', 6);
      expect(result.personalized).toBe(true);
    },
  );

  it('does not fall back to already joined groups', async () => {
    const calls: boolean[] = [];
    const result = await new RecommendUseCase(repositoryWithNothingFresh(calls)).groups('user', 6);
    expect(result.items).toEqual([]);
    expect(calls).toEqual([true]);
  });

  it('re-reads saved preferences per request; enabling/disabling changes ranking', async () => {
    const repository = repositoryWithNothingFresh([]);
    const matching = { ...candidate('matching'), popularityRaw: 1 };
    const popular = { ...candidate('popular'), field: 'frontend', level: 'experienced', popularityRaw: 100 };
    repository.listCourses = async () => [popular, matching];
    let enabled = true;
    repository.findPreferences = async () => ({ currentLevel: 'basic', careerGoal: null,
      contentPriority: null, interestedFields: ['backend'], interestedTechnologies: [],
      adaptiveRecommendations: enabled, completed: true });
    const usecase = new RecommendUseCase(repository);
    expect((await usecase.courses('user', 2)).items[0].id).toBe('matching');
    enabled = false;
    const result = await usecase.courses('user', 2);
    expect(result.personalized).toBe(false);
    expect(result.items[0].id).toBe('popular');
  });

  it('rơi về cả danh mục khi học viên đã đụng hết những gì đã xuất bản', async () => {
    const calls: boolean[] = [];
    const usecase = new RecommendUseCase(repositoryWithNothingFresh(calls));

    const result = await usecase.courses('user-1', 6);

    expect(calls).toEqual([true, false]);
    expect(result.items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('không truy vấn lần hai khi lượt lọc đã có ứng viên', async () => {
    const calls: boolean[] = [];
    const repository: CandidateRepository = {
      findPreferences: async () => null,
      findTagAffinity: async () => [],
      findHistoryProfile: async () => [],
      findExerciseTags: async () => [],
      findArticleTags: async () => [],
      listRoadmaps: async () => [],
      listCourses: async (_userId, excludeSeen) => {
        calls.push(excludeSeen);
        return [candidate('a')];
      },
      listExercises: async () => [],
      listArticles: async () => [],
      listGroups: async () => [],
    };

    await new RecommendUseCase(repository).courses('user-1', 6);

    expect(calls).toEqual([true]);
  });

  it('bài viết và nhóm đi qua đúng bộ luật xếp hạng đó', async () => {
    const calls: boolean[] = [];
    const usecase = new RecommendUseCase(repositoryWithNothingFresh(calls));

    const [articles, groups] = await Promise.all([
      usecase.articles('user-1', 6),
      usecase.groups('user-1', 6),
    ]);

    expect(articles.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(groups.items).toEqual([]);
  });

  it('trả độ phổ biến đã chuẩn hóa để thẻ nhóm có gì mà hiện', async () => {
    const repository: CandidateRepository = {
      findPreferences: async () => null,
      findTagAffinity: async () => [],
      findHistoryProfile: async () => [],
      findExerciseTags: async () => [],
      findArticleTags: async () => [],
      listRoadmaps: async () => [],
      listCourses: async () => [],
      listExercises: async () => [],
      listArticles: async () => [],
      listGroups: async () => [
        { ...candidate('a'), kind: 'group', popularityRaw: 40 },
        { ...candidate('b'), kind: 'group', popularityRaw: 10 },
      ],
    };

    const result = await new RecommendUseCase(repository).groups('user-1', 6);

    // Chuẩn hóa theo ứng viên đông nhất trong tập, không theo một hằng số nào.
    expect(result.items.map((item) => item.popularity)).toEqual([100, 25]);
  });

  it('bài viết liên quan bỏ chính bài đang đọc và đẩy bài cùng chủ đề lên trước', async () => {
    const reading = { ...candidate('đang-đọc'), kind: 'article' as const, tags: ['Đệ quy'] };
    const sameTopic = { ...candidate('cùng-chủ-đề'), kind: 'article' as const, tags: ['Đệ quy'] };
    const other = {
      ...candidate('khác'),
      kind: 'article' as const,
      tags: ['CSS'],
      // Phổ biến hơn hẳn — nếu chủ đề không được cộng điểm thì bài này đứng đầu.
      popularityRaw: 100,
    };
    const repository: CandidateRepository = {
      findPreferences: async () => ({
        currentLevel: null,
        careerGoal: null,
        contentPriority: null,
        interestedFields: [],
        interestedTechnologies: [],
        adaptiveRecommendations: true,
        completed: true,
      }),
      findTagAffinity: async () => [],
      findHistoryProfile: async () => [],
      findExerciseTags: async () => [],
      findArticleTags: async () => ['Đệ quy'],
      listRoadmaps: async () => [],
      listCourses: async () => [],
      listExercises: async () => [],
      listArticles: async () => [reading, sameTopic, other],
      listGroups: async () => [],
    };

    const result = await new RecommendUseCase(repository).relatedArticles('user-1', 'đang-đọc', 6);

    expect(result.items.map((item) => item.id)).toEqual(['cùng-chủ-đề', 'khác']);
    expect(result.items[0].reasons).toEqual(['Cùng chủ đề Đệ quy bạn đang luyện']);
  });

  it('bài viết liên quan không rơi ngược lại chính bài đang đọc khi danh mục chỉ có nó', async () => {
    const only = { ...candidate('một-mình'), kind: 'article' as const };
    const repository: CandidateRepository = {
      findPreferences: async () => null,
      findTagAffinity: async () => [],
      findHistoryProfile: async () => [],
      findExerciseTags: async () => [],
      findArticleTags: async () => [],
      listRoadmaps: async () => [],
      listCourses: async () => [],
      listExercises: async () => [],
      listArticles: async () => [only],
      listGroups: async () => [],
    };

    const result = await new RecommendUseCase(repository).relatedArticles('user-1', 'một-mình', 6);

    expect(result.items).toEqual([]);
  });
});
