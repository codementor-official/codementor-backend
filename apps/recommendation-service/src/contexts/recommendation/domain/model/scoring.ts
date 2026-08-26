/**
 * Luật chấm điểm đề xuất. Hàm THUẦN — không import NestJS/Prisma, không đọc gì ngoài
 * tham số truyền vào, nên kiểm bằng unit test không cần dựng module hay CSDL.
 *
 * Trọng số và cách cộng điểm bê nguyên từ bản chạy tạm phía frontend
 * (`apps/client/src/lib/roadmap/recommendation.ts` và `lib/practice/practice-recommendation.ts`).
 * Giữ y hệt là có chủ đích: khi frontend đổi nguồn từ hàm cục bộ sang gọi service này,
 * thứ tự hiện ra trên dashboard không được nhảy loạn dưới chân người dùng.
 */

export type ItemKind = 'roadmap' | 'course' | 'exercise';

/** Cấu hình được — chỉnh mà không phải đụng vào phần logic cộng điểm. */
export const RECOMMENDATION_WEIGHTS = {
  field: 34,
  /**
   * Chủ đề đứng trên công nghệ và trình độ: nó đến từ việc học viên đã LÀM gì, còn hai cái
   * kia là thứ họ khai một lần lúc onboarding rồi hiếm khi ngó lại.
   */
  topic: 22,
  level: 20,
  technology: 20,
  careerGoal: 14,
  popularity: 12,
};

export type Weights = typeof RECOMMENDATION_WEIGHTS;

export interface LearnerPreferences {
  /** `current_level` trong `learning_preferences`. */
  currentLevel: string | null;
  careerGoal: string | null;
  /** theory | practice | project */
  contentPriority: string | null;
  /** Giá trị enum `roadmap_field` như CSDL lưu: `data_ai`, không phải `data-ai`. */
  interestedFields: string[];
  /** Nhãn tự do người dùng chọn lúc onboarding ("React", "C/C++"), KHÔNG phải slug. */
  interestedTechnologies: string[];
  adaptiveRecommendations: boolean;
  /** Đã hoàn thành onboarding chưa (`completed_at IS NOT NULL`). */
  completed: boolean;
}

/** Dấu vết học viên để lại trên một chủ đề, đếm từ `exercise_progress`. */
export interface TagAffinity {
  /** Số bài mang chủ đề này đã giải xong. */
  solved: number;
  /** Đã mở ra thử mà chưa giải được bài nào. */
  attempted: number;
}

/** Khóa là TÊN chủ đề — cùng từ vựng với `Candidate.tags`, và hiện thẳng lên thẻ được. */
export type TagAffinityMap = ReadonlyMap<string, TagAffinity>;

export interface ScoringOptions {
  weights?: Weights;
  affinity?: TagAffinityMap;
}

export interface Candidate {
  id: string;
  slug: string;
  title: string;
  kind: ItemKind;
  /** `roadmap_field`; course suy từ roadmap chứa nó, exercise không có. */
  field: string | null;
  /** `current_level` của roadmap/course. */
  level: string | null;
  /** easy | medium | hard — chỉ exercise. */
  difficulty: string | null;
  /**
   * Slug trong bảng `technologies`. Rỗng trên toàn bộ dữ liệu hiện tại — bảng đó chưa có
   * dòng nào, xem `titleTechMatch` để biết chỗ này bù bằng gì.
   */
  technologies: string[];
  /** Tên chủ đề (`exercise_tags`). Chỉ bài tập có; lộ trình và khóa học không gắn chủ đề. */
  tags: string[];
  /**
   * Tín hiệu phổ biến THÔ, mỗi loại một đơn vị khác nhau (số người ghi danh, số người
   * giải được). Chuẩn hóa về 0..100 bằng `normalizePopularity` trước khi chấm điểm.
   */
  popularityRaw: number;
}

export interface ScoredItem extends Candidate {
  score: number;
  reasons: string[];
}

const FIELD_LABELS: Record<string, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  fullstack: 'Fullstack',
  mobile: 'Mobile',
  data_ai: 'Data & AI',
  foundation: 'Nền tảng lập trình',
};

