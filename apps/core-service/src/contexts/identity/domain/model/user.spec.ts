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
