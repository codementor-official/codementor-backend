/**
 * Luật chấm điểm đề xuất. Hàm THUẦN — không import NestJS/Prisma, không đọc gì ngoài
 * tham số truyền vào, nên kiểm bằng unit test không cần dựng module hay CSDL.
 *
 * Trọng số và cách cộng điểm bê nguyên từ bản chạy tạm phía frontend
 * (`apps/client/src/lib/roadmap/recommendation.ts` và `lib/practice/practice-recommendation.ts`).
 * Giữ y hệt là có chủ đích: khi frontend đổi nguồn từ hàm cục bộ sang gọi service này,
 * thứ tự hiện ra trên dashboard không được nhảy loạn dưới chân người dùng.
 */

export type ItemKind = 'roadmap' | 'course' | 'exercise' | 'article' | 'group';

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
  /**
   * Chủ đề khớp nhãn ĐÃ KHAI lúc onboarding. Khác `topic` ở chỗ nhánh kia cần lịch sử.
   *
   * Bài viết, nhóm học tập và bài tập không có `field` lẫn `technologies` — ba tín hiệu
   * nặng nhất (34 + 20 + 20) tắt sạch trên chúng. Chủ đề là metadata thật duy nhất chúng
   * có, mà trước đây chỉ chấm được khi học viên đã có lịch sử. Hệ quả: người vừa xong
   * onboarding nhận đúng bảng xếp theo độ phổ biến ở `/articles`, khai gì cũng như nhau.
   */
  profileTopic: 16,
  /**
   * Tương đồng văn bản với lịch sử học (TF-IDF + cosine). Đứng DƯỚI `topic`: chủ đề còn dở
   * dang là sự thật đã quan sát được, còn tương đồng từ vựng là suy diễn — nó bắt được thứ
   * `topic` bỏ lỡ (tên chủ đề khác nhau nhưng nội dung gần nhau), nên bổ sung chứ không thay.
   */
  similarity: 18,
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

/**
 * Một thứ học viên đã đụng tới, rút về dạng văn bản để vector hóa.
 *
 * Cố tình KHÔNG mang id hay loại: mô hình chỉ quan tâm nội dung, nên bài tập đã giải, khóa
 * đã ghi danh và bài viết đã lưu vào chung một hình dạng. `weight` là mức độ dấu vết đó nói
 * lên sở thích — xem `PrismaCandidateRepository.findHistoryProfile`.
 */
export interface HistoryDoc {
  text: string;
  weight: number;
}

/** Vector thưa TF-IDF đã chuẩn hóa L2. Khóa là token, giá trị là trọng số. */
export type TermVector = ReadonlyMap<string, number>;

export interface ScoringOptions {
  weights?: Weights;
  affinity?: TagAffinityMap;
  /** Hồ sơ TF-IDF của lịch sử học. Vắng hoặc rỗng ⇒ không có điểm tương đồng. */
  profile?: TermVector;
  /** IDF của tập ứng viên đang xếp hạng — phải cùng tập đã dùng để dựng `profile`. */
  idf?: ReadonlyMap<string, number>;
}

/**
 * Tùy chọn của `rankCandidates`: nhận lịch sử THÔ rồi tự dựng `profile`/`idf` một lần cho
 * cả tập, nên phía gọi không phải biết gì về vector.
 */
export interface RankOptions extends Omit<ScoringOptions, 'profile' | 'idf'> {
  /** Lịch sử học tập. Rỗng ⇒ xếp hạng thuần theo luật. */
  history?: HistoryDoc[];
}

