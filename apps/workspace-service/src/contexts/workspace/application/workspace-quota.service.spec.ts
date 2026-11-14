jest.mock('jwks-rsa', () => ({ passportJwtSecret: jest.fn() }));
import { WorkspaceQuotaService } from './workspace-quota.service';
import { uploadProblem, type OwnerUsage } from '../domain/model/workspace-quota';

/**
 * TC-12: upload bị gián đoạn trước khi xác nhận. Chỗ giữ dung lượng hết hạn thì janitor xoá
 * object rác và xoá chỗ giữ; object đã thành tài liệu (xác nhận đúng lúc) thì không bị xoá.
 */
function setup(reservations: { id: string; objectKey: string }[], inUse: string[] = []) {
  const quota = {
    expiredReservations: jest.fn(async () => reservations),
    isDocumentKeyInUse: jest.fn(async (key: string) => inUse.includes(key)),
    deleteReservation: jest.fn(async () => undefined),
  };
  const storage = { deleteObject: jest.fn(async () => undefined) };
  const service = new WorkspaceQuotaService(quota as never, storage as never, {} as never);
  return { service, quota, storage };
}

describe('WorkspaceQuotaService.releaseAbandonedUploads (TC-12)', () => {
  it('upload bỏ dở: xoá object rác rồi xoá chỗ giữ dung lượng', async () => {
    const { service, quota, storage } = setup([{ id: 'r1', objectKey: 'workspaces/g/a.pdf' }]);
    await service.releaseAbandonedUploads();
    expect(storage.deleteObject).toHaveBeenCalledWith('workspaces/g/a.pdf');
    expect(quota.deleteReservation).toHaveBeenCalledWith('r1');
  });

  it('object đã thành tài liệu thì giữ object, chỉ xoá chỗ giữ', async () => {
    const { service, quota, storage } = setup(
      [{ id: 'r2', objectKey: 'workspaces/g/b.pdf' }],
      ['workspaces/g/b.pdf'],
    );
    await service.releaseAbandonedUploads();
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(quota.deleteReservation).toHaveBeenCalledWith('r2');
  });

  it('lỗi kho lưu trữ không làm sập tiến trình dọn', async () => {
    const { service, storage } = setup([{ id: 'r3', objectKey: 'workspaces/g/c.pdf' }]);
    storage.deleteObject.mockRejectedValueOnce(new Error('S3 timeout'));
    await expect(service.releaseAbandonedUploads()).resolves.toBeUndefined();
  });
});

describe('Hạn mức dung lượng tính cả byte đang giữ chỗ (TC-12)', () => {
  const entitlements = { maxStorageBytes: 100, maxUploadBytes: 100, planName: 'Plus' } as never;
  const usage = (reservedBytes: number): OwnerUsage =>
    ({ ownedGroups: 1, storedBytes: 60, reservedBytes }) as OwnerUsage;

  it('chỗ giữ còn hạn chiếm dung lượng: upload mới vượt phần còn lại bị từ chối', () => {
    expect(uploadProblem(entitlements, usage(30), 20)).not.toBeNull();
  });

  it('chỗ giữ đã hết hạn không còn được đếm: cùng upload đó được nhận', () => {
    // Truy vấn usage chỉ cộng reservation có expires_at > now(), nên hết hạn = reservedBytes 0.
    expect(uploadProblem(entitlements, usage(0), 20)).toBeNull();
  });
});
