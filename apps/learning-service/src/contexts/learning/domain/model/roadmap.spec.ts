import { Roadmap } from './roadmap';
import type { ContentStatus } from './roadmap';

const make = () => {
  const created = Roadmap.create({
    id: 'r0000000-0000-4000-8000-000000000001',
    slug: 'lo-trinh-backend',
    title: '  Lộ trình Backend  ',
    field: 'backend',
    level: 'basic',
    createdBy: 'u1',
  });
  if (created.isFail) throw created.error;
  return created.value;
};

const course = (status: ContentStatus, durationHours: number | null = 10) => ({
  status,
  durationHours,
});

describe('Roadmap', () => {
  it('lộ trình mới ở draft, chưa có tổng thời lượng', () => {
    const roadmap = make();
    expect(roadmap.status).toBe('draft');
    expect(roadmap.estimatedHours).toBeNull();
    expect(roadmap.title).toBe('Lộ trình Backend');
  });

  // javascript: ở ô ảnh bìa là stored XSS chỗ render lộ trình công khai.
  it('ảnh bìa chỉ nhận http và https', () => {
    const roadmap = make();
    expect(roadmap.edit({ coverImageUrl: 'https://cdn.test/a.png' }).isOk).toBe(true);
    expect(roadmap.edit({ coverImageUrl: 'javascript:alert(1)' }).isFail).toBe(true);
    expect(roadmap.edit({ coverImageUrl: 'không phải url' }).isFail).toBe(true);
    expect(roadmap.coverImageUrl).toBe('https://cdn.test/a.png');
  });

  describe('recalculateEstimatedHours', () => {
    it('cộng thời lượng của khóa học con', () => {
      const roadmap = make();
      roadmap.recalculateEstimatedHours([10, 20, 5]);
      expect(roadmap.estimatedHours).toBe(35);
    });

    it('khóa học chưa điền thời lượng thì tính là 0, không làm hỏng tổng', () => {
      const roadmap = make();
      roadmap.recalculateEstimatedHours([10, null, 5]);
      expect(roadmap.estimatedHours).toBe(15);
    });

    // Cột có CHECK `estimated_hours > 0`, nên tổng bằng 0 phải ghi NULL.
    it('không còn khóa học nào thì về null chứ không phải 0', () => {
      const roadmap = make();
      roadmap.recalculateEstimatedHours([10]);
      roadmap.recalculateEstimatedHours([]);
      expect(roadmap.estimatedHours).toBeNull();
      roadmap.recalculateEstimatedHours([null, null]);
      expect(roadmap.estimatedHours).toBeNull();
    });
  });

  describe('submit', () => {
    const ready = () => {
      const roadmap = make();
      roadmap.edit({ description: 'Mô tả đầy đủ' });
      return roadmap;
    };

    it('đủ điều kiện thì chuyển sang chờ duyệt', () => {
      const roadmap = ready();
      expect(roadmap.submit([course('published'), course('published')]).isOk).toBe(true);
      expect(roadmap.status).toBe('pending_review');
    });

    it('dưới hai khóa học thì chặn', () => {
      expect(ready().submit([course('published')]).isFail).toBe(true);
    });

    // Lộ trình chứa khóa học chưa công khai sẽ để học viên gặp lỗ hổng giữa đường.
    it('còn khóa học chưa công khai thì chặn và đếm rõ bao nhiêu', () => {
      const result = ready().submit([course('published'), course('draft'), course('draft')]);
      expect(result.isFail).toBe(true);
      expect(result.error.message).toContain('2 khóa học chưa được công khai');
    });

    it('thiếu mô tả thì chặn', () => {
      const result = make().submit([course('published'), course('published')]);
      expect(result.isFail).toBe(true);
      expect(result.error.message).toContain('mô tả');
    });
  });

  describe('khoá khi chờ duyệt', () => {
    it('không sửa được, hủy gửi duyệt xong lại sửa được', () => {
      const roadmap = make();
      roadmap.edit({ description: 'Mô tả' });
      roadmap.submit([course('published'), course('published')]);

      expect(roadmap.isLockedForReview).toBe(true);
      expect(roadmap.edit({ title: 'Tên khác' }).isFail).toBe(true);

      expect(roadmap.withdraw().isOk).toBe(true);
      expect(roadmap.status).toBe('draft');
      expect(roadmap.edit({ title: 'Tên khác' }).isOk).toBe(true);
    });

    it('chỉ hủy gửi duyệt được khi đang chờ duyệt', () => {
      expect(make().withdraw().isFail).toBe(true);
    });
  });
});
