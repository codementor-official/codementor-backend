import { renderPlaceholders, unknownPlaceholders, validateDesign } from './certificate-design';

const valid = {
  version: 1,
  layout: 'classic',
  accent: 'orange',
  heading: '  Chứng nhận hoàn thành ',
  body: 'Chứng nhận {{learnerName}} đã hoàn thành {{subjectTitle}}.',
  signerName: '{{instructorName}}',
  fields: [{ label: 'Mã', value: '{{certificateCode}}' }],
  extra: 'dropped',
};

describe('validateDesign', () => {
  it('accepts a valid design, trims text and drops unknown keys', () => {
    const { design, errors } = validateDesign(valid);
    expect(errors).toEqual([]);
    expect(design?.heading).toBe('Chứng nhận hoàn thành');
    expect(design).not.toHaveProperty('extra');
  });

  it('rejects unknown placeholders and unclosed braces', () => {
    const { errors } = validateDesign({ ...valid, body: '{{learnerName}} học {{courseName}} {{oops' });
    expect(errors.join(' ')).toContain('courseName');
    expect(errors.join(' ')).toContain('không đóng');
  });

  it('rejects bad layout, accent, too many fields and non-https images', () => {
    const fields = Array.from({ length: 7 }, () => ({ label: 'a', value: 'b' }));
    const { errors } = validateDesign({
      ...valid,
      layout: 'fancy',
      accent: 'pink',
      fields,
      logoUrl: 'http://x/logo.png',
    });
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe('placeholders', () => {
  it('renders known names and leaves the rest', () => {
    expect(renderPlaceholders('{{ learnerName }} — {{x}}', { learnerName: 'An' })).toBe('An — {{x}}');
  });

  it('lists unknown names only', () => {
    expect(unknownPlaceholders('{{learnerName}} {{foo}}')).toEqual(['foo']);
  });
});
