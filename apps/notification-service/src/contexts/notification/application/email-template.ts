import type { EmailCategory, EmailPayload, Recipient, ReminderType } from '../domain/model/reminder';

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Brand: ink and orange only, the same two hues as the web app. */
const INK = '#18181b';
const ORANGE = '#ea580c';
const ORANGE_DARK = '#c2410c';
const TINT = '#fff7ed';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? 'codementor.official@gmail.com';

const CATEGORY: Record<EmailCategory, { label: string; why: string }> = {
  assignment: { label: 'Bài tập', why: 'Bạn đang bật “Email bài tập” trong cài đặt tài khoản.' },
  deadline: { label: 'Nhắc hạn nộp', why: 'Bạn đang bật “Nhắc hạn nộp qua email” trong cài đặt tài khoản.' },
  learning: { label: 'Học tập', why: 'Bạn đang bật “Email học tập” trong cài đặt tài khoản.' },
  workspace: { label: 'Nhóm học tập', why: 'Bạn đang bật “Email cập nhật Workspace” trong cài đặt tài khoản.' },
  system: { label: 'Thông báo hệ thống', why: 'Bạn đang bật “Email thông báo hệ thống” trong cài đặt tài khoản.' },
  billing: { label: 'Gói & thanh toán', why: 'Email về thanh toán, hoàn tiền và thời hạn gói luôn được gửi cho chủ tài khoản.' },
};

/** One sentence that says why this email matters, and one that says what to do next. */
const COPY: Partial<Record<ReminderType, { lead: string; next?: string }>> = {
  ASSIGNMENT_ASSIGNED: { lead: 'Bạn vừa được giao một bài tập mới.', next: 'Đọc đề, chạy thử với ví dụ mẫu rồi nộp bài trước hạn.' },
  DEADLINE_24H: { lead: 'Bài tập của bạn sẽ hết hạn trong khoảng 24 giờ nữa.', next: 'Nộp sớm để còn thời gian sửa nếu bài chưa đạt.' },
  DEADLINE_6H: { lead: 'Chỉ còn khoảng 6 giờ trước khi bài tập hết hạn.', next: 'Nộp bản tốt nhất bạn có ngay bây giờ; bạn vẫn có thể nộp lại nếu nhóm cho phép.' },
  ASSIGNMENT_OVERDUE: { lead: 'Bài tập đã quá hạn nộp.', next: 'Nếu nhóm cho phép nộp muộn, bạn vẫn có thể hoàn thành bài này.' },
  RETRY_EXERCISE: { lead: 'Bài nộp gần nhất chưa đạt, bạn còn lượt để làm lại.', next: 'Xem các test chưa qua rồi thử lại.' },
  DEADLINE_CHANGED: { lead: 'Hạn nộp của một bài tập vừa được thay đổi.', next: 'Kiểm tra lại kế hoạch học của bạn với hạn mới.' },
  WORKSPACE_JOIN_APPROVED: { lead: 'Yêu cầu tham gia nhóm học tập của bạn đã được chấp nhận.', next: 'Vào nhóm để xem tài liệu và bài tập đang có.' },
  WORKSPACE_JOIN_REJECTED: { lead: 'Yêu cầu tham gia nhóm học tập của bạn chưa được chấp nhận.' },
  WORKSPACE_MEMBER_ADDED: { lead: 'Bạn vừa được thêm vào một nhóm học tập.', next: 'Vào nhóm để làm quen với thành viên và tài liệu.' },
  WORKSPACE_DOCUMENT_PENDING: { lead: 'Có tài liệu mới đang chờ bạn duyệt.', next: 'Duyệt sớm để thành viên trong nhóm dùng được tài liệu.' },
  WORKSPACE_DOCUMENT_PUBLISHED: { lead: 'Nhóm học tập của bạn vừa có tài liệu mới.' },
  WORKSPACE_DOCUMENT_REJECTED: { lead: 'Tài liệu bạn gửi chưa được duyệt.', next: 'Xem lý do, chỉnh sửa rồi gửi lại.' },
  WORKSPACE_EXERCISE_UPDATED: { lead: 'Một bài tập trong nhóm vừa được cập nhật.' },
  LEARNING_REMINDER: { lead: 'Đã một thời gian bạn chưa quay lại khóa học.', next: 'Chỉ 15 phút mỗi ngày cũng giúp bạn giữ nhịp học.' },
  STUDY_SESSION_REMINDER: { lead: 'Đến giờ học theo lịch bạn đã đặt.', next: 'Mở bài đang học dở và bắt đầu ngay.' },
  COURSE_COMPLETED: { lead: 'Chúc mừng! Bạn đã hoàn thành một khóa học.', next: 'Thử sức với bài luyện tập hoặc khóa học tiếp theo trong lộ trình.' },
  SYSTEM_ANNOUNCEMENT: { lead: 'CodeMentor có thông báo mới dành cho bạn.' },
  BILLING_UPDATE: { lead: 'Gói Workspace của bạn vừa có thay đổi.', next: 'Xem chi tiết hoá đơn và thời hạn gói ở trang Gói & thanh toán.' },
};

export interface EmailKind {
  type: ReminderType;
  category: EmailCategory;
}

