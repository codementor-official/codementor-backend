import type { EmailPayload, Recipient } from '../domain/model/reminder';

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
export function renderEmail(payload: EmailPayload, user: Recipient, baseUrl: string) {
  const base = new URL(baseUrl);
  const action = new URL(payload.actionUrl, base);
  if (!['http:', 'https:'].includes(base.protocol) || action.origin !== base.origin)
    throw new Error('Email CTA must stay on the client origin');
  let timezone = user.timezone || 'Asia/Ho_Chi_Minh';
  try {
    new Intl.DateTimeFormat('vi-VN', { timeZone: timezone });
  } catch {
    timezone = 'Asia/Ho_Chi_Minh';
  }
  const due = payload.dueAt
    ? new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(new Date(payload.dueAt)) +
      ' (' +
      timezone +
      ')'
    : null;
  const settings = new URL('/profile?tab=settings', base).href;
  const e = escapeHtml;
  const text = `CodeMentor\n${payload.title}\n\nChào ${user.display_name},\n${payload.message}${due ? '\nHạn nộp: ' + due : ''}\n\n${payload.actionLabel}: ${action.href}\nQuản lý email: ${settings}`;
  const html = `<!doctype html><html lang="vi"><body style="margin:0;background:#f5f5f5;color:#242424;font-family:Arial,sans-serif">
 <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
 <table role="presentation" width="600" style="max-width:100%;background:#fff;border-radius:12px" cellpadding="24">
 <tr><td style="border-bottom:3px solid #ea580c;font-size:22px;font-weight:bold;color:#c2410c">&lt;/&gt; CodeMentor</td></tr>
 <tr><td><h1 style="font-size:22px;margin:0 0 20px">${e(payload.title)}</h1>
 <p>Chào ${e(user.display_name)},</p><p style="line-height:1.7">${e(payload.message).replace(/\n/g, '<br>')}</p>
 ${due ? '<p><strong>Hạn nộp:</strong> ' + e(due) + '</p>' : ''}
 <p style="margin:28px 0"><a href="${e(action.href)}" style="background:#c2410c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${e(payload.actionLabel)}</a></p>
 <p style="font-size:12px;color:#666;border-top:1px solid #ddd;padding-top:18px">Bạn nhận email theo cấu hình tài khoản CodeMentor.
 <a href="${e(settings)}">Quản lý email và lời nhắc</a>. Đây là email tự động, vui lòng không trả lời.</p></td></tr>
 </table></td></tr></table></body></html>`;
  return { subject: payload.title, html, text };
}
