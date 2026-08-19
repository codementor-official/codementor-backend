import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EVENT_BUS, type EventBus } from '@codementor/messaging';
import { TOPICS } from '@codementor/contracts';
import { AlreadyExists, BusinessRuleViolation, NotAuthorized, NotFound } from '@codementor/kernel';
import { DEFAULT_PAGE_LIMIT, canEditRoadmap, decodeCursor, requireHumanId, toPage, ContentAuthorLookup, type AuthenticatedUser, type Page } from '@codementor/platform';
import { Roadmap } from '../domain/model/roadmap';
import type { CurrentLevel, RoadmapEdit, RoadmapField } from '../domain/model/roadmap';
import {
  ROADMAP_REPOSITORY,
  type RoadmapCourseInput,
  type RoadmapListItem,
  type RoadmapRepository,
} from '../domain/port/roadmap.repository';
import { toRoadmapView, type RoadmapView } from './roadmap-view';

export interface ListRoadmapsQuery {
  field?: string;
  level?: string;
  status?: string;
  authorId?: string;
  updatedFrom?: string;
  updatedTo?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

/** Slug hoá tiêu đề. Bỏ dấu trước khi lọc, nếu không "Lộ trình" ra "tr". */
function slugify(title: string, suffix?: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  const stem = base.length >= 3 ? base : `lo-trinh-${Date.now().toString(36)}`;
  return suffix ? `${stem}-${suffix}` : stem;
}

/**
 * Gộp các thao tác của một aggregate vào một use case.
 *
 * Tám file mỗi file một phương thức ba dòng không làm rõ thêm điều gì; cái cần tách là
 * ranh giới aggregate, và ở đây chỉ có một.
 */
@Injectable()
export class RoadmapUseCases {
  private readonly logger = new Logger(RoadmapUseCases.name);

  constructor(
    @Inject(ROADMAP_REPOSITORY) private readonly roadmaps: RoadmapRepository,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
    private readonly authors: ContentAuthorLookup,
  ) {}

