import { CertificateUseCases } from './certificate.usecases';

jest.mock('@codementor/platform', () => ({ requireHumanId: (u: { id: string }) => u.id }));
jest.mock('../infrastructure/certificate.store', () => ({ CertificateStore: class {} }));

const QUERY = { sort: 'newest' as const, page: 1, limit: 10 };
const COURSE = '3f1c2a9e-1b2c-4d5e-8f90-123456789abc';
const lecturer = { id: 'u-lecturer', externalId: 'x', displayName: 'L', role: 'lecturer' } as never;
const admin = { id: 'u-admin', externalId: 'y', displayName: 'A', role: 'admin' } as never;

function setup(owns: boolean) {
  const store = {
    owns: jest.fn(async () => owns),
    completions: jest.fn(async () => ({
      items: [{ userId: 'u1', name: 'An', email: 'an@x.test', startedAt: null, completedAt: new Date(), certificate: null }],
      total: 1, completed: 1, claimed: 0,
    })),
  };
  return { store, useCases: new CertificateUseCases(store as never) };
}

describe('Course completions', () => {
  it('lists learners for the course author or instructor', async () => {
    const { useCases } = setup(true);
    await expect(useCases.completions(lecturer, 'course', COURSE, QUERY)).resolves.toMatchObject({ total: 1, page: 1, items: [{ name: 'An' }] });
  });
  it('hides another lecturer\'s course as not found', async () => {
    const { useCases, store } = setup(false);
    await expect(useCases.completions(lecturer, 'course', COURSE, QUERY)).rejects.toThrow();
    expect(store.completions).not.toHaveBeenCalled();
  });
  it('lets an administrator see any course without the ownership check', async () => {
    const { useCases, store } = setup(false);
    await expect(useCases.completions(admin, 'course', COURSE, QUERY)).resolves.toMatchObject({ total: 1, page: 1, items: [{ name: 'An' }] });
    expect(store.owns).not.toHaveBeenCalled();
  });
});
