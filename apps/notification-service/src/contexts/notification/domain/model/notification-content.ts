import { InvalidInput, Result, ValueObject } from '@codementor/kernel';
import type { AudienceType } from '@codementor/contracts';

/**
 * Loại thông báo. Trùng đúng enum trong validator của MongoDB
 * (`codementor-infra/database/mongo/schemas/05-notifications.js`) — lệch nhau thì lệnh
 * ghi bị từ chối ở tận tầng driver với thông báo khó hiểu.
 *
 * Đặt tên theo `*_PUBLISHED` chứ không phải `*_CREATED`: khoá học và bài tập tồn tại từ
 * lúc tác giả bấm tạo, nhưng chỉ tới lúc admin duyệt mới có gì đáng báo cho người học.
 */
export type NotificationType =
  | 'COURSE_PUBLISHED'
  | 'EXERCISE_PUBLISHED'
  | 'ROADMAP_PUBLISHED'
  | 'ARTICLE_PUBLISHED'
  | 'ADMIN_ANNOUNCEMENT'
  /** Giảng viên vừa gửi một nội dung đi duyệt — chỉ admin nhận. */
  | 'CONTENT_REVIEW_REQUESTED'
  /** Giảng viên xin gỡ một nội dung đang công khai — chỉ admin nhận. */
  | 'CONTENT_REMOVAL_REQUESTED'
  /** Kết cục của một lần duyệt, hoặc admin thu hồi/từ chối yêu cầu xin gỡ — chỉ tác giả nhận. */
  | 'CONTENT_APPROVED'
  | 'CONTENT_CHANGES_REQUESTED'
  | 'CONTENT_REJECTED'
  | 'CONTENT_ARCHIVED'
  | 'REMOVAL_REQUEST_DENIED';

/**
 * `POST` chứ không phải `ARTICLE`: đây là từ vựng hướng ra ngoài, và yêu cầu nghiệp vụ
 * gọi loại nội dung này là "post". Bên trong hệ thống nó vẫn là `articles` — xem
 * `TOPICS.ARTICLE_PUBLISHED`.
 */
export type ReferenceType = 'COURSE' | 'EXERCISE' | 'ROADMAP' | 'POST';

interface ContentProps extends Record<string, unknown> {
  type: NotificationType;
  audienceType: AudienceType;
  audienceKey: string | null;
  title: string;
  message: string;
  referenceType: ReferenceType | null;
  referenceId: string | null;
  actionLabel: string | null;
  actionUrl: string | null;
  metadata: Record<string, unknown>;
}

export interface NotificationContentInput {
  type: NotificationType;
  /** Bỏ trống = `ALL`, giữ nguyên hành vi của những thông báo phát cho toàn hệ thống. */
  audienceType?: AudienceType;
  audienceKey?: string | null;
  title: string;
  message: string;
  referenceType?: ReferenceType | null;
  referenceId?: string | null;
  actionLabel?: string | null;
  actionUrl?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Phần chữ nghĩa của một thông báo, đã được kiểm.
 *
 * Có value object ở đây vì thông báo là thứ **không sửa được sau khi gửi**: nó đã nằm
 * trong panel của hàng nghìn người và đã được đọc. Một dòng chữ hỏng — thiếu tiêu đề,
 * nút bấm không có đường dẫn — không có đường vá, chỉ có xoá. Nên chỗ chặn phải là lúc
 * dựng, chứ không phải lúc hiển thị.
 *
 * Bốn hàm dựng nội dung ở tầng application đều phải đi qua đây, nên một hàm mới viết sai
 * sẽ hỏng ngay lần chạy đầu tiên thay vì âm thầm ghi rác vào MongoDB.
 */
export class NotificationContent extends ValueObject<ContentProps> {
  /** Đủ dài cho một câu tiếng Việt tử tế, đủ ngắn để không phá vỡ panel. */
  private static readonly MAX_TITLE = 150;
  private static readonly MAX_MESSAGE = 1000;

  private constructor(props: ContentProps) {
    super(props);
  }

