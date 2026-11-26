import { ModerateExerciseUseCase } from './moderate-exercise.usecase';
import { Exercise } from '../domain/model/exercise';
import { Slug } from '../domain/model/slug';
import type { AuthenticatedUser } from '@codementor/platform';

// Không nạp JWT adapter (jwks-rsa kéo theo jose chỉ có ESM).
jest.mock('@codementor/platform', () => ({ ContentAuthorLookup: class {} }));

describe('ModerateExerciseUseCase.approveWithCourse', () => {
  const admin: AuthenticatedUser = {
    id: '00000000-0000-4000-8000-000000000009', externalId: 'kc', displayName: 'Admin', role: 'admin', actorType: 'human',
  };
  const full = {
    statement: 'đề bài',
    languages: [{ id: 'py', label: 'Python', referenceSolution: 'x' }],
    testCases: [
      { order: 1, input: 'a', expected: 'b', visibility: 'public' },
      { order: 2, input: 'c', expected: 'd', visibility: 'hidden' },
      { order: 3, input: 'e', expected: 'f', visibility: 'hidden' },
    ],
  };

  const draft = () => {
    const slug = Slug.create('bai-trong-khoa').value;
    const exercise = Exercise.create({ id: 'e1', slug, title: 'Bài trong khoá', kind: 'code', difficulty: 'easy', authorId: 'u1' }).value;
    exercise.attachContent('ref');
    return exercise;
  };

  const build = (exercise: Exercise, content: unknown = full) => {
    const save = jest.fn();
    const useCase = new ModerateExerciseUseCase(
      { findById: jest.fn().mockResolvedValue(exercise), save } as never,
      { publish: jest.fn() } as never,
      { find: jest.fn().mockResolvedValue(null) } as never,
      { findByExerciseId: jest.fn().mockResolvedValue(content) } as never,
    );
    return { useCase, save };
  };

  it('bài nháp đủ nội dung thì được công khai', async () => {
    const exercise = draft();
    const { useCase, save } = build(exercise);
    await useCase.approveWithCourse(admin, 'e1');
    expect(exercise.status).toBe('published');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('bài bị trả về cũng được công khai', async () => {
    const exercise = draft();
    exercise.submit();
    exercise.moderate('reject', 'thiếu');
    const { useCase } = build(exercise);
    await useCase.approveWithCourse(admin, 'e1');
    expect(exercise.status).toBe('published');
  });

  it('bài thiếu test case thì từ chối, không lưu', async () => {
    const exercise = draft();
    const { useCase, save } = build(exercise, { ...full, testCases: [] });
    await expect(useCase.approveWithCourse(admin, 'e1')).rejects.toThrow('test case');
    expect(save).not.toHaveBeenCalled();
  });

  it('bài đã công khai thì bỏ qua', async () => {
    const exercise = draft();
    exercise.submit();
    exercise.moderate('approve', null);
    const { useCase, save } = build(exercise);
    await useCase.approveWithCourse(admin, 'e1');
    expect(save).not.toHaveBeenCalled();
  });

  it('bài đã bị gỡ thì không tự bật lại', async () => {
    const exercise = draft();
    exercise.submit();
    exercise.moderate('approve', null);
    exercise.moderate('archive', 'vi phạm');
    const { useCase, save } = build(exercise);
    await expect(useCase.approveWithCourse(admin, 'e1')).rejects.toThrow('đã bị gỡ');
    expect(save).not.toHaveBeenCalled();
  });

  it('chỉ admin', async () => {
    const { useCase } = build(draft());
    await expect(useCase.approveWithCourse({ ...admin, role: 'lecturer' }, 'e1')).rejects.toThrow();
  });
});