  async list(
    scope:
      | { createdBy: string }
      | { publishedOnly: true }
      | { pendingOnly: true }
      | { adminAll: true },
    query: ListRoadmapsQuery,
  ): Promise<Page<RoadmapListItem>> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_LIMIT, 1), 100);
    // Xem chú thích ở `ListExercisesUseCase`.
    const status = 'publishedOnly' in scope ? undefined : query.status;
    const rows = await this.roadmaps.list({
      createdBy: 'createdBy' in scope ? scope.createdBy : null,
      publishedOnly: 'publishedOnly' in scope,
      pendingOnly: 'pendingOnly' in scope && status === undefined,
      excludeDraft: 'adminAll' in scope,
      field: query.field,
      level: query.level,
      status,
      authorId: query.authorId,
      updatedFrom: query.updatedFrom ? new Date(query.updatedFrom) : undefined,
      updatedTo: query.updatedTo ? new Date(query.updatedTo) : undefined,
      q: query.q,
      limit,
      cursor: query.cursor ? (decodeCursor(query.cursor) ?? undefined) : undefined,
    });
    return toPage(rows, limit);
  }

  async get(user: AuthenticatedUser, id: string): Promise<RoadmapView> {
    const roadmap = await this.mustFind(id);
    // Lộ trình chưa công khai chỉ chủ nhân và admin thấy. 404 chứ không 403: trả 403 là
    // xác nhận nó tồn tại.
    if (roadmap.status !== 'published' && !canEditRoadmap(user, { created_by: roadmap.createdBy })) {
      throw new NotFound('Lộ trình', id);
    }
    return toRoadmapView(roadmap, await this.roadmaps.listCourses(id));
  }

  async create(
    user: AuthenticatedUser,
    input: { title: string; field: RoadmapField; level: CurrentLevel; slug?: string },
  ): Promise<RoadmapView> {
    const slug = await this.freeSlug(input.slug, input.title);
    const roadmap = Roadmap.create({
      id: randomUUID(),
      slug,
      title: input.title,
      field: input.field,
      level: input.level,
      createdBy: requireHumanId(user),
    });
    if (roadmap.isFail) throw roadmap.error;

    await this.roadmaps.save(roadmap.value);
    return toRoadmapView(roadmap.value, []);
  }

  async update(user: AuthenticatedUser, id: string, edit: RoadmapEdit): Promise<RoadmapView> {
    const roadmap = await this.mustOwn(user, id);

    // Kiểm trùng trước để ra 409 thay vì 23505 thô từ driver.
    if (edit.slug !== undefined && edit.slug !== roadmap.slug) {
      if (await this.roadmaps.existsBySlug(edit.slug)) {
        throw new AlreadyExists('Slug', { slug: edit.slug });
      }
    }

    const updated = roadmap.edit(edit);
    if (updated.isFail) throw updated.error;

    await this.roadmaps.save(roadmap);
    return toRoadmapView(roadmap, await this.roadmaps.listCourses(id));
  }

  /**
   * Ghi cả danh sách khóa học rồi tính lại tổng giờ.
   *
   * `estimated_hours` không có trigger nào giữ, nên nếu không tính ở đây thì con số
   * hiển thị đứng yên trong khi nội dung đã đổi.
   */
  async replaceCourses(
    user: AuthenticatedUser,
    id: string,
    courses: RoadmapCourseInput[],
  ): Promise<RoadmapView> {
    const roadmap = await this.mustOwn(user, id);
    if (roadmap.isLockedForReview) {
      throw new BusinessRuleViolation('Lộ trình đang chờ duyệt. Hủy gửi duyệt trước khi sửa.');
    }

    const seen = new Set<string>();
    for (const course of courses) {
      if (seen.has(course.courseId)) {
        throw new AlreadyExists('Khóa học trong lộ trình', { courseId: course.courseId });
      }
      seen.add(course.courseId);
    }

    await this.roadmaps.replaceCourses(id, courses);

    const saved = await this.roadmaps.listCourses(id);
    roadmap.recalculateEstimatedHours(saved.map((course) => course.durationHours));
    await this.roadmaps.save(roadmap);

    return toRoadmapView(roadmap, saved);
  }

  async submit(user: AuthenticatedUser, id: string): Promise<RoadmapView> {
    const roadmap = await this.mustOwn(user, id);
    const courses = await this.roadmaps.listCourses(id);

    const submitted = roadmap.submit(courses);
    if (submitted.isFail) throw submitted.error;

    await this.roadmaps.save(roadmap);
    // Gửi cho ADMIN: lộ trình vẫn là bản nháp, người học chưa có gì để xem.
    try {
      await this.eventBus.publish(TOPICS.CONTENT_REVIEW_REQUESTED, {
        kind: 'ROADMAP',
        contentId: roadmap.id,
        slug: roadmap.slug,
        title: roadmap.title,
        authorName: user.displayName,
      });
    } catch (error) {
      this.logger.error(
        `không phát được ${TOPICS.CONTENT_REVIEW_REQUESTED} cho ${roadmap.id}`,
        error as Error,
      );
    }
    return toRoadmapView(roadmap, courses);
  }

  async withdraw(user: AuthenticatedUser, id: string): Promise<RoadmapView> {
    const roadmap = await this.mustOwn(user, id);
    const withdrawn = roadmap.withdraw();
    if (withdrawn.isFail) throw withdrawn.error;

    await this.roadmaps.save(roadmap);
    return toRoadmapView(roadmap, await this.roadmaps.listCourses(id));
  }

  /** Tác giả tự gỡ lộ trình đang công khai của mình — xem chú thích cùng tên ở `CourseUseCases`. */
  async archiveMine(user: AuthenticatedUser, id: string): Promise<RoadmapView> {
    const roadmap = await this.mustOwn(user, id);
    const archived = roadmap.moderate('archive', null);
    if (archived.isFail) throw archived.error;

    await this.roadmaps.save(roadmap);
    return toRoadmapView(roadmap, await this.roadmaps.listCourses(id));
  }

  /** Tác giả tự khôi phục lộ trình đã gỡ của mình — về draft, đi lại vòng duyệt. */
  async restoreMine(user: AuthenticatedUser, id: string): Promise<RoadmapView> {
    const roadmap = await this.mustOwn(user, id);
    const restored = roadmap.moderate('restore', null);
    if (restored.isFail) throw restored.error;

    await this.roadmaps.save(roadmap);
    return toRoadmapView(roadmap, await this.roadmaps.listCourses(id));
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const roadmap = await this.mustOwn(user, id);
    if (!roadmap.isDeletable) {
      throw new BusinessRuleViolation(
        'Lộ trình đã công khai không xoá được. Dùng gỡ nội dung thay vì xoá.',
      );
    }
    await this.roadmaps.delete(id);
  }

  /**
   * Quyết định của admin. Kiểm vai trò lại ở đây dù controller đã có `@Roles('admin')`:
   * guard bảo vệ đường HTTP, use case là thứ mọi lối gọi khác cũng đi qua.
   */
  async moderate(
    user: AuthenticatedUser,
    id: string,
    decision: 'approve' | 'request_changes' | 'reject' | 'archive' | 'restore',
    reason: string | null,
  ) {
    if (user.role !== 'admin') throw new NotAuthorized('kiểm duyệt nội dung');

    const entity = await this.mustFind(id);
    const moderated = entity.moderate(decision, reason);
    if (moderated.isFail) throw moderated.error;

    await this.roadmaps.save(entity);

    // Chỉ `approve` mới là "lộ trình mới ra mắt" — xem ghi chú ở CourseUseCases.moderate.
    if (decision === 'approve') {
      try {
        await this.eventBus.publish(TOPICS.ROADMAP_PUBLISHED, {
          roadmapId: entity.id,
          slug: entity.slug,
          title: entity.title,
        });
      } catch (error) {
        this.logger.error(
          `không phát được ${TOPICS.ROADMAP_PUBLISHED} cho ${entity.id}`,
          error as Error,
        );
      }
    }
    await this.announceModerated(entity, decision, reason, user.displayName);
    return toRoadmapView(entity, await this.roadmaps.listCourses(id));
  }

  /** Báo riêng cho tác giả — xem ghi chú cùng tên ở `CourseUseCases`. */
  private async announceModerated(
    roadmap: Roadmap,
    decision: 'approve' | 'request_changes' | 'reject' | 'archive' | 'restore',
    reason: string | null,
    moderatorName: string,
  ): Promise<void> {
    if (decision === 'restore') return;
    const author = await this.authors.find(roadmap.createdBy);
    if (!author?.externalId) return;

    try {
      await this.eventBus.publish(TOPICS.CONTENT_MODERATED, {
        kind: 'ROADMAP',
        contentId: roadmap.id,
        slug: roadmap.slug,
        title: roadmap.title,
        decision,
        reason,
        authorExternalId: author.externalId,
        moderatorName,
      });
    } catch (error) {
      this.logger.error(
        `không phát được ${TOPICS.CONTENT_MODERATED} cho ${roadmap.id}`,
        error as Error,
      );
    }
  }

  private async mustFind(id: string): Promise<Roadmap> {
    const roadmap = await this.roadmaps.findById(id);
    if (roadmap === null) throw new NotFound('Lộ trình', id);
    return roadmap;
  }

  private async mustOwn(user: AuthenticatedUser, id: string): Promise<Roadmap> {
    const roadmap = await this.mustFind(id);
    if (!canEditRoadmap(user, { created_by: roadmap.createdBy })) {
      throw new NotAuthorized('thao tác trên lộ trình này');
    }
    return roadmap;
  }

  private async freeSlug(explicit: string | undefined, title: string): Promise<string> {
    if (explicit) {
      if (await this.roadmaps.existsBySlug(explicit)) {
        throw new AlreadyExists('Slug', { slug: explicit });
      }
      return explicit;
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = slugify(title, attempt === 0 ? undefined : Math.random().toString(36).slice(2, 7));
      if (!(await this.roadmaps.existsBySlug(candidate))) return candidate;
    }
    return slugify(title, randomUUID().slice(0, 8));
  }
}
