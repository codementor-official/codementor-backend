// Markdown → HTML cho thân bài học, đúng tập con mà studio (TipTap StarterKit + CodeBlock) đọc
// lại được: h2/h3, đoạn, danh sách một cấp, code block có ngôn ngữ, trích dẫn, kẻ ngang, và
// inline code / đậm / nghiêng / liên kết. Không có bảng: StarterKit không có, giảng viên mở bài
// ra sửa sẽ mất bảng.
//
// ponytail: tự viết thay vì thêm `marked` — nội dung do mình soạn, tập cú pháp cố định và nhỏ.
// Cần cú pháp ngoài tập này (bảng, danh sách lồng) thì thêm thư viện, đừng vá parser.

const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function inline(text) {
  const codes = [];
  // Code span trước tiên: bên trong nó không được hiểu `**` hay `[]` là cú pháp.
  let out = escape(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer nofollow">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, index) => codes[Number(index)]);
}

export function markdownToHtml(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  const paragraph = [];
  const flush = () => {
    if (paragraph.length) html.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flush();
      const code = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[(i += 1) - 1]);
      if (i >= lines.length) throw new Error('code block chưa đóng ```');
      const lang = fence[1] ? ` class="language-${fence[1]}"` : '';
      html.push(`<pre><code${lang}>${escape(code.join('\n'))}</code></pre>`);
      i += 1;
      continue;
    }
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      flush();
      html.push(`<h${heading[1].length}>${inline(heading[2].trim())}</h${heading[1].length}>`);
      i += 1;
      continue;
    }
    if (/^#\s/.test(line)) throw new Error(`dòng ${i + 1}: không dùng "# " trong thân bài — tiêu đề bài đã là h1`);
    if (/^-{3,}\s*$/.test(line)) {
      flush();
      html.push('<hr>');
      i += 1;
      continue;
    }
    const list = line.match(/^(\s*)([-*]|\d+\.)\s+/);
    if (list) {
      flush();
      const ordered = /\d/.test(list[2]);
      const items = [];
      while (i < lines.length && /^([-*]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i].replace(/^([-*]|\d+\.)\s+/, '');
        i += 1;
        // Dòng tiếp theo thụt vào là phần nối của cùng một mục.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) item += ` ${lines[(i += 1) - 1].trim()}`;
        items.push(`<li><p>${inline(item)}</p></li>`);
      }
      html.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[(i += 1) - 1].replace(/^>\s?/, ''));
      html.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`);
      continue;
    }
    if (line.trim() === '') flush();
    else paragraph.push(line.trim());
    i += 1;
  }
  flush();
  return html.join('\n');
}

/** Số chữ đọc được (bỏ thẻ, bỏ code block) — thước đo độ dày của một bài học. */
export function proseWords(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`_[\]()-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

/** `---\nyaml\n---\nthân` → [frontmatter thô, thân]. */
export function splitFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error('thiếu frontmatter (--- … ---) ở đầu file');
  return [match[1], match[2]];
}
