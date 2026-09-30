import { randomUUID } from 'node:crypto';
import { TOPICS } from '@codementor/contracts';
import type { Tx } from './commerce.store';
/** Transactional outbox: rollback of money state also rolls back its notification. */
export async function notifyCommerce(
  tx: Tx,
  userId: string,
  entityId: string,
  title: string,
  message: string,
  actionUrl: string,
) {
  const [user] = await tx.$queryRaw<
    { external_id: string | null }[]
  >`SELECT external_id::text FROM users WHERE id=${userId}::uuid`;
  if (!user?.external_id) return;
  const eventId = randomUUID();
  const topic = TOPICS.COMMERCE_UPDATED;
  const envelope = {
    eventId,
    eventName: topic,
    occurredAt: new Date().toISOString(),
    correlationId: entityId,
    producer: 'learning-service',
    payload: { recipientExternalId: user.external_id, title, message, actionUrl, entityId },
  };
  await tx.$executeRaw`INSERT INTO outbox(id,topic,partition_key,payload) VALUES (${eventId}::uuid,${topic},${user.external_id},${JSON.stringify(envelope)}::jsonb)`;
}
