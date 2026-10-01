import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser, requireHumanId } from '@codementor/platform';
import { CommerceStore, lock, audit } from '../infrastructure/commerce.store';
import { notifyCommerce } from '../infrastructure/commerce-notification';

type PricingRow = {
  course_id: string;
  list_price: number;
  pending_price: number | null;
  sale_price: number | null;
  promotion_label: string | null;
  promotion_starts_at: Date | null;
  promotion_ends_at: Date | null;
  promotion_active: boolean | null;
  effective_price: number;
};

type PromotionRequestRow = {
  request_id: string | null;
  request_action: 'upsert' | 'remove' | null;
  request_sale_price: number | null;
  request_label: string | null;
  request_starts_at: Date | null;
  request_ends_at: Date | null;
  request_active: boolean | null;
  request_status: 'pending' | 'approved' | 'rejected' | 'cancelled' | null;
  request_reason: string | null;
  request_created_at: Date | null;
  request_updated_at: Date | null;
};

function promotionRequest(row: PromotionRequestRow) {
  if (!row.request_id || !row.request_action || !row.request_status) return null;
  return {
    id: row.request_id,
    action: row.request_action,
    salePriceVnd: row.request_sale_price,
    label: row.request_label,
    startsAt: row.request_starts_at?.toISOString() ?? null,
    endsAt: row.request_ends_at?.toISOString() ?? null,
    isActive: row.request_active,
    status: row.request_status,
    reviewReason: row.request_reason,
    createdAt: row.request_created_at?.toISOString() ?? null,
    updatedAt: row.request_updated_at?.toISOString() ?? null,
  };
}

function pricing(row: PricingRow) {
  const discount = row.list_price > 0 && row.effective_price < row.list_price
    ? Math.round(((row.list_price - row.effective_price) / row.list_price) * 100)
    : 0;
  return {
    priceVnd: row.effective_price,
    listPriceVnd: row.list_price,
    salePriceVnd: row.sale_price,
    savingsVnd: discount ? row.list_price - row.effective_price : 0,
    discountPercent: discount,
    promotion: row.promotion_label
      ? {
          label: row.promotion_label,
          startsAt: row.promotion_starts_at?.toISOString() ?? null,
          endsAt: row.promotion_ends_at?.toISOString() ?? null,
          isActive: Boolean(row.promotion_active),
        }
      : null,
  };
}

