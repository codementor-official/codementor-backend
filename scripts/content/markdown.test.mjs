// node --test scripts/content/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inline, markdownToHtml, proseWords, splitFrontmatter } from './markdown.mjs';

test('code block giữ nguyên ký tự, escape HTML, gắn ngôn ngữ', () => {
  const html = markdownToHtml('```python\nif a < b and "x":\n    print(**k)\n```');
  assert.equal(html, '<pre><code class="language-python">if a &lt; b and &quot;x&quot;:\n    print(**k)</code></pre>');
});

test('inline: code span không bị hiểu là đậm/nghiêng', () => {
  assert.equal(inline('dùng `a**b` và **đậm** và *nghiêng*'), 'dùng <code>a**b</code> và <strong>đậm</strong> và <em>nghiêng</em>');
});

test('liên kết chỉ nhận http(s)', () => {
  assert.match(inline('[MDN](https://developer.mozilla.org)'), /<a href="https:\/\/developer\.mozilla\.org"/);
  assert.equal(inline('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
});

test('khối: tiêu đề, danh sách nối dòng, trích dẫn, đoạn', () => {
  const html = markdownToHtml('## Mục\n\n- một\n  tiếp\n- hai\n\n1. a\n2. b\n\n> lưu ý\n\ndòng 1\ndòng 2');
  assert.equal(
    html,
    ['<h2>Mục</h2>', '<ul><li><p>một tiếp</p></li><li><p>hai</p></li></ul>', '<ol><li><p>a</p></li><li><p>b</p></li></ol>',
      '<blockquote><p>lưu ý</p></blockquote>', '<p>dòng 1 dòng 2</p>'].join('\n'),
  );
});

test('lỗi sớm: h1 trong thân, code block chưa đóng', () => {
  assert.throws(() => markdownToHtml('# Tiêu đề'), /không dùng "# "/);
  assert.throws(() => markdownToHtml('```js\nx'), /chưa đóng/);
});

test('đếm chữ bỏ qua code', () => {
  assert.equal(proseWords('Hai chữ\n```js\nconst a = 1 + 2 + 3;\n```'), 2);
});

test('frontmatter', () => {
  assert.deepEqual(splitFrontmatter('---\ntitle: A\n---\nthân'), ['title: A', 'thân']);
});

test('ảnh đứng riêng một dòng thành <img>, chỉ nhận https', () => {
  assert.equal(
    markdownToHtml('Mở đầu.\n![Hàng người chờ](https://cdn.example/a.webp)\nTiếp.'),
    '<p>Mở đầu.</p>\n<img src="https://cdn.example/a.webp" alt="Hàng người chờ">\n<p>Tiếp.</p>',
  );
  assert.throws(() => markdownToHtml('![x](illustration:queue)'), /ảnh phải là https/);
  assert.equal(proseWords('một ![mô tả dài](illustration:x) hai'), 2);
});