export interface Candidate {
  id: string;
  slug: string;
  title: string;
  kind: ItemKind;
  /** `roadmap_field`; course suy từ roadmap chứa nó; exercise/article/group không có. */
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
  /**
   * Tên chủ đề, cùng từ vựng bảng `tags` cho bài tập (`exercise_tags`) và bài viết
   * (`articles.tag_id`) — nên `TagAffinityMap` đọc từ `exercise_progress` chấm được cả hai.
   * Lộ trình và khóa học gom chủ đề của thứ nằm bên trong. Nhóm học tập dùng `topic` tự do,
   * chỉ khớp khi tình cờ trùng tên chủ đề.
   */
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

const DIFFICULTY_LEVEL: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

/**
 * Trình độ học viên (4 bậc) quy về thang độ khó bài tập (3 bậc).
 *
 * Phải có bảng riêng chứ không lấy `LEVEL_ORDER.indexOf` so thẳng với `DIFFICULTY_LEVEL`:
 * hai thang khác độ dài, nên `experienced` (3) gặp `hard` (2) ra khoảng cách 1 và bị TRỪ
 * điểm — nhóm giỏi nhất không bài tập nào khớp nổi. `none` và `basic` cùng về `easy` vì
 * bài dễ là chỗ đúng cho cả hai.
 */
const LEVEL_TO_DIFFICULTY: Record<string, number> = {
  none: 0,
  basic: 0,
  intermediate: 1,
  experienced: 2,
};

const CAREER_GOAL_KEYWORDS: Record<string, string> = {
  'Web Developer': 'web',
  'Backend Developer': 'backend',
  'Mobile Developer': 'mobile',
  'Data/AI Engineer': 'data',
};

export const POPULAR_REASON = 'Phổ biến trên hệ thống';

const EMPTY_AFFINITY: TagAffinityMap = new Map();

/**
 * Hồ sơ trống, cho học viên được cá nhân hóa BẰNG LỊCH SỬ mà chưa từng khai gì lúc
 * onboarding. Mọi nhánh chấm theo nhãn khai đều tự tắt, chỉ còn chủ đề đã đụng và điểm
 * tương đồng — đúng những tín hiệu họ thực sự đã tạo ra.
 */
const NO_DECLARED_PREFERENCES: LearnerPreferences = {
  currentLevel: null,
  careerGoal: null,
  contentPriority: null,
  interestedFields: [],
  interestedTechnologies: [],
  adaptiveRecommendations: true,
  completed: false,
};

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

/* ------------------------------------------------------------------------------------- *
 * Content-based: mô hình không gian vector (TF-IDF + cosine)
 *
 * Vì sao là mô hình này chứ không phải lọc cộng tác: hệ không có bảng event log và
 * `exercise_progress` chỉ giữ ảnh chụp trạng thái, không giữ chuỗi hành vi — đó là nguyên
 * liệu của collaborative filtering. Content-based thì chỉ cần VĂN BẢN của nội dung và danh
 * sách thứ học viên đã đụng, cả hai đều có sẵn.
 *
 * Vì sao đáng làm khi đã có luật: luật so khớp CHÍNH XÁC tên chủ đề. Học viên vừa luyện
 * "Quy hoạch động cơ bản" không được luật kéo tới "Quy hoạch động trên cây" nếu hai bài gắn
 * hai tên chủ đề khác nhau; cosine trên token thì có. Điểm tương đồng CỘNG THÊM lên điểm
 * luật, không thay thế nó.
 *
 * ponytail: IDF tính trên chính tập ứng viên của request (≤ 200 tài liệu) chứ không trên
 * toàn catalog — không phải cache, không phải job nền, và đủ đúng vì tập này chính là thứ
 * đang được xếp hạng. Khi catalog lớn tới mức tập 200 không còn đại diện, dựng IDF một lần
 * cho cả catalog rồi nạp vào đây.
 * ------------------------------------------------------------------------------------- */

/** Bỏ token 1 ký tự: "C", "và", "ở" — nhiễu, và "C" thì khớp với quá nhiều thứ. */
const MIN_TOKEN_LENGTH = 2;

/** Dưới mức này thì cosine chỉ là nhiễu từ vựng, không đáng ghi thành lý do trên thẻ. */
const SIMILARITY_REASON_FLOOR = 0.15;

export const SIMILARITY_REASON = 'Gần với nội dung bạn đã học';

/**
 * Tách văn bản thành token để vector hóa.
 *
 * KHÔNG dùng lại `techKeys`: nó bỏ mọi ký tự ngoài `[a-z0-9]`, nên "đệ quy" rụng hết dấu
 * và thành chuỗi rỗng — tức là xóa sạch tiếng Việt, đúng thứ ngôn ngữ mà tiêu đề và tên
 * chủ đề ở đây đang dùng. `\p{L}` giữ nguyên chữ có dấu; `+` và `#` giữ lại để "C++" và
 * "C#" còn là token.
 *
 * ponytail: không tách từ ghép tiếng Việt ("quy hoạch động" thành ba token rời) và không
 * bỏ dấu để gộp biến thể. Nâng cấp khi đo được là thứ hạng sai vì chuyện này — cần một bộ
 * tách từ thật, không phải một regex dài hơn.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

/** Văn bản đại diện một ứng viên: mọi thứ mô tả nội dung của nó bằng chữ. */
export function candidateText(candidate: Candidate): string {
  return [candidate.title, ...candidate.tags, candidate.field ?? '', ...candidate.technologies]
    .join(' ')
    .trim();
}

/**
 * IDF trên một tập tài liệu: `log(1 + N / (1 + df))`.
 *
 * Cộng 1 vào mẫu số để token có mặt ở mọi tài liệu vẫn ra số dương thay vì 0 tuyệt đối —
 * trên tập 200 tài liệu, một token phổ biến vẫn nên nói được chút gì đó.
 */
export function buildIdf(documents: string[]): Map<string, number> {
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const token of new Set(tokenize(document))) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const total = documents.length;
  return new Map(
    [...documentFrequency].map(([token, df]) => [token, Math.log(1 + total / (1 + df))] as const),
  );
}