@Injectable()
export class CommerceAccessService {
  constructor(private readonly store: CommerceStore) {}
  async offers(ids: string[], includePending = false) {
    if (!ids.length) return new Map<string, ReturnType<typeof pricing>>();
    const rows = await this.store.db.$queryRaw<
      PricingRow[]
    >(Prisma.sql`
      SELECT p.course_id,p.price_vnd AS list_price,p.pending_price_vnd AS pending_price,
        pr.sale_price_vnd AS sale_price,
        pr.label AS promotion_label,pr.starts_at AS promotion_starts_at,
        pr.ends_at AS promotion_ends_at,pr.is_active AS promotion_active,
        CASE WHEN pr.is_active AND now() >= pr.starts_at AND now() < pr.ends_at
          AND pr.sale_price_vnd < p.price_vnd THEN pr.sale_price_vnd ELSE p.price_vnd END AS effective_price
      FROM course_prices p LEFT JOIN course_promotions pr ON pr.course_id=p.course_id
      WHERE p.course_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`);
    return new Map(rows.map((r) => [
      r.course_id,
      {
        ...pricing(r),
        ...(includePending ? { pendingPriceVnd: r.pending_price } : {}),
      },
    ]));
  }
  async offer(userId: string, courseId: string, admin = false) {
    const [row] = await this.store.db.$queryRaw<
      (PricingRow & { owned: boolean; can_manage: boolean })[]
    >`
      SELECT c.id AS course_id,COALESCE(p.price_vnd,0) AS list_price,
        p.pending_price_vnd AS pending_price,
        pr.sale_price_vnd AS sale_price,pr.label AS promotion_label,
        pr.starts_at AS promotion_starts_at,pr.ends_at AS promotion_ends_at,
        pr.is_active AS promotion_active,
        CASE WHEN pr.is_active AND now() >= pr.starts_at AND now() < pr.ends_at
          AND pr.sale_price_vnd < COALESCE(p.price_vnd,0) THEN pr.sale_price_vnd
          ELSE COALESCE(p.price_vnd,0) END AS effective_price,
        EXISTS(SELECT 1 FROM course_access_grants g
        WHERE g.course_id=c.id AND g.user_id=${userId}::uuid AND g.revoked_at IS NULL) AS owned
        ,(c.created_by=${userId}::uuid OR ${admin}) AS can_manage
      FROM courses c LEFT JOIN course_prices p ON p.course_id=c.id
      LEFT JOIN course_promotions pr ON pr.course_id=c.id
      WHERE c.id=${courseId}::uuid AND (c.status='published' OR c.created_by=${userId}::uuid OR ${admin})`;
    if (!row) throw new NotFoundException('Không tìm thấy khóa học');
    return {
      ...pricing(row),
      pendingPriceVnd: row.can_manage ? row.pending_price : null,
      pricingType: row.effective_price ? 'paid' : 'free',
      owned: row.owned,
      currency: 'VND',
    };
  }
  async setPrice(user: AuthenticatedUser, courseId: string, price: number) {
    return this.store.transaction(async (tx) => {
      await lock(tx, `course:${courseId}`);
      const [course] = await tx.$queryRaw<
        { created_by: string; status: string }[]
      >`SELECT created_by,status::text FROM courses WHERE id=${courseId}::uuid FOR UPDATE`;
      if (!course) throw new NotFoundException('Không tìm thấy khóa học');
      if (course.created_by !== requireHumanId(user) && user.role !== 'admin')
        throw new ForbiddenException();
      if (!['draft', 'changes_requested', 'rejected', 'published'].includes(course.status))
        throw new ConflictException(
          'Khóa học đang chờ duyệt nên chưa thể sửa giá. Hủy gửi duyệt trước khi chỉnh sửa.',
        );
      if (course.status === 'published') {
        const [current] = await tx.$queryRaw<{ price_vnd: number }[]>`
          SELECT price_vnd FROM course_prices WHERE course_id=${courseId}::uuid`;
        await tx.$executeRaw`
          INSERT INTO course_prices(course_id,price_vnd,pending_price_vnd,pending_price_requested_at)
          VALUES (${courseId}::uuid,0,${price},now())
          ON CONFLICT(course_id) DO UPDATE SET pending_price_vnd=EXCLUDED.pending_price_vnd,
            pending_price_requested_at=now(),updated_at=now()`;
        await audit(tx, 'course.price.requested', courseId, requireHumanId(user), {
          currentPriceVnd: current?.price_vnd ?? 0,
          requestedPriceVnd: price,
        });
        return {
          priceVnd: current?.price_vnd ?? 0,
          pendingPriceVnd: price,
          requiresReview: true,
        };
      }
      await tx.$executeRaw`INSERT INTO course_prices(course_id,price_vnd) VALUES (${courseId}::uuid,${price})
        ON CONFLICT(course_id) DO UPDATE SET price_vnd=EXCLUDED.price_vnd,
          pending_price_vnd=NULL,pending_price_requested_at=NULL,updated_at=now()`;
      await tx.$executeRaw`DELETE FROM course_promotions WHERE course_id=${courseId}::uuid
        AND (${price}=0 OR sale_price_vnd>=${price})`;
      await tx.$executeRaw`UPDATE course_promotion_requests
        SET status='cancelled',review_reason='Giá niêm yết đã thay đổi; vui lòng gửi lại đề xuất.',updated_at=now()
        WHERE course_id=${courseId}::uuid AND status='pending'
          AND (${price}=0 OR action='upsert' AND sale_price_vnd>=${price})`;
      await audit(tx, 'course.price', courseId, requireHumanId(user), { priceVnd: price });
      return { priceVnd: price, pendingPriceVnd: null, requiresReview: false };
    });
  }

