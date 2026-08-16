import { Global, Module } from '@nestjs/common';
import { IDENTITY_PROVISIONING } from './identity-provisioning.port';
import { RemoteIdentityProvisioning } from './remote-identity.provisioning';

/**
 * Import ở 8 service KHÔNG sở hữu bảng `users`. core-service KHÔNG import cái này —
 * nó đã có `IdentityModule` phân giải tại chỗ.
 */
@Global()
@Module({
  providers: [
    RemoteIdentityProvisioning,
    { provide: IDENTITY_PROVISIONING, useExisting: RemoteIdentityProvisioning },
  ],
  exports: [IDENTITY_PROVISIONING],
})
export class RemoteIdentityModule {}
