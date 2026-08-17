#!/usr/bin/env node
// Đọc nhanh collection notifications — chỉ dùng lúc phát triển/kiểm thử.
import { MongoClient } from "mongodb";
import "dotenv/config";

const client = new MongoClient(process.env.MONGO_URI);
await client.connect();
const db = client.db(process.env.MONGO_DB ?? "codementor");
const docs = await db.collection("notifications").find({}).sort({ createdAt: -1 }).limit(10).toArray();
console.log(`tổng: ${await db.collection("notifications").countDocuments({})}, đã đọc: ${await db.collection("notification_reads").countDocuments({})}`);
for (const d of docs) {
  console.log(`\n[${d.type}] ${d.title}\n  ${d.message}\n  CTA: ${d.actionLabel ?? "—"} -> ${d.actionUrl ?? "—"}\n  eventId=${d.eventId}  ref=${d.referenceType}/${d.referenceId}`);
}
await client.close();
