import { Handle } from './handle';

describe('Handle', () => {
  it('chuẩn hoá về chữ thường', () => {
    expect(Handle.create('  GiaSi  ').value.value).toBe('giasi');
  });

  it.each([
    ['quá ngắn', 'ab'],
    ['bắt đầu bằng gạch ngang', '-giasi'],
    ['kết thúc bằng gạch dưới', 'giasi_'],
    ['chứa ký tự lạ', 'gia.si'],
    ['có khoảng trắng ở giữa', 'gia si'],
    ['dài hơn 30 ký tự', 'a'.repeat(31)],
  ])('từ chối handle %s', (_label, value) => {
    expect(Handle.create(value).isFail).toBe(true);
  });

  it.each([['giasi'], ['gia-si'], ['gia_si'], ['g1a5i'], ['abc']])(
    'chấp nhận handle hợp lệ %s',
    (value) => {
      expect(Handle.create(value).isOk).toBe(true);
    },
  );

  /**
   * Ràng buộc này phải khớp CHECK `users_handle_format` bên codementor-infra.
   * Nếu một bên đổi mà bên kia không đổi, insert sẽ bị Postgres từ chối lúc chạy.
   */
  it('khớp đúng pattern mà CSDL cưỡng chế', () => {
    const dbPattern = /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$/;
    for (const candidate of ['giasi', 'gia-si', 'ab', '-x', 'x_']) {
      expect(Handle.create(candidate).isOk).toBe(dbPattern.test(candidate));
    }
  });
});