  async applyApprovedPrice(courseId: string, adminId: string) {
    return this.store.transaction(async (tx) => {
      await lock(tx, `course:${courseId}`);
      const [row] = await tx.$queryRaw<
        { price_vnd: number; pending_price_vnd: number | null }[]
      >`SELECT price_vnd,pending_price_vnd FROM course_prices
        WHERE course_id=${courseId}::uuid FOR UPDATE`;
      if (!row || row.pending_price_vnd === null) return { applied: false };
      const next = row.pending_price_vnd;
      await tx.$executeRaw`UPDATE course_prices SET price_vnd=${next},pending_price_vnd=NULL,
        pending_price_requested_at=NULL,updated_at=now() WHERE course_id=${courseId}::uuid`;
      await tx.$executeRaw`DELETE FROM course_promotions WHERE course_id=${courseId}::uuid
        AND (${next}=0 OR sale_price_vnd>=${next})`;
      await tx.$executeRaw`UPDATE course_promotion_requests
        SET status='cancelled',review_reason='Giá niêm yết đã được duyệt; vui lòng gửi lại đề xuất.',updated_at=now()
        WHERE course_id=${courseId}::uuid AND status='pending'
          AND (${next}=0 OR action='upsert' AND sale_price_vnd>=${next})`;
      await audit(tx, 'course.price.approved', courseId, adminId, {
        previousPriceVnd: row.price_vnd,
        priceVnd: next,
      });
      return { applied: true, priceVnd: next };
    });
  }
  async promotions(userId: string, admin: boolean) {
    const rows = await this.store.db.$queryRaw<
      (PricingRow & PromotionRequestRow & {
        title: string;
        cover_image_url: string | null;
        status: string;
        author_name: string | null;
      })[]
    >`
      SELECT c.id AS course_id,c.title,c.cover_image_url,c.status::text,
        u.display_name AS author_name,p.price_vnd AS list_price,
        pr.sale_price_vnd AS sale_price,pr.label AS promotion_label,
        pr.starts_at AS promotion_starts_at,pr.ends_at AS promotion_ends_at,
        pr.is_active AS promotion_active,
        req.id AS request_id,req.action AS request_action,
        req.sale_price_vnd AS request_sale_price,req.label AS request_label,
        req.starts_at AS request_starts_at,req.ends_at AS request_ends_at,
        req.requested_active AS request_active,req.status AS request_status,
        req.review_reason AS request_reason,req.created_at AS request_created_at,
        req.updated_at AS request_updated_at,
        CASE WHEN pr.is_active AND now() >= pr.starts_at AND now() < pr.ends_at
          AND pr.sale_price_vnd < p.price_vnd THEN pr.sale_price_vnd ELSE p.price_vnd END AS effective_price
      FROM courses c JOIN course_prices p ON p.course_id=c.id
      LEFT JOIN course_promotions pr ON pr.course_id=c.id
      LEFT JOIN LATERAL (
        SELECT * FROM course_promotion_requests r
        WHERE r.course_id=c.id
        ORDER BY (r.status='pending') DESC,r.updated_at DESC,r.id DESC
        LIMIT 1
      ) req ON true
      LEFT JOIN users u ON u.id=c.created_by
      WHERE p.price_vnd>0 AND (${admin} OR c.created_by=${userId}::uuid)
      ORDER BY (pr.course_id IS NOT NULL) DESC,c.updated_at DESC,c.id DESC
      LIMIT 200`;
    return rows.map((row) => ({
      courseId: row.course_id,
      title: row.title,
      coverImageUrl: row.cover_image_url,
      status: row.status,
      authorName: row.author_name,
      ...pricing(row),
      promotionRequest: promotionRequest(row),
    }));
  }
  async setPromotion(
    user: AuthenticatedUser,
    courseId: string,
    input: {
      salePriceVnd: number;
      label: string;
      startsAt: string;
      endsAt: string;
      isActive: boolean;
    },
  ) {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (endsAt <= startsAt)
      throw new ConflictException('Thời gian kết thúc phải sau thời gian bắt đầu.');
    return this.store.transaction(async (tx) => {
      await lock(tx, `course:${courseId}`);
      const [course] = await tx.$queryRaw<
        { created_by: string; price_vnd: number }[]
      >`SELECT c.created_by,p.price_vnd FROM courses c JOIN course_prices p ON p.course_id=c.id
        WHERE c.id=${courseId}::uuid FOR UPDATE`;
      if (!course) throw new NotFoundException('Khóa học chưa có giá bán');
      if (course.created_by !== requireHumanId(user) && user.role !== 'admin')
        throw new ForbiddenException();
      if (course.price_vnd <= 0)
        throw new ConflictException('Khóa học miễn phí không cần tạo khuyến mãi.');
      if (input.salePriceVnd >= course.price_vnd)
        throw new ConflictException('Giá ưu đãi phải thấp hơn giá niêm yết.');
      const actorId = requireHumanId(user);
      if (user.role === 'admin') {
        await tx.$executeRaw`
          INSERT INTO course_promotions(course_id,sale_price_vnd,label,starts_at,ends_at,is_active,created_by)
          VALUES (${courseId}::uuid,${input.salePriceVnd},${input.label.trim()},${startsAt},${endsAt},${input.isActive},${actorId}::uuid)
          ON CONFLICT(course_id) DO UPDATE SET sale_price_vnd=EXCLUDED.sale_price_vnd,
            label=EXCLUDED.label,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,
            is_active=EXCLUDED.is_active,updated_at=now()`;
        await tx.$executeRaw`UPDATE course_promotion_requests
          SET status='cancelled',review_reason='Admin đã cập nhật trực tiếp cấu hình khuyến mãi.',
            reviewed_by=${actorId}::uuid,reviewed_at=now(),updated_at=now()
          WHERE course_id=${courseId}::uuid AND status='pending'`;
        await audit(tx, 'course.promotion.updated', courseId, actorId, input);
        return { updated: true, status: 'approved' };
      }
      const [request] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO course_promotion_requests(
          course_id,action,sale_price_vnd,label,starts_at,ends_at,requested_active,status,requested_by
        ) VALUES (
          ${courseId}::uuid,'upsert',${input.salePriceVnd},${input.label.trim()},${startsAt},${endsAt},${input.isActive},'pending',${actorId}::uuid
        )
        ON CONFLICT(course_id) WHERE status='pending' DO UPDATE SET
          action='upsert',sale_price_vnd=EXCLUDED.sale_price_vnd,label=EXCLUDED.label,
          starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,
          requested_active=EXCLUDED.requested_active,requested_by=EXCLUDED.requested_by,
          review_reason=NULL,reviewed_by=NULL,reviewed_at=NULL,updated_at=now()
        RETURNING id`;
      await audit(tx, 'course.promotion.requested', request.id, actorId, { courseId, ...input });
      const admins = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE role='admin'::platform_role`;
      for (const admin of admins) {
        await notifyCommerce(
          tx,
          admin.id,
          request.id,
          'Có đề xuất khuyến mãi mới',
          `Giảng viên đã gửi khuyến mãi cho khóa học cần duyệt.`,
          '/promotions',
        );
      }
      return { submittedForReview: true, requestId: request.id, status: 'pending' };
    });
  }
  async removePromotion(user: AuthenticatedUser, courseId: string) {
    return this.store.transaction(async (tx) => {
      await lock(tx, `course:${courseId}`);
      const [course] = await tx.$queryRaw<{ created_by: string }[]>`
        SELECT created_by FROM courses WHERE id=${courseId}::uuid FOR UPDATE`;
      if (!course) throw new NotFoundException('Không tìm thấy khóa học');
      if (course.created_by !== requireHumanId(user) && user.role !== 'admin')
        throw new ForbiddenException();
      const actorId = requireHumanId(user);
      if (user.role === 'admin') {
        await tx.$executeRaw`DELETE FROM course_promotions WHERE course_id=${courseId}::uuid`;
        await tx.$executeRaw`UPDATE course_promotion_requests
          SET status='cancelled',review_reason='Admin đã gỡ trực tiếp khuyến mãi.',
            reviewed_by=${actorId}::uuid,reviewed_at=now(),updated_at=now()
          WHERE course_id=${courseId}::uuid AND status='pending'`;
        await audit(tx, 'course.promotion.removed', courseId, actorId);
        return { removed: true };
      }
      const approved = await tx.$queryRaw<{ course_id: string }[]>`
        SELECT course_id FROM course_promotions WHERE course_id=${courseId}::uuid`;
      if (!approved.length) {
        await tx.$executeRaw`UPDATE course_promotion_requests SET status='cancelled',updated_at=now()
          WHERE course_id=${courseId}::uuid AND status='pending' AND requested_by=${actorId}::uuid`;
        await audit(tx, 'course.promotion.request.cancelled', courseId, actorId);
        return { cancelled: true };
      }
      const [request] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO course_promotion_requests(course_id,action,status,requested_by)
        VALUES (${courseId}::uuid,'remove','pending',${actorId}::uuid)
        ON CONFLICT(course_id) WHERE status='pending' DO UPDATE SET
          action='remove',sale_price_vnd=NULL,label=NULL,starts_at=NULL,ends_at=NULL,
          requested_active=NULL,requested_by=EXCLUDED.requested_by,
          review_reason=NULL,reviewed_by=NULL,reviewed_at=NULL,updated_at=now()
        RETURNING id`;
      await audit(tx, 'course.promotion.removal.requested', request.id, actorId, { courseId });
      const admins = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE role='admin'::platform_role`;
      for (const admin of admins) {
        await notifyCommerce(
          tx,
          admin.id,
          request.id,
          'Có đề xuất gỡ khuyến mãi',
          'Giảng viên đã gửi yêu cầu gỡ khuyến mãi khóa học.',
          '/promotions',
        );
      }
      return { submittedForReview: true, requestId: request.id, status: 'pending' };
    });
  }

