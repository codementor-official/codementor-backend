/**
 * Thiết kế chứng chỉ v1 (ADR 0005): một form, không phải canvas tự do.
 *
 * Luật ở đây có BA bản phải giữ khớp nhau: file này (API là chốt chặn cuối),
 * `codementor-frontend/packages/ui/src/certificate/design.ts` (form báo lỗi trước khi gửi) và
 * `apps/ai-service/app/lecter/certificate.py` (Lecter tự kiểm trước khi đề xuất). Đổi luật thì
 * đổi cả ba.
 */
export const CERTIFICATE_LAYOUTS = ['classic', 'modern', 'minimal'] as const;
export const CERTIFICATE_ACCENTS = ['orange', 'ink', 'emerald', 'blue', 'violet'] as const;

/** Ô điền tự động. Ngoài danh sách này thì từ chối — chữ `{{x}}` in nguyên lên chứng chỉ là lỗi. */
export const CERTIFICATE_PLACEHOLDERS = [
  'learnerName',
  'subjectKind',
  'subjectTitle',
  'instructorName',
  'startedAt',
  'completedAt',
  'durationHours',
  'issuedAt',
  'certificateCode',
] as const;

export type CertificatePlaceholder = (typeof CERTIFICATE_PLACEHOLDERS)[number];
export type CertificateData = Record<CertificatePlaceholder, string>;

export interface CertificateField {
  label: string;
  value: string;
}

export interface CertificateDesign {
  version: 1;
  layout: (typeof CERTIFICATE_LAYOUTS)[number];
  accent: (typeof CERTIFICATE_ACCENTS)[number];
  heading: string;
  body: string;
  signerName: string;
  signerTitle?: string;
  logoUrl?: string;
  signatureUrl?: string;
  fields: CertificateField[];
}

export const MAX_FIELDS = 6;
const LIMITS = {
  heading: [2, 80],
  body: [10, 400],
  signerName: [0, 80],
  signerTitle: [0, 80],
  label: [1, 40],
  value: [1, 120],
  url: [0, 500],
} as const;

const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Mọi placeholder không có trong danh sách, kèm dấu ngoặc lẻ (`{{` không đóng). */
export function unknownPlaceholders(text: string): string[] {
  const unknown = [...text.matchAll(PLACEHOLDER)]
    .map((match) => match[1])
    .filter((name) => !(CERTIFICATE_PLACEHOLDERS as readonly string[]).includes(name));
  const stray = text.replace(PLACEHOLDER, '');
  if (stray.includes('{{') || stray.includes('}}')) unknown.push('{{…}} không đóng');
  return unknown;
}

export function renderPlaceholders(text: string, data: Partial<CertificateData>): string {
  return text.replace(PLACEHOLDER, (whole, name: string) =>
    name in data ? (data[name as CertificatePlaceholder] ?? '') : whole,
  );
}

function text(
  errors: string[],
  label: string,
  value: unknown,
  [min, max]: readonly [number, number],
  optional = false,
): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (optional || min === 0) return undefined;
    errors.push(`${label}: bắt buộc`);
    return undefined;
  }
  if (typeof value !== 'string') {
    errors.push(`${label}: phải là chuỗi`);
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    errors.push(`${label}: dài ${min}–${max} ký tự`);
  }
  const unknown = unknownPlaceholders(trimmed);
  if (unknown.length > 0) errors.push(`${label}: ô điền không hợp lệ ${unknown.join(', ')}`);
  return trimmed;
}

function url(errors: string[], label: string, value: unknown): string | undefined {
  const raw = text(errors, label, value, LIMITS.url, true);
  if (raw === undefined) return undefined;
  if (!/^https:\/\/\S+$/.test(raw)) errors.push(`${label}: phải là đường dẫn https`);
  return raw;
}

/**
 * Kiểm và chuẩn hóa (trim, bỏ trường lạ). Trả `errors` rỗng nghĩa là `design` dùng được.
 * Không kiểm nguồn ảnh: việc đó cần biết kho đối tượng, use case làm.
 */
export function validateDesign(input: unknown): { design?: CertificateDesign; errors: string[] } {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { errors: ['Thiết kế phải là một object'] };
  }
  const raw = input as Record<string, unknown>;
  if (raw.version !== 1) errors.push('version: chỉ hỗ trợ 1');
  if (!CERTIFICATE_LAYOUTS.includes(raw.layout as never)) {
    errors.push(`layout: một trong ${CERTIFICATE_LAYOUTS.join(', ')}`);
  }
  if (!CERTIFICATE_ACCENTS.includes(raw.accent as never)) {
    errors.push(`accent: một trong ${CERTIFICATE_ACCENTS.join(', ')}`);
  }
  const heading = text(errors, 'Tiêu đề', raw.heading, LIMITS.heading);
  const body = text(errors, 'Nội dung', raw.body, LIMITS.body);
  const signerName = text(errors, 'Người ký', raw.signerName, LIMITS.signerName) ?? '';
  const signerTitle = text(errors, 'Chức danh', raw.signerTitle, LIMITS.signerTitle, true);
  const logoUrl = url(errors, 'Logo', raw.logoUrl);
  const signatureUrl = url(errors, 'Chữ ký', raw.signatureUrl);

  // Không bắt buộc {{learnerName}}: bố cục nào cũng tự in tên người nhận cỡ lớn
  // (`CertificateView`), chèn thêm vào nội dung thì tên sẽ hiện hai lần.

  const fields: CertificateField[] = [];
  if (raw.fields !== undefined && !Array.isArray(raw.fields)) {
    errors.push('fields: phải là danh sách');
  } else {
    const list = (raw.fields as unknown[] | undefined) ?? [];
    if (list.length > MAX_FIELDS) errors.push(`fields: tối đa ${MAX_FIELDS} dòng`);
    list.slice(0, MAX_FIELDS).forEach((item, index) => {
      const row = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
      const label = text(errors, `Dòng ${index + 1} — nhãn`, row.label, LIMITS.label);
      const value = text(errors, `Dòng ${index + 1} — giá trị`, row.value, LIMITS.value);
      if (label && value) fields.push({ label, value });
    });
  }

  if (errors.length > 0) return { errors };
  return {
    errors,
    design: {
      version: 1,
      layout: raw.layout as CertificateDesign['layout'],
      accent: raw.accent as CertificateDesign['accent'],
      heading: heading!,
      body: body!,
      signerName,
      ...(signerTitle ? { signerTitle } : {}),
      ...(logoUrl ? { logoUrl } : {}),
      ...(signatureUrl ? { signatureUrl } : {}),
      fields,
    },
  };
}
