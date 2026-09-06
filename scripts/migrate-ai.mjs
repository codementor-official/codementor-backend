import { MongoClient } from 'mongodb';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const schemaDir = '../../codementor-infra/database/mongo/schemas';
const definitions = [
  ...require(`${schemaDir}/07-ai-rag.js`).definitions,
  ...require(`${schemaDir}/08-ai-agent-sessions.js`).definitions,
  ...require(`${schemaDir}/09-ai-documents.js`).definitions,
];
if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
try {
  await client.connect();
  const db = client.db(process.env.MONGO_DB || 'codementor');
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name));
  for (const definition of definitions) {
    const validator = { $jsonSchema: definition.schema };
    if (names.has(definition.name)) {
      await db.command({ collMod: definition.name, validator, validationLevel: 'strict' });
    } else {
      await db.createCollection(definition.name, { validator, validationLevel: 'strict' });
    }
    for (const [keys, options] of definition.indexes) await db.collection(definition.name).createIndex(keys, options);
    console.log(`${definition.name}: validator and indexes ready`);
  }
} finally { await client.close(); }
