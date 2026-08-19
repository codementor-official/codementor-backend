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

describe('đổi slug', () => {
  it('sửa được khi còn nháp', () => {
    const roadmap = make();
    expect(roadmap.edit({ slug: 'Lo-Trinh-Fullstack' }).isOk).toBe(true);
    expect(roadmap.slug).toBe('lo-trinh-fullstack');
  });

  it('từ chối slug sai định dạng', () => {
    const roadmap = make();
    for (const bad of ['-mo-dau', 'ket-thuc-', 'CO HOA', 'ab']) {
      expect(roadmap.edit({ slug: bad }).isFail).toBe(true);
    }
    expect(roadmap.slug).toBe('lo-trinh-backend');
  });

  // Đường dẫn đã phát ra ngoài; đổi là làm hỏng mọi liên kết đang trỏ tới.
  it('không đổi được sau khi công khai', () => {
    const roadmap = make();
    roadmap.edit({ description: 'Mô tả' });
    roadmap.submit([course('published'), course('published')]);
    roadmap.withdraw();
    const published = Roadmap.rehydrate('id', {
      slug: 'lo-trinh-backend',
      title: 'Lộ trình Backend',
      shortDescription: null,
      description: 'Mô tả',
      field: 'backend',
      level: 'basic',
      coverImageUrl: null,
      estimatedHours: 20,
      progressionMode: 'graph',
      prerequisiteNote: null,
      status: 'published',
      createdBy: 'u1',
      rejectionReason: null,
      publishedAt: new Date(),
      updatedAt: new Date(),
    });
    expect(published.edit({ slug: 'ten-khac' }).isFail).toBe(true);
    expect(published.slug).toBe('lo-trinh-backend');
  });

  /**
   * `archived` không có đường ra cho tới khi `restore` được thêm: `submit` chỉ nhận
   * draft/changes_requested/rejected, nên mọi lần gỡ đều là vĩnh viễn và cách duy nhất
   * đưa nội dung trở lại là UPDATE thẳng vào CSDL.
   */
  describe('gỡ và khôi phục', () => {
    const published = () => {
      const roadmap = make();
      roadmap.edit({ description: 'Mô tả' });
      roadmap.submit([course('published'), course('published')]);
      roadmap.moderate('approve', null);
      return roadmap;
    };

    it('chỉ gỡ được nội dung đang công khai', () => {
      expect(make().moderate('archive', null).isFail).toBe(true);
      const roadmap = published();
      expect(roadmap.moderate('archive', null).isOk).toBe(true);
      expect(roadmap.status).toBe('archived');
    });

    it('khôi phục đưa về draft, không phải thẳng published', () => {
      const roadmap = published();
      roadmap.moderate('archive', null);

      expect(roadmap.moderate('restore', null).isOk).toBe(true);
      expect(roadmap.status).toBe('draft');
    });

    it('khôi phục xong đi lại đúng vòng duyệt', () => {
      const roadmap = published();
      const firstPublishedAt = roadmap.publishedAt;
      roadmap.moderate('archive', null);
      roadmap.moderate('restore', null);

      expect(roadmap.submit([course('published'), course('published')]).isOk).toBe(true);
      expect(roadmap.status).toBe('pending_review');
      expect(roadmap.moderate('approve', null).isOk).toBe(true);
      expect(roadmap.status).toBe('published');
      // Gỡ rồi duyệt lại không phải là ngày phát hành mới.
      expect(roadmap.publishedAt).toEqual(firstPublishedAt);
    });

    it('chỉ khôi phục được nội dung đã gỡ', () => {
      expect(make().moderate('restore', null).isFail).toBe(true);
      expect(published().moderate('restore', null).isFail).toBe(true);
    });

    it('gỡ kèm lý do thì lý do đó thay chỗ lý do từ chối cũ', () => {
      const roadmap = published();
      roadmap.moderate('archive', '  Thiếu khoá nền tảng  ');
      expect(roadmap.rejectionReason).toBe('Thiếu khoá nền tảng');
    });
  });

  describe('sửa và gửi duyệt lại lộ trình đang công khai', () => {
    const published = () => {
      const roadmap = make();
      roadmap.edit({ description: 'Mô tả' });
      roadmap.submit([course('published'), course('published')]);
      roadmap.moderate('approve', null);
      return roadmap;
    };

    it('gửi duyệt lại được — sửa lộ trình đang sống thì phải qua duyệt lại', () => {
      const roadmap = published();
      expect(roadmap.submit([course('published'), course('published')]).isOk).toBe(true);
      expect(roadmap.status).toBe('pending_review');
    });

    it('hủy gửi duyệt lại thì về published, không phải draft', () => {
      const roadmap = published();
      roadmap.submit([course('published'), course('published')]);
      expect(roadmap.withdraw().isOk).toBe(true);
      expect(roadmap.status).toBe('published');
    });
  });

  /** Lối lùi cho quyết định của admin — xem chú thích ở `Roadmap.moderate`. */
  describe('admin đổi ý', () => {
    const rejected = () => {
      const roadmap = make();
      roadmap.edit({ description: 'Mô tả' });
      roadmap.submit([course('published'), course('published')]);
      roadmap.moderate('reject', 'Thứ tự khoá chưa hợp lý');
      return roadmap;
    };

    it('duyệt được lộ trình vừa từ chối, không cần tác giả gửi lại', () => {
      const roadmap = rejected();
      expect(roadmap.status).toBe('rejected');
      expect(roadmap.moderate('approve', null).isOk).toBe(true);
      expect(roadmap.status).toBe('published');
      expect(roadmap.rejectionReason).toBeNull();
    });

    it('không từ chối được lộ trình chưa gửi duyệt', () => {
      expect(make().moderate('reject', 'Không hợp lệ').isFail).toBe(true);
    });
  });
});
