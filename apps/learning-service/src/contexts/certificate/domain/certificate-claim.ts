import { randomInt } from 'node:crypto';

/**
 * Tên in trên chứng chỉ. Cùng luật "tên người" đã chốt cho form (2–80 ký tự; chữ cái mọi ngôn
 * ngữ, khoảng trắng, `.`, `'`, `-`). Trả `null` khi không hợp lệ — người gọi báo lỗi.
 */
export function normalizeRecipientName(input: string): string | null {
  const name = input.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) return null;
  return /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(name) ? name : null;
}

/** Không có 0/O/1/I: mã được đọc to và gõ lại bằng tay. 32 ký tự × 10 = 50 bit. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateCertificateCode(): string {
  let code = '';
  for (let i = 0; i < 10; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export const CERTIFICATE_CODE = /^[0-9A-Z]{10}$/;