const LEVEL_LABELS: Record<string, string> = {
  none: 'chưa biết lập trình',
  basic: 'cơ bản',
  intermediate: 'trung cấp',
  experienced: 'đã có kinh nghiệm',
};

const LEVEL_ORDER = ['none', 'basic', 'intermediate', 'experienced'];

/** Bậc khó của bài tập quy về cùng thang với trình độ học viên, như bản frontend. */
const DIFFICULTY_LEVEL: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

const CAREER_GOAL_KEYWORDS: Record<string, string> = {
  'Web Developer': 'web',
  'Backend Developer': 'backend',
  'Mobile Developer': 'mobile',
  'Data/AI Engineer': 'data',
};

export const POPULAR_REASON = 'Phổ biến trên hệ thống';

const EMPTY_AFFINITY: TagAffinityMap = new Map();

function levelDistance(a: string, b: string): number {
  return Math.abs(LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b));
}

/**
 * Đưa một nhãn công nghệ về khóa so khớp.
 *
 * Onboarding lưu nhãn hiển thị ("C/C++", "C#/.NET", "Node.js") còn bảng `technologies`
 * lưu slug ('cpp', 'nodejs') — hai từ vựng khác nhau, không có khóa ngoại nối lại. Tách
 * theo '/' vì một nhãn có thể gộp hai công nghệ; '+' và '#' phải đổi thành chữ TRƯỚC khi
 * bỏ ký tự lạ, nếu không "C++" và "C#" đều rút gọn thành "c" và khớp bừa với nhau.
 *
 * ponytail: cách sửa tận gốc là cho onboarding chọn theo slug từ `GET /api/v1/technologies`;
 * lúc đó xóa hàm này và so khớp thẳng.
 */
