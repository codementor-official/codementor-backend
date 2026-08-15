import { Email } from './email';
import { User } from './user';

const email = (raw = 'Giasi@CodeMentor.VN') => Email.create(raw).value;

const provision = (overrides: Partial<Parameters<typeof User.provision>[0]> = {}) =>
  User.provision({
    id: 'a0000000-0000-4000-8000-000000000001',
    externalId: 'kc-sub-123',
    email: email(),
    displayName: '  Gia Sĩ  ',
    emailVerified: false,
    role: 'learner',
    ...overrides,
  });

describe('Email', () => {
  it('chuẩn hoá về chữ thường để khớp kiểu citext của CSDL', () => {
    expect(email().value).toBe('giasi@codementor.vn');
  });

  it('từ chối email sai định dạng', () => {
    expect(Email.create('không-phải-email').isFail).toBe(true);
  });
});

describe('User — hồ sơ nội bộ chiếu từ Keycloak', () => {
  it('phát UserRegistered lần đầu provision', () => {
    const events = provision().pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe('identity.user.registered');
  });

  it('chỉ trả sự kiện một lần để tránh phát trùng', () => {
    const user = provision();
    user.pullEvents();
    expect(user.pullEvents()).toHaveLength(0);
  });

  it('cắt khoảng trắng thừa của tên hiển thị', () => {
    expect(provision().displayName).toBe('Gia Sĩ');
  });

  it('dùng email làm tên hiển thị khi Keycloak không trả về tên', () => {
    expect(provision({ displayName: '   ' }).displayName).toBe('giasi@codementor.vn');
  });

  it('giữ external_id để tra cứu lúc xác thực', () => {
    expect(provision().externalId).toBe('kc-sub-123');
  });

  it('cho phép truy cập khi tài khoản đang hoạt động', () => {
    expect(provision().canAccessPlatform().isOk).toBe(true);
  });

  it('chặn truy cập sau khi xoá mềm, dù token Keycloak vẫn hợp lệ', () => {
    const user = provision();
    user.softDelete();
    const result = user.canAccessPlatform();
    expect(result.isFail).toBe(true);
    expect(result.error.message).toContain('đã bị xoá');
  });

  it('đánh dấu đã xác thực email khi Keycloak báo verified', () => {
    expect(provision({ emailVerified: true }).isEmailVerified).toBe(true);
  });

  describe('syncFromProvider', () => {
    it('không báo thay đổi khi claim y hệt — tránh UPDATE mỗi request', () => {
      const user = provision({ emailVerified: true });
      const changed = user.syncFromProvider({
        email: email(),
        displayName: 'Gia Sĩ',
        emailVerified: true,
        role: 'learner',
      });
      expect(changed).toBe(false);
    });

    it('nhận vai trò mới từ Keycloak — realm role là nguồn sự thật', () => {
      const user = provision();
      const changed = user.syncFromProvider({
        email: email(),
        displayName: 'Gia Sĩ',
        emailVerified: false,
        role: 'admin',
      });
      expect(changed).toBe(true);
      expect(user.role).toBe('admin');
    });

    it('cập nhật khi người dùng đổi email ở Keycloak', () => {
      const user = provision();
      const changed = user.syncFromProvider({
        email: email('moi@codementor.vn'),
        displayName: 'Gia Sĩ',
        emailVerified: false,
        role: 'learner',
      });
      expect(changed).toBe(true);
      expect(user.email.value).toBe('moi@codementor.vn');
    });

    it('ghi nhận email được xác thực về sau', () => {
      const user = provision({ emailVerified: false });
      expect(
        user.syncFromProvider({
          email: email(),
          displayName: 'Gia Sĩ',
          emailVerified: true,
          role: 'learner',
        }),
      ).toBe(true);
      expect(user.isEmailVerified).toBe(true);
    });
  });

  it('từ chối tên hiển thị rỗng', () => {
    expect(provision().changeDisplayName('   ').isFail).toBe(true);
  });
});

describe('User.updateProfile', () => {
  it('trường vắng mặt thì giữ nguyên — PATCH một trường không xoá phần còn lại', () => {
    const user = provision();
    expect(user.updateProfile({ bio: 'Dạy Node.js' }).isOk).toBe(true);
    expect(user.updateProfile({ locale: 'en' }).isOk).toBe(true);

    expect(user.bio).toBe('Dạy Node.js');
    expect(user.locale).toBe('en');
    expect(user.displayName).toBe('Gia Sĩ');
  });

  it('null thì xoá giá trị', () => {
    const user = provision();
    user.updateProfile({ bio: 'Dạy Node.js' });
    user.updateProfile({ bio: null });
    expect(user.bio).toBeNull();
  });

  it('chuỗi rỗng cũng thành null, không lưu chuỗi trắng', () => {
    const user = provision();
    user.updateProfile({ bio: '   ' });
    expect(user.bio).toBeNull();
  });

  it('từ chối tên hiển thị rỗng hoặc quá dài', () => {
    const user = provision();
    expect(user.updateProfile({ displayName: '   ' }).isFail).toBe(true);
    expect(user.updateProfile({ displayName: 'x'.repeat(121) }).isFail).toBe(true);
    expect(user.displayName).toBe('Gia Sĩ');
  });

  // javascript: trong websiteUrl là XSS ở chỗ render hồ sơ công khai.
  it('chỉ nhận http và https cho địa chỉ web', () => {
    const user = provision();
    expect(user.updateProfile({ websiteUrl: 'https://giasi.dev' }).isOk).toBe(true);
    expect(user.updateProfile({ websiteUrl: 'javascript:alert(1)' }).isFail).toBe(true);
    expect(user.updateProfile({ websiteUrl: 'data:text/html,<script>' }).isFail).toBe(true);
    expect(user.updateProfile({ avatarUrl: 'không phải url' }).isFail).toBe(true);
    expect(user.websiteUrl).toBe('https://giasi.dev');
  });

  it('kiểm định dạng tên GitHub', () => {
    const user = provision();
    expect(user.updateProfile({ githubHandle: 'gia-si' }).isOk).toBe(true);
    expect(user.updateProfile({ githubHandle: '-mở-đầu-bằng-gạch' }).isFail).toBe(true);
    expect(user.githubHandle).toBe('gia-si');
  });

  // Cho sửa vai trò ở đây là để người dùng tự cấp quyền cho mình.
  it('không có đường sửa email, vai trò hay trạng thái', () => {
    const user = provision();
    const edit = { role: 'admin', email: 'khac@codementor.vn', status: 'suspended' };
    user.updateProfile(edit as Parameters<typeof user.updateProfile>[0]);

    expect(user.role).toBe('learner');
    expect(user.email.value).toBe('giasi@codementor.vn');
    expect(user.status).toBe('active');
  });

  it('mặc định locale và timezone khớp DEFAULT của cột trong PostgreSQL', () => {
    const user = provision();
    expect(user.locale).toBe('vi');
    expect(user.timezone).toBe('Asia/Ho_Chi_Minh');
  });
});
