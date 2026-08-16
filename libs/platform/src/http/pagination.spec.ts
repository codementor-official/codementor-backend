import { decodeCursor, encodeCursor, toPage } from './pagination';

const row = (id: string, iso: string) => ({ id, updatedAt: new Date(iso) });

describe('cursor', () => {
  it('mã hoá rồi giải mã ra đúng cặp khoá sắp xếp', () => {
    const at = new Date('2026-08-15T07:00:00.000Z');
    const decoded = decodeCursor(encodeCursor(at, 'a1'));
    expect(decoded).toEqual({ updatedAt: at, id: 'a1' });
  });

  // Cursor đến từ query string, người dùng sửa được. Ném lỗi 500 vì một chuỗi rác là
  // biến input của người lạ thành lỗi hệ thống.
  it('trả null khi cursor rác thay vì ném lỗi', () => {
    expect(decodeCursor('không-phải-base64!!')).toBeNull();
    expect(decodeCursor(Buffer.from('thiếu-dấu-gạch').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('ngày-sai|a1').toString('base64url'))).toBeNull();
  });
});

describe('toPage', () => {
  it('còn trang sau thì cắt hàng dư và phát cursor', () => {
    const rows = [
      row('a', '2026-08-15T03:00:00.000Z'),
      row('b', '2026-08-15T02:00:00.000Z'),
      row('c', '2026-08-15T01:00:00.000Z'),
    ];
    const page = toPage(rows, 2);

    expect(page.items.map((i) => i.id)).toEqual(['a', 'b']);
    // Cursor phải trỏ vào hàng CUỐI của trang này, không phải hàng dư — nếu không,
    // bản ghi 'b' sẽ bị nhảy qua ở trang sau.
    expect(decodeCursor(page.nextCursor!)).toEqual({
      updatedAt: new Date('2026-08-15T02:00:00.000Z'),
      id: 'b',
    });
  });

  it('hết dữ liệu thì nextCursor là null', () => {
    const page = toPage([row('a', '2026-08-15T03:00:00.000Z')], 2);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('không có hàng nào cũng không nổ', () => {
    expect(toPage([], 20)).toEqual({ items: [], nextCursor: null });
  });
});