/** Chuẩn hóa L2 tại chỗ, để cosine chỉ còn là tích vô hướng. */
function normalizeL2(vector: Map<string, number>): Map<string, number> {
  let sumOfSquares = 0;
  for (const value of vector.values()) sumOfSquares += value * value;
  if (sumOfSquares === 0) return vector;
  const norm = Math.sqrt(sumOfSquares);
  for (const [token, value] of vector) vector.set(token, value / norm);
  return vector;
}

/** Vector TF-IDF của một đoạn văn bản. Token không có trong IDF bị bỏ — nó chưa từng xuất hiện trong tập đang xếp hạng nên không so sánh được với gì. */
export function vectorize(text: string, idf: ReadonlyMap<string, number>): TermVector {
  const vector = new Map<string, number>();
  for (const token of tokenize(text)) {
    const weight = idf.get(token);
    if (weight === undefined) continue;
    vector.set(token, (vector.get(token) ?? 0) + weight);
  }
  return normalizeL2(vector);
}

/**
 * Hồ sơ học viên: tổng có trọng số vector của những thứ họ đã đụng tới.
 *
 * Chỉ dựng từ LỊCH SỬ, không trộn nhãn đã khai lúc onboarding — nhãn khai đã có năm hạng
 * mục điểm riêng ở `scoreCandidate`, gộp vào đây là chấm hai lần cùng một tín hiệu. Nhờ
 * tách bạch vậy mà người chưa có lịch sử ra vector rỗng ⇒ cosine 0 ⇒ xếp hạng thuần theo
 * luật, đúng thứ mong đợi cho người vừa xong onboarding.
 */
export function buildProfileVector(
  history: HistoryDoc[],
  idf: ReadonlyMap<string, number>,
): TermVector {
  const profile = new Map<string, number>();
  for (const document of history) {
    for (const [token, value] of vectorize(document.text, idf)) {
      profile.set(token, (profile.get(token) ?? 0) + value * document.weight);
    }
  }
  return normalizeL2(profile);
}

