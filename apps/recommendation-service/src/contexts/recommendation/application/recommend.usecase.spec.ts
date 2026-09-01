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
    expect(groups.items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('trả độ phổ biến đã chuẩn hóa để thẻ nhóm có gì mà hiện', async () => {
    const repository: CandidateRepository = {
      findPreferences: async () => null,
      findTagAffinity: async () => [],
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
