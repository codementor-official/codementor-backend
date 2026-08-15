import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EVENT_BUS, type EventBus } from '@codementor/messaging';
import { TOPICS } from '@codementor/contracts';
import type {
  IdentityProvisioning,
  ProvisionUserInput,
} from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { Email } from '../domain/model/email';
import { User } from '../domain/model/user';
import { USER_REPOSITORY, type UserRepository } from '../domain/port/user.repository';

/**
 * Đồng bộ tài khoản Keycloak → hồ sơ nội bộ, chạy ở mỗi request đã xác thực.
 *
 * Lần đầu thì tạo mới; các lần sau chỉ ghi khi có claim thay đổi, để không phát sinh
 * một lượt UPDATE cho mọi request.
 */
@Injectable()
export class ProvisionUserUseCase implements IdentityProvisioning {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async ensureLocalUser(input: ProvisionUserInput): Promise<AuthenticatedUser> {
    const email = Email.create(input.email);
    if (email.isFail) throw email.error;

    let user = await this.users.findByExternalId(input.externalId);

    if (user === null) {
      user = User.provision({
        id: randomUUID(),
        externalId: input.externalId,
        email: email.value,
        displayName: input.displayName,
        emailVerified: input.emailVerified,
        role: input.platformRole,
      });
      await this.users.save(user);

      // Dịch domain event (nội bộ aggregate) sang integration event (hợp đồng giữa service).
      // Hai thứ này KHÁC nhau: domain event có thể đổi tự do vì chỉ service này biết;
      // integration event là hợp đồng công khai, đổi là phải lên version mới.
      user.pullEvents();
      await this.eventBus.publish(TOPICS.USER_PROVISIONED, {
        userId: user.id,
        externalId: user.externalId,
        email: user.email.value,
        displayName: user.displayName,
      });
    } else {
      const changed = user.syncFromProvider({
        email: email.value,
        displayName: input.displayName,
        emailVerified: input.emailVerified,
        role: input.platformRole,
      });
      if (changed) await this.users.save(user);
    }

    // Bị khoá ở phía CodeMentor thì token Keycloak hợp lệ cũng không vào được.
    const access = user.canAccessPlatform();
    if (access.isFail) throw access.error;

    return {
      id: user.id,
      externalId: user.externalId,
      email: user.email.value,
      displayName: user.displayName,
      roles: input.roles,
      actorType: 'human',
      platformRole: user.role,
    };
  }
}