/** Cosine của hai vector đã chuẩn hóa L2. Duyệt vector nhỏ hơn — cả hai đều thưa. */
export function cosine(a: TermVector, b: TermVector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [token, value] of small) dot += value * (large.get(token) ?? 0);
  return dot;
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
    const wantedDifficulty = LEVEL_TO_DIFFICULTY[preferences.currentLevel];
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
    } else if (candidate.difficulty && wantedDifficulty !== undefined) {
      const distance = Math.abs((DIFFICULTY_LEVEL[candidate.difficulty] ?? 1) - wantedDifficulty);
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
      // Trọn trọng số cho MỌI mức giao nhau. Chia cho số công nghệ của ứng viên là phạt
      // ngược thứ gắn nhãn kỹ: khóa gắn 5 công nghệ khớp 3 sẽ thua khóa gắn đúng 1 công
      // nghệ khớp 1. "Có thứ bạn quan tâm" là tín hiệu nhị phân; chuyện khớp nhiều hay ít
      // đã có điểm tương đồng TF-IDF chấm theo mức độ.
      score += weights.technology;
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

  // Chủ đề khớp nhãn đã khai. Chỉ chấm khi ứng viên KHÔNG có `field`, để không cộng hai
  // lần cùng một tín hiệu với nhánh lĩnh vực ở trên — lộ trình và khóa học có `field` nên
  // đã được chấm ở đó rồi; bài viết, nhóm và bài tập thì không, và đây là đường DUY NHẤT
  // để hồ sơ onboarding chạm tới chúng.
  //
  // So khớp qua `techKeys` nên cùng lúc bắt được cả hai từ vựng: tên chủ đề "Back-end" và
  // enum lĩnh vực `backend` đều rút về "backend"; nhãn công nghệ "Tailwind CSS" và chủ đề
  // cùng tên đều rút về "tailwindcss".
  if (candidate.field === null && candidate.tags.length > 0) {
    const declared = new Set(
      [...preferences.interestedFields, ...preferences.interestedTechnologies].flatMap(techKeys),
    );
    const matched = candidate.tags.find((tag) =>
      techKeys(tag).some((key) => declared.has(key)),
    );
    if (matched) {
      score += weights.profileTopic;
      reasons.push(`Thuộc chủ đề ${matched} bạn quan tâm`);
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

  // Content-based: gần tới đâu với những gì học viên đã học. Cộng THÊM lên điểm luật ở
  // trên, không thay thế — luật biết thứ học viên KHAI, cosine biết thứ họ đã LÀM.
  if (options.profile && options.profile.size > 0 && options.idf) {
    const similarity = cosine(options.profile, vectorize(candidateText(candidate), options.idf));
    score += weights.similarity * similarity;
    if (similarity >= SIMILARITY_REASON_FLOOR) reasons.push(SIMILARITY_REASON);
  }

  // Ưu tiên nội dung: nhích nhẹ, không kèm lý do — nó là sở thích về DẠNG nội dung, không
  // phải một điểm khớp đáng khoe trên thẻ.
  if (preferences.contentPriority === 'practice' && candidate.kind === 'exercise') score += 5;
  // Bài viết đi cùng khóa học ở nhánh `theory`: cả hai là đọc/xem, không phải gõ code.
  if (
    preferences.contentPriority === 'theory' &&
    (candidate.kind === 'course' || candidate.kind === 'article')
  )
    score += 5;

  // Luôn cộng một chút phổ biến để hai ứng viên hòa điểm ngã về phía cái đã được kiểm chứng.
  score += (popularity / 100) * weights.popularity;

  if (reasons.length === 0) reasons.push(POPULAR_REASON);

  return { score: Math.round(score), reasons };
}

/**
 * Xếp hạng cả danh sách.
 *
 * Rơi về xếp theo độ phổ biến khi không có tín hiệu nào dùng được — xem `isPersonalized`.
 */
export function rankCandidates(
  candidates: Candidate[],
  preferences: LearnerPreferences | null,
  options: RankOptions = {},
): ScoredItem[] {
  const popularity = normalizePopularity(candidates);
  const history = options.history ?? [];
  const personalized = isPersonalized(preferences, hasLearningHistory(options.affinity, history));

  // Dựng IDF và hồ sơ một lần cho cả tập, không phải mỗi ứng viên một lần. Bỏ hẳn khi
  // không cá nhân hóa: lúc đó chấm điểm không đụng tới vector nào.
  const idf = personalized && history.length > 0 ? buildIdf(candidates.map(candidateText)) : null;
  const profile = idf ? buildProfileVector(history, idf) : null;

  return candidates
    .map((candidate) => {
      const popular = popularity.get(candidate.id) ?? 0;
      const result = personalized
        ? scoreCandidate(candidate, preferences ?? NO_DECLARED_PREFERENCES, popular, {
            ...options,
            profile: profile ?? undefined,
            idf: idf ?? undefined,
          })
        : { score: Math.round(popular), reasons: [POPULAR_REASON] };
      return { ...candidate, ...result };
    })
    .sort((a, b) => b.score - a.score || b.popularityRaw - a.popularityRaw);
}

/** Học viên đã để lại dấu vết học tập nào chưa — chủ đề đã đụng, hoặc nội dung đã học. */
export function hasLearningHistory(
  affinity: TagAffinityMap | undefined,
  history: HistoryDoc[] | undefined,
): boolean {
  return (affinity?.size ?? 0) > 0 || (history?.length ?? 0) > 0;
}

/**
 * Hồ sơ có được dùng để cá nhân hóa không — controller trả cờ này ra cho frontend.
 *
 * Ba nhánh, theo đúng thứ tự ưu tiên:
 *
 * 1. `adaptive_recommendations = false` là opt-out TUYỆT ĐỐI. Học viên tắt ở màn hình cá
 *    nhân hóa thì không tín hiệu nào của họ được dùng để sắp xếp, kể cả lịch sử.
 * 2. Có lịch sử học ⇒ cá nhân hóa, kể cả khi chưa từng làm onboarding. Người bỏ qua khảo
 *    sát nhưng đã giải hàng chục bài vẫn đang nói cho hệ thống biết họ quan tâm gì; trước
 *    đây nhánh này đòi `completed` nên ném hết dấu vết đó đi và trả về bảng phổ biến trơn.
 * 3. Không lịch sử: chỉ còn hồ sơ khai lúc onboarding, và nó phải đã hoàn thành.
 *
 * Không dính nhánh nào ⇒ `false` ⇒ rơi về nội dung phổ biến.
 */
export function isPersonalized(
  preferences: LearnerPreferences | null,
  hasHistory = false,
): boolean {
  if (preferences !== null && !preferences.adaptiveRecommendations) return false;
  if (hasHistory) return true;
  return preferences !== null && preferences.completed;
}
