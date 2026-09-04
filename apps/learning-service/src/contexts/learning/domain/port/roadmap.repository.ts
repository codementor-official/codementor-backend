import type { ContentStatus, Roadmap } from '../model/roadmap';
import type { CatalogueTopic, CatalogueTopicSummary } from './catalogue-topic';

export interface RoadmapListFilter {
  createdBy: string | null;
  publishedOnly: boolean;
  /** Hàng chờ duyệt: mọi tác giả, chỉ `pending_review`, sắp cũ trước. */
  pendingOnly?: boolean;
  /** Trang quản trị: mọi tác giả, mọi trạng thái TRỪ `draft`, trừ khi có `status` ép cụ thể. */
  excludeDraft?: boolean;
  field?: string;
  level?: string;
  topicIds?: string[];
  status?: string;
  authorId?: string;
  updatedFrom?: Date;
  updatedTo?: Date;
  q?: string;
  limit: number;
  cursor?: { updatedAt: Date; id: string };
}

export interface RoadmapListItem {
  id: string;
  slug: string;
  title: string;
  shortDescription: string | null;
  coverImageUrl: string | null;
  field: string;
  level: string;
  status: string;
  estimatedHours: number | null;
  courseCount: number;
  createdBy: string | null;
  authorName: string | null;
  topics: CatalogueTopic[];
  /**
   * Tác giả đang XIN GỠ nội dung này và chờ admin quyết.
   *
   * Không phải một trạng thái riêng: nội dung vẫn `published` và học viên vẫn dùng bình
   * thường. Dấu hiệu là `published` + có `rejection_reason` — xem `removalRequested` ở
   * aggregate. Có mặt trong danh sách (không chỉ ở chi tiết) vì hàng chờ duyệt phải LỌC
   * ra được chúng: thiếu nó thì một yêu cầu xin gỡ chỉ tồn tại trong thông báo, và bấm
   * vào thông báo sẽ dẫn tới một màn hình không có gì.
   */
  removalRequested: boolean;
  updatedAt: Date;
}

/** Một khóa học trong lộ trình, kèm đủ thứ để dựng lại danh sách và tính tổng giờ. */
export interface RoadmapCourseItem {
  courseId: string;
  position: number;
  isOptional: boolean;
  title: string;
  slug: string;
  status: ContentStatus;
  durationHours: number | null;
}

export interface RoadmapCourseInput {
  courseId: string;
  isOptional: boolean;
}

export interface RoadmapRepository {
  findById(id: string): Promise<Roadmap | null>;
  existsBySlug(slug: string): Promise<boolean>;
  list(filter: RoadmapListFilter): Promise<RoadmapListItem[]>;
  listTopics(): Promise<CatalogueTopicSummary[]>;
  listCourses(roadmapId: string): Promise<RoadmapCourseItem[]>;
  /**
   * Ghi lại toàn bộ danh sách trong MỘT transaction.
   *
   * `UNIQUE(roadmap_id, position)` là DEFERRABLE nên hoán vị hai vị trí trong cùng
   * transaction chạy được; ghi từng dòng một thì đụng ràng buộc ngay ở lệnh đầu.
   */
  replaceCourses(roadmapId: string, courses: RoadmapCourseInput[]): Promise<void>;
  save(roadmap: Roadmap): Promise<void>;
  delete(id: string): Promise<void>;
}

export const ROADMAP_REPOSITORY = Symbol('ROADMAP_REPOSITORY');
