import { Article } from './article';

/** Bài nháp đã đủ điều kiện đăng: có tóm tắt và có thân bài. */
function ready(): Article {
  const created = Article.create({
    id: '11111111-1111-1111-1111-111111111111',
    slug: 'spring-boot-hieu-qua',
    title: '5 kỹ thuật học Spring Boot',
    authorId: '22222222-2222-2222-2222-222222222222',
  });
  if (created.isFail) throw created.error;
  const article = created.value;
  article.edit({ excerpt: 'Tóm tắt ngắn' });
  article.attachContent('deadbeefdeadbeefdeadbeef');
  return article;
}

describe('Article', () => {
  it('tạo ra ở trạng thái nháp, chưa từng công khai', () => {
    const article = ready();
    expect(article.status).toBe('draft');
    expect(article.publishedAt).toBeNull();
  });

  it('không gửi duyệt được khi thiếu tóm tắt hoặc thân bài', () => {
    const created = Article.create({
      id: '33333333-3333-3333-3333-333333333333',
      slug: 'thieu-noi-dung',
      title: 'Bài thiếu nội dung',
      authorId: '22222222-2222-2222-2222-222222222222',
    });
    const bare = created.value;
    expect(bare.submit().isFail).toBe(true);

    bare.edit({ excerpt: 'Có tóm tắt rồi' });
    // Vẫn thiếu thân bài.
    expect(bare.submit().isFail).toBe(true);
  });

  /**
   * Quy tắc quan trọng nhất của module: thông báo "bài viết mới" chỉ được gửi MỘT lần.
   * Gỡ xuống rồi đăng lại là thao tác biên tập, không phải một bài mới.
   */
  it('chỉ báo firstPublish ở lần duyệt đầu tiên', () => {
    const article = ready();

    expect(article.submit().isOk).toBe(true);
    expect(article.status).toBe('pending_review');

    const first = article.moderate('approve', null);
    expect(first.isOk).toBe(true);
    expect(first.value.firstPublish).toBe(true);
    expect(article.status).toBe('published');
    const publishedAt = article.publishedAt;
    expect(publishedAt).not.toBeNull();

    // Gỡ xuống rồi soạn lại và duyệt lần hai: KHÔNG được báo "bài viết mới" lần nữa.
    expect(article.moderate('archive', null).isOk).toBe(true);
    expect(article.status).toBe('archived');
    expect(article.publishedAt).toEqual(publishedAt);
  });

  it('không duyệt được bài chưa gửi lên', () => {
    const article = ready();
    expect(article.moderate('approve', null).isFail).toBe(true);
  });

  it('từ chối và yêu cầu sửa phải nêu lý do, và lý do được giữ lại', () => {
    const article = ready();
    article.submit();

    expect(article.moderate('reject', null).isFail).toBe(true);
    expect(article.moderate('request_changes', '   ').isFail).toBe(true);

    expect(article.moderate('request_changes', 'Thiếu ví dụ code').isOk).toBe(true);
    expect(article.status).toBe('changes_requested');
    expect(article.rejectionReason).toBe('Thiếu ví dụ code');

    // Gửi lại thì lý do cũ phải biến mất, nếu không người viết thấy mãi một lời chê đã xử lý.
    expect(article.submit().isOk).toBe(true);
    expect(article.rejectionReason).toBeNull();
  });

  it('người viết rút được bài khỏi hàng chờ', () => {
    const article = ready();
    article.submit();
    expect(article.withdraw().isOk).toBe(true);
    expect(article.status).toBe('draft');
    // Rút khi không ở hàng chờ là vô nghĩa.
    expect(article.withdraw().isFail).toBe(true);
  });

  // Slug là địa chỉ công khai, và nó đã nằm trong `actionUrl` của thông báo đã gửi.
  it('khoá slug sau khi bài đã từng công khai', () => {
    const article = ready();
    expect(article.edit({ slug: 'doi-slug-luc-nhap' }).isOk).toBe(true);

    article.submit();
    article.moderate('approve', null);
    expect(article.edit({ slug: 'doi-slug-sau-khi-dang' }).isFail).toBe(true);
    // Truyền lại đúng slug hiện tại thì không phải là đổi, nên vẫn hợp lệ.
    expect(article.edit({ slug: 'doi-slug-luc-nhap' }).isOk).toBe(true);
  });

  it('chỉ lưu trữ được bài đang công khai', () => {
    const article = ready();
    // Bài nháp chưa công khai thì không có gì để gỡ.
    expect(article.moderate('archive', null).isFail).toBe(true);

    article.submit();
    article.moderate('approve', null);
    expect(article.moderate('archive', null).isOk).toBe(true);
    expect(article.status).toBe('archived');
  });
});
