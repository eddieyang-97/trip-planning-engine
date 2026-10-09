import { embedded, migrate, postgres, schemaVersion } from '../src/database.js';
import { databaseConnection } from '../src/config.js';
const hosted = process.env.APP_MODE === 'hosted';
if (hosted && !process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL');
const db = hosted ? await postgres(databaseConnection(), process.env.DATABASE_CA_FILE)
  : await embedded(process.env.DATA_DIR ?? '.data/postgres');
try { await migrate(db); console.log(`Schema version ${schemaVersion} ready.`); } finally { await db.close(); }
