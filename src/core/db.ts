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
  // --- audit_logs migrations ---
  const auditCols = db.pragma('table_info(audit_logs)') as Array<{ name: string }>;
  // No columns = table doesn't exist yet (fresh DB, init hasn't run). Skip migration.
  if (auditCols.length > 0) {
    const auditColNames = new Set(auditCols.map(c => c.name));
    if (!auditColNames.has('prev_hash')) {
      db.exec('ALTER TABLE audit_logs ADD COLUMN prev_hash TEXT');
    }
    if (!auditColNames.has('entry_hash')) {
      db.exec('ALTER TABLE audit_logs ADD COLUMN entry_hash TEXT');
    }
    if (!auditColNames.has('wallet_address')) {
      db.exec('ALTER TABLE audit_logs ADD COLUMN wallet_address TEXT');
    }
    if (!auditColNames.has('home_dir')) {
      db.exec('ALTER TABLE audit_logs ADD COLUMN home_dir TEXT');
    }
    if (!auditColNames.has('chain_name')) {
      db.exec('ALTER TABLE audit_logs ADD COLUMN chain_name TEXT');
    }
    if (!auditColNames.has('chain_id')) {
      db.exec('ALTER TABLE audit_logs ADD COLUMN chain_id INTEGER');
    }
  }

  // --- operations migrations (v0.3: multi-chain) ---
  const opsCols = db.pragma('table_info(operations)') as Array<{ name: string }>;
  if (opsCols.length > 0) {
    const opsColNames = new Set(opsCols.map(c => c.name));
    if (!opsColNames.has('chain_name')) {
      db.exec("ALTER TABLE operations ADD COLUMN chain_name TEXT DEFAULT 'Polygon'");
    }
    if (!opsColNames.has('chain_id')) {
      db.exec('ALTER TABLE operations ADD COLUMN chain_id INTEGER DEFAULT 137');
    }
  }

  // --- wallets migrations (v0.4: HD wallet / Solana) ---
  const walletCols = db.pragma('table_info(wallets)') as Array<{ name: string }>;
  if (walletCols.length > 0) {
    const walletColNames = new Set(walletCols.map(c => c.name));
    if (!walletColNames.has('key_type')) {
      db.exec("ALTER TABLE wallets ADD COLUMN key_type TEXT DEFAULT 'legacy'");
    }
    if (!walletColNames.has('encrypted_mnemonic')) {
      db.exec('ALTER TABLE wallets ADD COLUMN encrypted_mnemonic TEXT');
    }
    if (!walletColNames.has('encrypted_solana_key')) {
      db.exec('ALTER TABLE wallets ADD COLUMN encrypted_solana_key TEXT');
    }
    if (!walletColNames.has('solana_address')) {
      db.exec('ALTER TABLE wallets ADD COLUMN solana_address TEXT');
    }
  }

  // --- security_blacklist migration ---
  db.exec(`CREATE TABLE IF NOT EXISTS security_blacklist (
    address TEXT PRIMARY KEY,
    chain TEXT,
    reason TEXT,
    added_at TEXT NOT NULL
  )`);

  // --- settings migration: ensure existing v0.2 users keep polygon as default ---
  try {
    const hasInit = db.prepare("SELECT value FROM settings WHERE key='initialized_at'").get();
    if (hasInit) {
      const hasDefault = db.prepare("SELECT value FROM settings WHERE key='default_chain'").get();
      if (!hasDefault) {
        db.prepare("INSERT INTO settings(key,value) VALUES('default_chain','polygon')").run();
      }
    }
  } catch { /* settings table may not exist yet */ }
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
