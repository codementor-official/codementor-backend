import { MongoClient } from 'mongodb';

const uri = process.env.MONGO_URI;
if (!uri) throw new Error('MONGO_URI is required');

const client = new MongoClient(uri);
await client.connect();
try {
  const db = client.db();
  const collection = await db.listCollections({ name: 'notifications' }).next();
  if (!collection) throw new Error('notifications collection does not exist');
  const validator = collection.options?.validator;
  const types = validator?.$jsonSchema?.properties?.type?.enum;
  if (!Array.isArray(types)) throw new Error('notifications type validator is missing');
  for (const type of [
    'WORKSPACE_ASSIGNMENT_DUE_SOON',
    'WORKSPACE_ASSIGNMENT_OVERDUE',
    'WORKSPACE_MESSAGE',
  ]) {
    if (!types.includes(type)) types.push(type);
  }
  await db.command({ collMod: 'notifications', validator, validationLevel: 'strict' });
  console.log('notification schema is ready');
} finally {
  await client.close();
}