/**
 * Every reminder email: brand header with logo, what happened, what to do, one button, and a
 * footer that says why it was sent and how to stop it. Table layout and inline styles only —
 * that is what email clients render reliably.
 */
export function renderEmail(payload: EmailPayload, user: Recipient, baseUrl: string, kind?: EmailKind) {
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
  const logo = new URL('/brand-mark-dark.png', base).href;
  const category = kind ? CATEGORY[kind.category] : null;
  const copy = kind ? COPY[kind.type] : undefined;
  const year = new Date().getFullYear();
  const e = escapeHtml;

  const text = [
    'CodeMentor — Học tốt hơn, lập trình tự tin hơn',
    category ? `[${category.label}] ${payload.title}` : payload.title,
    '',
    `Chào ${user.display_name},`,
    copy?.lead,
    payload.message,
    due ? `Hạn nộp: ${due}` : null,
    copy?.next,
    '',
    `${payload.actionLabel}: ${action.href}`,
    '',
    category?.why,
    `Quản lý email: ${settings}`,
    `Hỗ trợ: ${SUPPORT_EMAIL} · ${base.origin}`,
  ]
    .filter((line) => line !== undefined && line !== null)
    .join('\n');

  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(payload.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;color:${INK};font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${e(copy?.lead ?? payload.message)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${LINE}">
 <tr><td style="background:${INK};padding:20px 28px">
  <table role="presentation" cellspacing="0" cellpadding="0"><tr>
   <td style="vertical-align:middle"><img src="${e(logo)}" width="40" height="40" alt="CodeMentor" style="display:block;border:0"></td>
   <td style="vertical-align:middle;padding-left:12px">
    <div style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.2px">Code<span style="color:${ORANGE}">Mentor</span></div>
    <div style="font-size:11px;color:#a1a1aa;letter-spacing:1px;text-transform:uppercase">Học tốt hơn · Lập trình tự tin hơn</div>
   </td></tr></table>
 </td></tr>
 <tr><td style="height:4px;background:${ORANGE};line-height:4px;font-size:0">&nbsp;</td></tr>
 <tr><td style="padding:28px 28px 8px">
  ${category ? `<span style="display:inline-block;background:${TINT};color:${ORANGE_DARK};font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;letter-spacing:0.3px">${e(category.label)}</span>` : ''}
  <h1 style="font-size:22px;line-height:1.35;margin:14px 0 18px;color:${INK}">${e(payload.title)}</h1>
  <p style="margin:0 0 12px;font-size:15px;line-height:1.7">Chào <strong>${e(user.display_name)}</strong>,</p>
  ${copy ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.7">${e(copy.lead)}</p>` : ''}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fafafa;border:1px solid ${LINE};border-left:4px solid ${ORANGE};border-radius:8px">
   <tr><td style="padding:14px 16px;font-size:15px;line-height:1.7;color:${INK}">${e(payload.message).replace(/\n/g, '<br>')}
   ${due ? `<div style="margin-top:8px;font-size:14px"><strong>Hạn nộp:</strong> <span style="color:${ORANGE_DARK};font-weight:700">${e(due)}</span></div>` : ''}</td></tr>
  </table>
  ${copy?.next ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.7;color:${MUTED}">${e(copy.next)}</p>` : ''}
 </td></tr>
 <tr><td style="padding:22px 28px 6px">
  <a href="${e(action.href)}" style="display:inline-block;background:${ORANGE};color:#ffffff;font-size:15px;font-weight:700;padding:13px 24px;border-radius:8px;text-decoration:none">${e(payload.actionLabel)} &rarr;</a>
 </td></tr>
 <tr><td style="padding:10px 28px 26px;font-size:12px;line-height:1.6;color:${MUTED}">
  Nút không hoạt động? Mở liên kết này: <a href="${e(action.href)}" style="color:${ORANGE_DARK};word-break:break-all">${e(action.href)}</a>
 </td></tr>
 <tr><td style="padding:18px 28px;background:#fafafa;border-top:1px solid ${LINE};font-size:12px;line-height:1.7;color:${MUTED}">
  ${category ? `${e(category.why)} ` : 'Bạn nhận email này theo cấu hình tài khoản CodeMentor. '}<a href="${e(settings)}" style="color:${ORANGE_DARK}">Quản lý email và lời nhắc</a>.<br>
  Đây là email tự động, vui lòng không trả lời. Cần hỗ trợ? Liên hệ <a href="mailto:${e(SUPPORT_EMAIL)}" style="color:${ORANGE_DARK}">${e(SUPPORT_EMAIL)}</a>.
 </td></tr>
 <tr><td style="padding:16px 28px 22px;background:${INK};font-size:12px;line-height:1.7;color:#a1a1aa">
  <strong style="color:#ffffff">CodeMentor</strong> — nền tảng học lập trình với lộ trình rõ ràng, bài tập chấm tự động, trợ lý AI và nhóm học tập.<br>
  <a href="${e(base.origin)}" style="color:${ORANGE}">${e(base.host)}</a> · © ${year} CodeMentor
 </td></tr>
</table></td></tr></table></body></html>`;
  return { subject: category ? `[CodeMentor] ${payload.title}` : payload.title, html, text };
}
