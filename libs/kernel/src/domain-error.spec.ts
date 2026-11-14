import { NotFound } from './domain-error';

describe('NotFound', () => {
  it('không lặp "Không tìm thấy" khi chỗ gọi truyền cả câu', () => {
    expect(new NotFound('Không tìm thấy nhóm học tập').message).toBe('Không tìm thấy nhóm học tập');
    expect(new NotFound('nhóm học tập').message).toBe('Không tìm thấy nhóm học tập');
    expect(new NotFound('Bài tập', 'x1').message).toBe('Không tìm thấy Bài tập với id x1');
  });
});
