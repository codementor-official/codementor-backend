import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListCoursesQueryDto } from '../../../../../learning-service/src/contexts/learning/presentation/dto/course.dto';
import { ListWorkspacesQueryDto } from '../../../../../workspace-service/src/contexts/workspace/presentation/dto/workspace.dto';

// These DTO tests do not exercise remote JWT key discovery.
jest.mock('jwks-rsa', () => ({ passportJwtSecret: jest.fn() }));

const first = '41000000-0000-4000-8000-000000000001';
const second = '41000000-0000-4000-8000-000000000002';

describe.each([ListCoursesQueryDto, ListWorkspacesQueryDto])('%p targeted catalogue queries', (Dto) => {
  const parse = (input: Record<string, unknown>) => plainToInstance(
    Dto as typeof ListCoursesQueryDto, input, { enableImplicitConversion: true },
  );
  it('accepts a bounded comma-separated ID list', async () => {
    const dto = parse({ ids: `${first},${second}`, limit: '10' });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto.ids).toEqual([first, second]);
  });
  it.each(['', 'invalid', `${first},invalid`, Array(21).fill(first).join(',')])('rejects malformed/unbounded IDs: %s', async (ids) => {
    expect((await validate(parse({ ids }))).length).toBeGreaterThan(0);
  });
  it('does not accept a caller supplied userId', async () => {
    expect((await validate(parse({ userId: first }), { whitelist: true, forbidNonWhitelisted: true })).length).toBeGreaterThan(0);
  });
});
