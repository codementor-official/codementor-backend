// Kiểm tra kênh email SMTP bằng đúng biến môi trường notification-service đọc.
//   node --env-file=.env scripts/check-smtp.mjs              chỉ đăng nhập thử, không gửi gì
//   node --env-file=.env scripts/check-smtp.mjs --send <to>  gửi một thư kiểm tra tới <to>
// Không in mật khẩu hay nội dung phản hồi thô của máy chủ.
import { createTransport } from 'nodemailer';

const e = process.env;
const blank = (key) => !e[key] || !e[key].trim();
const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'].filter(blank);
if (missing.length) {
  console.error(JSON.stringify({ ok: false, missing }));
  process.exit(1);
}
const port = Number(e.SMTP_PORT || 465);
const secure = e.SMTP_SECURE ? e.SMTP_SECURE === 'true' : port === 465;
const from = (e.EMAIL_FROM_ADDRESS || '').trim() || e.SMTP_USER.trim();
const name = (e.EMAIL_FROM_NAME || e.SES_FROM_NAME || 'CodeMentor').trim();
const transport = createTransport({
  host: e.SMTP_HOST.trim(),
  port,
  secure,
  requireTLS: !secure,
  auth: { user: e.SMTP_USER.trim(), pass: e.SMTP_PASSWORD.replace(/\s+/g, '') },
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
});

const summary = {
  provider: e.EMAIL_PROVIDER || 'ses',
  enabled: (e.EMAIL_ENABLED || e.SES_ENABLED || 'false') === 'true',
  host: e.SMTP_HOST.trim(),
  port,
  secure,
  from,
};
try {
  await transport.verify();
  console.log(JSON.stringify({ phase: 'login', ok: true, ...summary }));
} catch (error) {
  console.error(JSON.stringify({ phase: 'login', ok: false, code: error.code, responseCode: error.responseCode }));
  process.exit(1);
}

const sendIndex = process.argv.indexOf('--send');
if (sendIndex !== -1) {
  const to = process.argv[sendIndex + 1];
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    console.error('dùng: --send <địa chỉ email>');
    process.exit(2);
  }
  try {
    const info = await transport.sendMail({
      from: `"${name}" <${from}>`,
      to,
      subject: 'CodeMentor: kiểm tra kênh email',
      text: 'Thư kiểm tra cấu hình SMTP của CodeMentor. Không cần trả lời.',
      html: '<p>Thư kiểm tra cấu hình SMTP của <strong>CodeMentor</strong>. Không cần trả lời.</p>',
    });
    console.log(JSON.stringify({ phase: 'send', ok: true, accepted: info.accepted.length, rejected: info.rejected.length }));
  } catch (error) {
    console.error(JSON.stringify({ phase: 'send', ok: false, code: error.code, responseCode: error.responseCode }));
    process.exitCode = 1;
  }
}
transport.close();
