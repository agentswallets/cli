import fs from 'node:fs';
import Database from 'better-sqlite3';
import { getDbPath, getHomeDir } from './config.js';
import { AppError } from './errors.js';
import { SCHEMA_SQL } from './schema.js';

let dbInstance: Database.Database | null = null;

export function ensureDataDir(): void {
  const dir = getHomeDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.chmodSync(dir, 0o700);
}

export function getDb(): Database.Database {
  ensureDataDir();
  if (!dbInstance) {
    const dbPath = getDbPath();
    dbInstance = new Database(dbPath);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
    dbInstance.pragma('busy_timeout = 3000');
    // Restrict DB file permissions to owner only.
    try { fs.chmodSync(dbPath, 0o600); } catch { /* may not exist yet on first open */ }
    // H-10: Auto-migrate on first open so upgrades don't crash old schemas.
    migrateSchema(dbInstance);
  }
  return dbInstance;
}

export function initDbSchema(): void {
  const db = getDb();
  db.exec(SCHEMA_SQL);
  // migrateSchema is now called automatically in getDb() on first open.
}

function migrateSchema(db: Database.Database): void {
  const cols = db.pragma('table_info(audit_logs)') as Array<{ name: string }>;
  // No columns = table doesn't exist yet (fresh DB, init hasn't run). Skip migration.
  if (cols.length === 0) return;
  const colNames = new Set(cols.map(c => c.name));
  if (!colNames.has('prev_hash')) {
    db.exec('ALTER TABLE audit_logs ADD COLUMN prev_hash TEXT');
  }
  if (!colNames.has('entry_hash')) {
    db.exec('ALTER TABLE audit_logs ADD COLUMN entry_hash TEXT');
  }
}

export function isInitialized(): boolean {
  const db = getDb();
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key='initialized_at'").get() as
      | { value: string }
      | undefined;
    return Boolean(row?.value);
  } catch {
    return false;
  }
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function assertInitialized(): void {
  if (!isInitialized()) {
    throw new AppError('ERR_NOT_INITIALIZED', 'Repository is not initialized. Run `aw init` first.');
  }
}
