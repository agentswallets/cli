import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/core/schema.js';

// Old schema without prev_hash/entry_hash columns
const OLD_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL UNIQUE,
  encrypted_private_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS policies (
  wallet_id TEXT PRIMARY KEY,
  daily_limit REAL,
  per_tx_limit REAL,
  max_tx_per_day INTEGER,
  allowed_tokens_json TEXT NOT NULL,
  allowed_addresses_json TEXT NOT NULL,
  require_approval_above REAL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(wallet_id) REFERENCES wallets(id)
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(wallet_id) REFERENCES wallets(id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  wallet_id TEXT,
  action TEXT NOT NULL,
  request_json TEXT NOT NULL,
  decision TEXT NOT NULL,
  result_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  ref_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operations (
  tx_id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  token TEXT,
  amount TEXT,
  to_address TEXT,
  tx_hash TEXT,
  provider_order_id TEXT,
  idempotency_key TEXT UNIQUE,
  meta_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(wallet_id) REFERENCES wallets(id)
);
`;

let memDb: Database.Database;

function runMigration() {
  memDb.exec(SCHEMA_SQL);
  const cols = memDb.pragma('table_info(audit_logs)') as Array<{ name: string }>;
  const colNames = new Set(cols.map((c: { name: string }) => c.name));
  if (!colNames.has('prev_hash')) {
    memDb.exec('ALTER TABLE audit_logs ADD COLUMN prev_hash TEXT');
  }
  if (!colNames.has('entry_hash')) {
    memDb.exec('ALTER TABLE audit_logs ADD COLUMN entry_hash TEXT');
  }
}

vi.mock('../src/core/db.js', () => ({
  getDb: () => memDb,
  ensureDataDir: () => {},
  initDbSchema: () => runMigration(),
  assertInitialized: () => {},
  isInitialized: () => true
}));

describe('DB migration: old schema without prev_hash/entry_hash', () => {
  beforeEach(() => {
    memDb = new Database(':memory:');
    memDb.pragma('journal_mode = WAL');
    memDb.pragma('foreign_keys = ON');
    memDb.exec(OLD_SCHEMA_SQL);
  });

  afterEach(() => {
    memDb.close();
  });

  it('adds prev_hash and entry_hash columns to old audit_logs table', async () => {
    const colsBefore = memDb.pragma('table_info(audit_logs)') as Array<{ name: string }>;
    const namesBefore = colsBefore.map(c => c.name);
    expect(namesBefore).not.toContain('prev_hash');
    expect(namesBefore).not.toContain('entry_hash');

    const { initDbSchema } = await import('../src/core/db.js');
    initDbSchema();

    const colsAfter = memDb.pragma('table_info(audit_logs)') as Array<{ name: string }>;
    const namesAfter = colsAfter.map(c => c.name);
    expect(namesAfter).toContain('prev_hash');
    expect(namesAfter).toContain('entry_hash');
  });

  it('logAudit succeeds after migration on old schema', async () => {
    const { initDbSchema } = await import('../src/core/db.js');
    initDbSchema();

    const { logAudit } = await import('../src/core/audit-service.js');
    expect(() => {
      logAudit({ action: 'test.migration', request: { test: true }, decision: 'ok' });
    }).not.toThrow();

    const row = memDb.prepare('SELECT prev_hash, entry_hash FROM audit_logs LIMIT 1').get() as any;
    expect(row.prev_hash).toBeTruthy();
    expect(row.entry_hash).toBeTruthy();
  });

  it('migration is idempotent (running twice does not error)', async () => {
    const { initDbSchema } = await import('../src/core/db.js');
    initDbSchema();
    expect(() => initDbSchema()).not.toThrow();
  });
});
