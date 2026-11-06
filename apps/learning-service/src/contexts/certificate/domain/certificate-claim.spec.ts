import { CERTIFICATE_CODE, generateCertificateCode, normalizeRecipientName } from './certificate-claim';

describe('normalizeRecipientName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeRecipientName('  Nguyễn   Văn  An ')).toBe('Nguyễn Văn An');
  });

  it("accepts dots, apostrophes and hyphens after the first letter", () => {
    expect(normalizeRecipientName("Mary-Jane O'Neil Jr.")).toBe("Mary-Jane O'Neil Jr.");
  });

  it('rejects digits, symbols, too short and too long', () => {
    expect(normalizeRecipientName('An 2')).toBeNull();
    expect(normalizeRecipientName('<b>An</b>')).toBeNull();
    expect(normalizeRecipientName('A')).toBeNull();
    expect(normalizeRecipientName('a'.repeat(81))).toBeNull();
    expect(normalizeRecipientName('-An')).toBeNull();
  });
});

describe('generateCertificateCode', () => {
  it('matches the database CHECK and avoids ambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCertificateCode();
      expect(code).toMatch(CERTIFICATE_CODE);
      expect(code).not.toMatch(/[01OI]/);
    }
  });
});
