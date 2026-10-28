import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SaveLessonContentDto } from './course.dto';

jest.mock('jwks-rsa', () => ({ passportJwtSecret: jest.fn() }));

const credit = {
  title: 'CS50x 2026',
  author: 'David J. Malan, Harvard University',
  sourceUrl: 'https://cs50.harvard.edu/x/',
  license: 'CC BY-NC-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
};

// `sourceUrl`/`licenseUrl` đi thẳng vào `href` ở trang học viên — đây là chốt chặn duy nhất.
describe('SaveLessonContentDto.attribution', () => {
  const errors = (attribution: unknown) =>
    validate(plainToInstance(SaveLessonContentDto, { media: { url: 'https://www.youtube.com/watch?v=UuIEbpQms8o' }, attribution }),
      { whitelist: true, forbidNonWhitelisted: true });

  it('accepts a complete credit line', async () => {
    expect(await errors({ ...credit, changes: 'Sắp xếp lại thành chương.' })).toEqual([]);
  });

  it.each(['title', 'author', 'sourceUrl', 'license', 'licenseUrl'])('rejects a credit without %s', async (key) => {
    const partial: Record<string, string> = { ...credit };
    delete partial[key];
    expect((await errors(partial)).length).toBeGreaterThan(0);
  });

  it.each(['javascript:alert(1)', 'ftp://example.com/x', 'cs50.harvard.edu'])('rejects a non-http(s) link: %s', async (url) => {
    expect((await errors({ ...credit, sourceUrl: url })).length).toBeGreaterThan(0);
    expect((await errors({ ...credit, licenseUrl: url })).length).toBeGreaterThan(0);
  });
});