  async setPromotionsBatch(
    user: AuthenticatedUser,
    input: {
      courseIds: string[];
      discountPercent: number;
      label: string;
      startsAt: string;
      endsAt: string;
      isActive: boolean;
    },
  ) {
    if (user.role !== 'admin') throw new ForbiddenException();
    const courseIds = [...new Set(input.courseIds)];
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (endsAt <= startsAt)
      throw new ConflictException('Thời gian kết thúc phải sau thời gian bắt đầu.');
    const actorId = requireHumanId(user);
    return this.store.transaction(async (tx) => {
      const courses = await tx.$queryRaw<{ id: string; price_vnd: number }[]>(Prisma.sql`
        SELECT c.id,p.price_vnd FROM courses c
        JOIN course_prices p ON p.course_id=c.id
        WHERE c.id IN (${Prisma.join(courseIds.map((id) => Prisma.sql`${id}::uuid`))})
        ORDER BY c.id FOR UPDATE`);
      if (courses.length !== courseIds.length)
        throw new NotFoundException('Một hoặc nhiều khóa học không tồn tại hoặc chưa có giá bán.');
      if (courses.some((course) => course.price_vnd <= 1000))
        throw new ConflictException('Chỉ có thể áp dụng theo lô cho khóa học trả phí trên 1.000 ₫.');
      for (const course of courses) {
        const salePrice = Math.max(
          1000,
          Math.floor((course.price_vnd * (100 - input.discountPercent)) / 100_000) * 1000,
        );
        if (salePrice >= course.price_vnd)
          throw new ConflictException('Mức giảm không tạo được giá ưu đãi hợp lệ.');
        await tx.$executeRaw`
          INSERT INTO course_promotions(course_id,sale_price_vnd,label,starts_at,ends_at,is_active,created_by)
          VALUES (${course.id}::uuid,${salePrice},${input.label.trim()},${startsAt},${endsAt},${input.isActive},${actorId}::uuid)
          ON CONFLICT(course_id) DO UPDATE SET sale_price_vnd=EXCLUDED.sale_price_vnd,
            label=EXCLUDED.label,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,
            is_active=EXCLUDED.is_active,updated_at=now()`;
        await tx.$executeRaw`UPDATE course_promotion_requests
          SET status='cancelled',review_reason='Admin đã áp dụng chương trình khuyến mãi theo lô.',
            reviewed_by=${actorId}::uuid,reviewed_at=now(),updated_at=now()
          WHERE course_id=${course.id}::uuid AND status='pending'`;
      }
      await audit(tx, 'course.promotion.batch.updated', null, actorId, {
        courseIds,
        discountPercent: input.discountPercent,
        label: input.label.trim(),
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        isActive: input.isActive,
      });
      return { updated: courses.length };
    });
  }

