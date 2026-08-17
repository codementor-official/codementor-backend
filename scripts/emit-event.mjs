#!/usr/bin/env node
// Phát một domain event lên Kafka bằng tay — dùng để thử luồng consumer mà không phải
// dựng đủ producer service.
//
//   node scripts/emit-event.mjs evt.course.published.v1 '{"courseId":"...","slug":"..."}'
//   node scripts/emit-event.mjs evt.course.published.v1 '{...}' <eventId>
//
// Truyền `eventId` để phát LẠI đúng một event: đó là cách kiểm khử trùng lặp — Kafka
// giao lại message là chuyện bình thường, và consumer phải chịu được.
import { randomUUID } from "node:crypto";
import { Kafka } from "kafkajs";
import "dotenv/config";

const [topic, payloadJson, eventIdArg] = process.argv.slice(2);

if (!topic || !payloadJson) {
  console.error("dùng: node scripts/emit-event.mjs <topic> '<payload json>' [eventId]");
  process.exit(1);
}

const kafka = new Kafka({
  clientId: "emit-event",
  brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
});

const producer = kafka.producer();
await producer.connect();

const eventId = eventIdArg ?? randomUUID();
// Đúng hình dạng `EventEnvelope` ở libs/contracts — consumer đọc `payload`, không phải
// `data`, và khử trùng lặp theo `eventId`.
const envelope = {
  eventId,
  eventName: topic,
  occurredAt: new Date().toISOString(),
  correlationId: randomUUID(),
  producer: "emit-event",
  payload: JSON.parse(payloadJson),
};

await producer.send({ topic, messages: [{ value: JSON.stringify(envelope) }] });
await producer.disconnect();

console.log(`đã phát ${topic} (eventId=${eventId})`);
