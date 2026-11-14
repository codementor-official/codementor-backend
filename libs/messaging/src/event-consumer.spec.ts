jest.mock('jwks-rsa', () => ({ passportJwtSecret: jest.fn() }));
import { randomUUID } from 'node:crypto';
import { TOPICS, type EventEnvelope } from '@codementor/contracts';
import { EventConsumer } from './event-consumer';

/**
 * TC-07: Kafka giao lại cùng một sự kiện kết quả chấm (at-least-once) thì handler chỉ chạy
 * một lần. Bảng `processed_events` được giả bằng một Set có cùng khoá chính
 * (consumer, event_id), nên INSERT trùng trả về 0 hàng như ON CONFLICT DO NOTHING thật.
 */
function harness(processed = new Set<string>()) {
  const key = (values: unknown[]) => `${values[0]}|${values[1]}`;
  const prisma = {
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('INSERT INTO processed_events')) {
        if (processed.has(key(values))) return 0;
        processed.add(key(values));
        return 1;
      }
      if (sql.includes('DELETE FROM processed_events')) {
        processed.delete(key(values));
        return 1;
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
    $queryRaw: jest.fn(async (_s: TemplateStringsArray, ...values: unknown[]) => [
      { present: processed.has(key(values)) },
    ]),
  };
  let eachMessage!: (m: { topic: string; message: { value: Buffer } }) => Promise<void>;
  const kafka = {
    ensureTopics: jest.fn(async () => undefined),
    createConsumer: () => ({
      connect: async () => undefined,
      subscribe: async () => undefined,
      run: async (opts: { eachMessage: typeof eachMessage }) => {
        eachMessage = opts.eachMessage;
      },
    }),
  };
  const consumer = new EventConsumer(kafka as never, prisma as never);
  const deliver = (envelope: EventEnvelope<unknown>) =>
    eachMessage({
      topic: TOPICS.SUBMISSION_EVALUATED,
      message: { value: Buffer.from(JSON.stringify(envelope)) },
    });
  return { consumer, deliver, processed };
}

function evaluated(): EventEnvelope<unknown> {
  return {
    eventId: randomUUID(),
    correlationId: randomUUID(),
    payload: { submissionId: randomUUID(), userId: randomUUID(), exerciseId: randomUUID(), accepted: true, score: 100 },
  } as unknown as EventEnvelope<unknown>;
}

describe('EventConsumer: khử trùng sự kiện kết quả chấm (TC-07)', () => {
  const OLD = process.env.KAFKA_CONSUME;
  beforeAll(() => delete process.env.KAFKA_CONSUME);
  afterAll(() => (process.env.KAFKA_CONSUME = OLD));

  it('giao lại cùng eventId hai lần thì handler chỉ chạy một lần', async () => {
    const { consumer, deliver } = harness();
    const handler = jest.fn(async () => undefined);
    consumer.on(TOPICS.SUBMISSION_EVALUATED, handler);
    await consumer.start('exercise-service');

    const event = evaluated();
    await deliver(event);
    await deliver(event);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('hai sự kiện khác eventId đều được xử lý', async () => {
    const { consumer, deliver } = harness();
    const handler = jest.fn(async () => undefined);
    consumer.on(TOPICS.SUBMISSION_EVALUATED, handler);
    await consumer.start('exercise-service');

    await deliver(evaluated());
    await deliver(evaluated());

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('handler lỗi thì nhả dấu, lần giao lại chạy được và chỉ thành công một lần', async () => {
    const { consumer, deliver, processed } = harness();
    const handler = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('DB tạm lỗi'))
      .mockResolvedValue(undefined);
    consumer.on(TOPICS.SUBMISSION_EVALUATED, handler);
    await consumer.start('exercise-service');

    const event = evaluated();
    await expect(deliver(event)).rejects.toThrow('DB tạm lỗi');
    expect(processed.size).toBe(0);
    await deliver(event);
    await deliver(event);

    expect(handler).toHaveBeenCalledTimes(2); // 1 lần lỗi + 1 lần thành công, lần thứ ba bị bỏ qua
    expect(processed.size).toBe(1);
  });

  it('mỗi consumer giữ dấu riêng: cùng sự kiện vẫn tới được service khác', async () => {
    const a = harness();
    const handlerA = jest.fn(async () => undefined);
    a.consumer.on(TOPICS.SUBMISSION_EVALUATED, handlerA);
    await a.consumer.start('exercise-service');
    const event = evaluated();
    await a.deliver(event);

    // Cùng bảng processed_events, consumer khác tên.
    const b = harness(a.processed);
    const handlerB = jest.fn(async () => undefined);
    b.consumer.on(TOPICS.SUBMISSION_EVALUATED, handlerB);
    await b.consumer.start('learning-service');
    await b.deliver(event);

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
  });
});