  async requestPromotionsBatch(
    user: AuthenticatedUser,
    input: {
      courseIds: string[];
      discountPercent: number;
      label: string;
      startsAt: string;
      endsAt: string;
      isActive: boolean;
    },
  ) {
    if (user.role !== 'lecturer') throw new ForbiddenException();
    const courseIds = [...new Set(input.courseIds)];
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (endsAt <= startsAt)
      throw new ConflictException('Thời gian kết thúc phải sau thời gian bắt đầu.');
    const actorId = requireHumanId(user);
    return this.store.transaction(async (tx) => {
      const courses = await tx.$queryRaw<{ id: string; price_vnd: number }[]>(Prisma.sql`
        SELECT c.id,p.price_vnd FROM courses c
        JOIN course_prices p ON p.course_id=c.id
        WHERE c.created_by=${actorId}::uuid
          AND c.id IN (${Prisma.join(courseIds.map((id) => Prisma.sql`${id}::uuid`))})
        ORDER BY c.id FOR UPDATE`);
      if (courses.length !== courseIds.length)
        throw new ForbiddenException('Chỉ có thể tạo khuyến mãi cho khóa học do bạn sở hữu.');
      if (courses.some((course) => course.price_vnd <= 1_000))
        throw new ConflictException('Chỉ có thể gửi đề xuất cho khóa học trả phí trên 1.000 ₫.');
      const requests: string[] = [];
      for (const course of courses) {
        const salePrice = Math.max(
          1_000,
          Math.floor((course.price_vnd * (100 - input.discountPercent)) / 100_000) * 1_000,
        );
        if (salePrice >= course.price_vnd)
          throw new ConflictException('Mức giảm không tạo được giá ưu đãi hợp lệ.');
        const [request] = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO course_promotion_requests(
            course_id,action,sale_price_vnd,label,starts_at,ends_at,requested_active,status,requested_by
          ) VALUES (
            ${course.id}::uuid,'upsert',${salePrice},${input.label.trim()},${startsAt},${endsAt},${input.isActive},'pending',${actorId}::uuid
          )
          ON CONFLICT(course_id) WHERE status='pending' DO UPDATE SET
            action='upsert',sale_price_vnd=EXCLUDED.sale_price_vnd,label=EXCLUDED.label,
            starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,
            requested_active=EXCLUDED.requested_active,requested_by=EXCLUDED.requested_by,
            review_reason=NULL,reviewed_by=NULL,reviewed_at=NULL,updated_at=now()
          RETURNING id`;
        requests.push(request.id);
      }
      await audit(tx, 'course.promotion.batch.requested', null, actorId, {
        courseIds,
        requestIds: requests,
        discountPercent: input.discountPercent,
        label: input.label.trim(),
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        isActive: input.isActive,
      });
      const admins = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE role='admin'::platform_role`;
      for (const admin of admins) {
        await notifyCommerce(
          tx,
          admin.id,
          requests[0],
          'Có chương trình khuyến mãi mới',
          `Giảng viên đã gửi ${courses.length} khóa học trong một chương trình cần duyệt.`,
          '/promotions',
        );
      }
      return { submitted: courses.length, requestIds: requests };
    });
  }

  async decidePromotionRequest(
    user: AuthenticatedUser,
    requestId: string,
    approve: boolean,
    reason: string,
  ) {
    const adminId = requireHumanId(user);
    return this.store.transaction(async (tx) => {
      await lock(tx, `promotion-request:${requestId}`);
      const [request] = await tx.$queryRaw<{
        id: string;
        course_id: string;
        action: 'upsert' | 'remove';
        sale_price_vnd: number | null;
        label: string | null;
        starts_at: Date | null;
        ends_at: Date | null;
        requested_active: boolean | null;
        requested_by: string;
        status: string;
      }[]>`SELECT * FROM course_promotion_requests WHERE id=${requestId}::uuid FOR UPDATE`;
      if (!request) throw new NotFoundException('Không tìm thấy đề xuất khuyến mãi');
      if (request.status !== 'pending')
        throw new ConflictException('Đề xuất này đã được xử lý.');
      if (approve && request.action === 'upsert') {
        const [price] = await tx.$queryRaw<{ price_vnd: number }[]>`
          SELECT price_vnd FROM course_prices WHERE course_id=${request.course_id}::uuid`;
        if (!price || !request.sale_price_vnd || request.sale_price_vnd >= price.price_vnd)
          throw new ConflictException('Giá đề xuất không còn hợp lệ so với giá niêm yết.');
        await tx.$executeRaw`
          INSERT INTO course_promotions(course_id,sale_price_vnd,label,starts_at,ends_at,is_active,created_by)
          VALUES (${request.course_id}::uuid,${request.sale_price_vnd},${request.label},${request.starts_at},${request.ends_at},${Boolean(request.requested_active)},${request.requested_by}::uuid)
          ON CONFLICT(course_id) DO UPDATE SET sale_price_vnd=EXCLUDED.sale_price_vnd,
            label=EXCLUDED.label,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,
            is_active=EXCLUDED.is_active,updated_at=now()`;
      }
      if (approve && request.action === 'remove') {
        await tx.$executeRaw`DELETE FROM course_promotions WHERE course_id=${request.course_id}::uuid`;
      }
      await tx.$executeRaw`UPDATE course_promotion_requests SET
        status=${approve ? 'approved' : 'rejected'},reviewed_by=${adminId}::uuid,
        review_reason=${reason.trim()},reviewed_at=now(),updated_at=now()
        WHERE id=${requestId}::uuid`;
      await audit(tx, approve ? 'course.promotion.request.approved' : 'course.promotion.request.rejected', requestId, adminId, { reason });
      await notifyCommerce(
        tx,
        request.requested_by,
        request.id,
        approve ? 'Khuyến mãi đã được duyệt' : 'Khuyến mãi cần chỉnh sửa',
        approve ? 'Đề xuất khuyến mãi của bạn đã được duyệt và sẽ áp dụng theo lịch.' : `Đề xuất chưa được duyệt: ${reason.trim()}`,
        `/courses/${request.course_id}/studio?tab=metadata`,
      );
      return { id: request.id, status: approve ? 'approved' : 'rejected' };
    });
  }
  async grantFreeOrRequirePurchase(userId: string, courseId: string) {
    await this.store.transaction(async (tx) => {
      await lock(tx, `course:${courseId}`);
      const [course] = await tx.$queryRaw<
        { price: number }[]
      >`SELECT COALESCE(p.price_vnd,0) AS price
        FROM courses c LEFT JOIN course_prices p ON p.course_id=c.id WHERE c.id=${courseId}::uuid AND c.status='published'`;
      if (!course) throw new NotFoundException('Khóa học chưa công khai');
      if (course.price > 0) {
        const grants = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM course_access_grants WHERE user_id=${userId}::uuid AND course_id=${courseId}::uuid AND revoked_at IS NULL`;
        if (!grants.length) throw new ForbiddenException('Cần mua khóa học trước khi đăng ký học.');
      } else
        await tx.$executeRaw`INSERT INTO course_access_grants(user_id,course_id,source) VALUES (${userId}::uuid,${courseId}::uuid,'free') ON CONFLICT DO NOTHING`;
    });
  }
  async requireCourse(userId: string, courseId: string) {
    const offer = await this.offer(userId, courseId);
    if (offer.priceVnd > 0 && !offer.owned)
      throw new ForbiddenException(
        'Bạn chưa có quyền học khóa này hoặc giao dịch đã được hoàn tiền.',
      );
  }
  async requireLesson(user: AuthenticatedUser, courseId: string, lessonId: string) {
    const [lesson] = await this.store.db.$queryRaw<{ is_preview: boolean; created_by: string }[]>`
      SELECT l.is_preview,c.created_by FROM lessons l JOIN chapters ch ON ch.id=l.chapter_id
      JOIN courses c ON c.id=ch.course_id WHERE l.id=${lessonId}::uuid AND c.id=${courseId}::uuid`;
    if (!lesson) throw new NotFoundException('Bài học không thuộc khóa học này');
    if (user.role === 'admin' || lesson.created_by === requireHumanId(user) || lesson.is_preview)
      return;
    await this.requireCourse(requireHumanId(user), courseId);
  }
}