export function techKeys(label: string): string[] {
  return label
    .split('/')
    .map((part) =>
      part
        .trim()
        .toLowerCase()
        .replace(/\+/g, 'p')
        .replace(/#/g, 'sharp')
        .replace(/[^a-z0-9]/g, ''),
    )
    .filter(Boolean);
}

/**
 * Nhãn công nghệ đầu tiên mà TIÊU ĐỀ nhắc tới, hoặc `null`.
 *
 * Đường vòng, và có lý do: bảng `technologies` đang rỗng nên `candidate.technologies` về
 * rỗng cho mọi thứ, tức cả nhánh khớp công nghệ là code chết trên dữ liệu thật. Tiêu đề là
 * chỗ duy nhất còn lại có tên công nghệ ("Nhập môn Node.js", "Python cơ bản").
 *
 * So khớp theo TỪ đã chuẩn hóa chứ không phải chuỗi con: `"django".includes("go")` là đúng
 * về chuỗi và sai về ý. Nhãn nhiều từ ("Spring Boot") chỉ tính là khớp khi mọi từ của nó
 * đều có mặt. Khóa dưới 2 ký tự bị bỏ — "C" trong "C/C++" khớp với quá nhiều thứ.
 */
export function titleTechMatch(title: string, labels: string[]): string | null {
  const tokens = new Set(title.split(/[^\p{L}\p{N}+#.]+/u).flatMap(techKeys));
  for (const label of labels) {
    const matched = label.split('/').some((variant) => {
      const words = variant.trim().split(/\s+/).flatMap(techKeys).filter((k) => k.length >= 2);
      return words.length > 0 && words.every((word) => tokens.has(word));
    });
    if (matched) return label;
  }
  return null;
}

/**
 * Chuẩn hóa tín hiệu phổ biến về 0..100 theo giá trị lớn nhất trong chính danh sách ứng
 * viên. Chia theo max của tập thay vì một hằng số cố định vì đơn vị mỗi loại một khác
 * (số ghi danh khóa học và số người giải bài tập không cùng thang), và vì hệ thống lúc mới
 * chạy có số rất nhỏ — chia cho hằng số sẽ khiến điểm phổ biến luôn xấp xỉ 0.
 */
export function normalizePopularity(candidates: Candidate[]): Map<string, number> {
  const max = candidates.reduce((peak, c) => Math.max(peak, c.popularityRaw), 0);
  return new Map(
    candidates.map((c) => [c.id, max > 0 ? (c.popularityRaw / max) * 100 : 0] as const),
  );
}

/**
 * Gộp chủ đề của bài VỪA nộp đạt vào bản đồ đã đọc từ CSDL.
 *
 * `exercise_progress` cập nhật qua sự kiện, không đồng bộ với response, nên lúc hộp thoại
 * chúc mừng hỏi bài kế tiếp thì bài vừa xong vẫn đang là "chưa đụng tới". Không gộp thì
 * gợi ý ngay sau đó nhìn ngược đời: chủ đề vừa chinh phục xong lại được chào là "bạn còn
 * dở dang". Đếm nó như một lần giải được — đúng chuyện vừa xảy ra.
 */
export function withJustSolved(affinity: TagAffinityMap, tags: string[]): TagAffinityMap {
  if (tags.length === 0) return affinity;
  const merged = new Map(affinity);
  for (const tag of tags) {
    const seen = merged.get(tag);
    merged.set(tag, {
      solved: (seen?.solved ?? 0) + 1,
      attempted: seen?.attempted ?? 0,
    });
  }
  return merged;
}

/**
 * Điểm khớp giữa một ứng viên và hồ sơ cá nhân hóa, kèm lý do hiện lên thẻ ngoài giao diện.
 *
 * `popularity` là giá trị đã chuẩn hóa 0..100 từ `normalizePopularity`.
 */
export function scoreCandidate(
  candidate: Candidate,
  preferences: LearnerPreferences,
  popularity: number,
  options: ScoringOptions = {},
): { score: number; reasons: string[] } {
  const weights = options.weights ?? RECOMMENDATION_WEIGHTS;
  const affinity = options.affinity ?? EMPTY_AFFINITY;
  let score = 0;
  const reasons: string[] = [];

  if (candidate.field && preferences.interestedFields.includes(candidate.field)) {
    score += weights.field;
    reasons.push(`Bạn đã chọn lĩnh vực ${FIELD_LABELS[candidate.field] ?? candidate.field}`);
  }

  if (preferences.currentLevel) {
    const learnerLevel = LEVEL_ORDER.indexOf(preferences.currentLevel);
    if (candidate.level) {
      const distance = levelDistance(preferences.currentLevel, candidate.level);
      if (distance === 0) {
        score += weights.level;
        reasons.push(
          `Phù hợp với trình độ ${LEVEL_LABELS[preferences.currentLevel] ?? preferences.currentLevel} của bạn`,
        );
      } else if (distance === 1) {
        score += weights.level * 0.5;
      }
    } else if (candidate.difficulty && learnerLevel >= 0) {
      const distance = Math.abs((DIFFICULTY_LEVEL[candidate.difficulty] ?? 1) - learnerLevel);
      if (distance === 0) {
        score += weights.level;
        reasons.push('Độ khó phù hợp với trình độ hiện tại');
      } else {
        // Trừ điểm, không phải cộng ít đi: một bài quá dễ hoặc quá khó phải TỤT xuống dưới
        // bài chưa biết gì về độ khó, chứ không chỉ hòa với nó.
        score -= distance * 5;
      }
    }
  }

  if (preferences.interestedTechnologies.length > 0) {
    const wanted = new Set(preferences.interestedTechnologies.flatMap(techKeys));
    const overlap = candidate.technologies.filter((slug) =>
      techKeys(slug).some((key) => wanted.has(key)),
    );
    if (overlap.length > 0) {
      score += weights.technology * (overlap.length / candidate.technologies.length);
      reasons.push(`Có công nghệ bạn quan tâm: ${overlap.join(', ')}`);
    } else if (candidate.technologies.length === 0) {
      // Không có gì gắn nhãn thì đoán từ tiêu đề, và ăn NỬA trọng số: đây là suy đoán từ
      // văn bản, không phải quan hệ đã khai báo, nên không được ngang hàng với nó.
      const mentioned = titleTechMatch(candidate.title, preferences.interestedTechnologies);
      if (mentioned) {
        score += weights.technology * 0.5;
        reasons.push(`Liên quan đến ${mentioned} bạn quan tâm`);
      }
    }
  }

  // Chủ đề đã đụng tới. Hai chiều, và chiều DỞ DANG thắng: một chủ đề học viên mở ra thử
  // rồi bỏ dở là chỗ họ đang mắc, đáng gợi hơn chủ đề họ đã giải trôi chảy. Chỉ khi không
  // có chủ đề dở dang nào thì mới gợi tiếp thứ họ đang luyện, và ăn ít điểm hơn — "cùng
  // chủ đề" là lý do yếu hơn "bạn đang mắc ở đây".
  if (candidate.tags.length > 0 && affinity.size > 0) {
    const stuck = candidate.tags.find((tag) => {
      const seen = affinity.get(tag);
      return seen !== undefined && seen.attempted > 0 && seen.solved === 0;
    });

    if (stuck) {
      score += weights.topic;
      reasons.push(`Bạn còn dở dang ở chủ đề ${stuck}`);
    } else {
      const familiar = candidate.tags.filter((tag) => (affinity.get(tag)?.solved ?? 0) > 0);
      if (familiar.length > 0) {
        score += weights.topic * 0.6 * (familiar.length / candidate.tags.length);
        reasons.push(`Cùng chủ đề ${familiar[0]} bạn đang luyện`);
      }
    }
  }

  const keyword = preferences.careerGoal
    ? CAREER_GOAL_KEYWORDS[preferences.careerGoal]
    : undefined;
  if (keyword && `${candidate.title} ${candidate.field ?? ''}`.toLowerCase().includes(keyword)) {
    score += weights.careerGoal;
    reasons.push(`Hướng đến mục tiêu nghề nghiệp "${preferences.careerGoal}" bạn đã chọn`);
  }

  // Ưu tiên nội dung: nhích nhẹ, không kèm lý do — nó là sở thích về DẠNG nội dung, không
  // phải một điểm khớp đáng khoe trên thẻ.
  if (preferences.contentPriority === 'practice' && candidate.kind === 'exercise') score += 5;
  if (preferences.contentPriority === 'theory' && candidate.kind === 'course') score += 5;

  // Luôn cộng một chút phổ biến để hai ứng viên hòa điểm ngã về phía cái đã được kiểm chứng.
  score += (popularity / 100) * weights.popularity;

  if (reasons.length === 0) reasons.push(POPULAR_REASON);

  return { score: Math.round(score), reasons };
}

/**
 * Xếp hạng cả danh sách.
 *
 * Rơi về xếp theo độ phổ biến khi học viên TẮT `adaptive_recommendations` hoặc chưa làm
 * onboarding — đó là lời hứa opt-out ở màn hình cá nhân hóa: tắt rồi thì không còn thứ gì
 * trong hồ sơ được dùng để sắp xếp nữa.
 */
export function rankCandidates(
  candidates: Candidate[],
  preferences: LearnerPreferences | null,
  options: ScoringOptions = {},
): ScoredItem[] {
  const popularity = normalizePopularity(candidates);
  const personalized = preferences !== null && preferences.adaptiveRecommendations && preferences.completed;

  return candidates
    .map((candidate) => {
      const popular = popularity.get(candidate.id) ?? 0;
      const result = personalized
        ? scoreCandidate(candidate, preferences, popular, options)
        : { score: Math.round(popular), reasons: [POPULAR_REASON] };
      return { ...candidate, ...result };
    })
    .sort((a, b) => b.score - a.score || b.popularityRaw - a.popularityRaw);
}

/** Hồ sơ có được dùng để cá nhân hóa không — controller trả cờ này ra cho frontend. */
export function isPersonalized(preferences: LearnerPreferences | null): boolean {
  return preferences !== null && preferences.adaptiveRecommendations && preferences.completed;
}