  static create(input: NotificationContentInput): Result<NotificationContent, InvalidInput> {
    const title = input.title.trim();
    const message = input.message.trim();

    if (title.length === 0 || title.length > NotificationContent.MAX_TITLE) {
      return Result.fail(
        new InvalidInput(`Tiêu đề thông báo phải dài 1–${NotificationContent.MAX_TITLE} ký tự`, {
          title: input.title,
        }),
      );
    }
    if (message.length === 0 || message.length > NotificationContent.MAX_MESSAGE) {
      return Result.fail(
        new InvalidInput(`Nội dung thông báo phải dài 1–${NotificationContent.MAX_MESSAGE} ký tự`, {
          type: input.type,
        }),
      );
    }

    const actionLabel = input.actionLabel?.trim() || null;
    const actionUrl = input.actionUrl?.trim() || null;
    // Nhãn không kèm đường dẫn = nút bấm không làm gì; đường dẫn không kèm nhãn = không
    // có gì để bấm. Cả hai đều là lỗi lập trình, và cả hai đều chỉ lộ ra trên giao diện
    // của người dùng thật nếu không chặn ở đây.
    if ((actionLabel === null) !== (actionUrl === null)) {
      return Result.fail(
        new InvalidInput('actionLabel và actionUrl phải cùng có hoặc cùng không', {
          actionLabel,
          actionUrl,
        }),
      );
    }
    if (actionUrl !== null && !actionUrl.startsWith('/')) {
      // Chỉ nhận đường dẫn nội bộ: thông báo là kênh do hệ thống phát, và một URL tuyệt
      // đối lọt vào đây sẽ thành cú bấm đưa người dùng ra khỏi CodeMentor.
      return Result.fail(
        new InvalidInput('actionUrl phải là đường dẫn nội bộ, bắt đầu bằng "/"', { actionUrl }),
      );
    }

    const referenceType = input.referenceType ?? null;
    const referenceId = input.referenceId ?? null;
    if ((referenceType === null) !== (referenceId === null)) {
      return Result.fail(
        new InvalidInput('referenceType và referenceId phải cùng có hoặc cùng không', {
          referenceType,
          referenceId,
        }),
      );
    }
    // Thông báo của admin không trỏ tới tài nguyên nào; ba loại còn lại thì bắt buộc,
    // vì thiếu nó là mất luôn đường lần ngược từ thông báo về nội dung sinh ra nó.
    if (input.type === 'ADMIN_ANNOUNCEMENT') {
      if (referenceType !== null) {
        return Result.fail(
          new InvalidInput('Thông báo của admin không gắn với tài nguyên nào', { referenceType }),
        );
      }
    } else if (referenceType === null) {
      return Result.fail(
        new InvalidInput(`Thông báo ${input.type} phải gắn với một tài nguyên`, {
          type: input.type,
        }),
      );
    }

    const audienceType = input.audienceType ?? 'ALL';
    const audienceKey = input.audienceKey?.trim() || null;
    // `ROLE`/`USER` không có khoá là thông báo gửi vào hư không: nó lưu được, không ai
    // đọc được, và không có gì trên giao diện tố cáo chuyện đó. `ALL` thì ngược lại —
    // một khoá thừa ở đây nghĩa là người viết tưởng mình đang gửi riêng cho ai đó.
    if ((audienceType === 'ALL') !== (audienceKey === null)) {
      return Result.fail(
        new InvalidInput('audienceKey bắt buộc với ROLE/USER và phải rỗng với ALL', {
          audienceType,
          audienceKey,
        }),
      );
    }

    return Result.ok(
      new NotificationContent({
        type: input.type,
        audienceType,
        audienceKey,
        title,
        message,
        referenceType,
        referenceId,
        actionLabel,
        actionUrl,
        metadata: input.metadata ?? {},
      }),
    );
  }

  get type(): NotificationType {
    return this.props.type;
  }
  get audienceType(): AudienceType {
    return this.props.audienceType;
  }
  get audienceKey(): string | null {
    return this.props.audienceKey;
  }
  get title(): string {
    return this.props.title;
  }
  get message(): string {
    return this.props.message;
  }
  get referenceType(): ReferenceType | null {
    return this.props.referenceType;
  }
  get referenceId(): string | null {
    return this.props.referenceId;
  }
  get actionLabel(): string | null {
    return this.props.actionLabel;
  }
  get actionUrl(): string | null {
    return this.props.actionUrl;
  }
  get metadata(): Record<string, unknown> {
    return this.props.metadata;
  }
}
