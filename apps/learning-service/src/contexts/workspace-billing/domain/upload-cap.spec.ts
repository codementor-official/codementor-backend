import { capUploadBytes } from './upload-cap';

describe('capUploadBytes', () => {
  it('caps every maxUploadBytes, nested and in arrays, and leaves other fields alone', () => {
    const at = new Date('2026-11-14T00:00:00Z');
    const out = capUploadBytes(
      {
        plans: [{ version: { entitlements: { maxUploadBytes: 500, maxStorageBytes: 1000 } } }],
        entitlements: { maxUploadBytes: 10 },
        protectedEntitlements: null,
        paidThrough: at,
      },
      20,
    );
    expect(out.plans[0].version.entitlements).toEqual({ maxUploadBytes: 20, maxStorageBytes: 1000 });
    expect(out.entitlements.maxUploadBytes).toBe(10);
    expect(out.paidThrough).toBe(at);
  });
});
