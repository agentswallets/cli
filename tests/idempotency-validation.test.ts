import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/core/schema.js';

let memDb: Database.Database;

vi.mock('../src/core/db.js', () => ({
  getDb: () => memDb,
  ensureDataDir: () => {},
  initDbSchema: () => memDb.exec(SCHEMA_SQL),
  assertInitialized: () => {},
  isInitialized: () => true
}));

describe('idempotency key validation', () => {
  beforeEach(() => {
    memDb = new Database(':memory:');
    memDb.pragma('journal_mode = WAL');
    memDb.pragma('foreign_keys = ON');
    memDb.exec(SCHEMA_SQL);
  });

  afterEach(() => {
    memDb.close();
  });

  it('rejects keys with invalid characters', async () => {
    const { reserveIdempotencyKey } = await import('../src/util/idempotency.js');
    expect(() => reserveIdempotencyKey('key with spaces', 'tx_send')).toThrow(/1-256 chars/);
    expect(() => reserveIdempotencyKey('key@invalid!', 'tx_send')).toThrow(/1-256 chars/);
    expect(() => reserveIdempotencyKey('key/slash', 'tx_send')).toThrow(/1-256 chars/);
  });

  it('rejects keys exceeding 256 characters', async () => {
    const { reserveIdempotencyKey } = await import('../src/util/idempotency.js');
    const longKey = 'a'.repeat(257);
    expect(() => reserveIdempotencyKey(longKey, 'tx_send')).toThrow(/1-256 chars/);
  });

  it('accepts valid keys', async () => {
    const { reserveIdempotencyKey } = await import('../src/util/idempotency.js');
    expect(() => reserveIdempotencyKey('valid-key_123', 'tx_send')).not.toThrow();
    expect(() => reserveIdempotencyKey('a', 'tx_send')).not.toThrow();
    expect(() => reserveIdempotencyKey('A'.repeat(256), 'tx_send')).not.toThrow();
  });

  it('rejects keys with unicode characters', async () => {
    const { reserveIdempotencyKey } = await import('../src/util/idempotency.js');
    expect(() => reserveIdempotencyKey('key-日本語', 'tx_send')).toThrow(/1-256 chars/);
    expect(() => reserveIdempotencyKey('clé-émoji-🔑', 'tx_send')).toThrow(/1-256 chars/);
    expect(() => reserveIdempotencyKey('键值', 'tx_send')).toThrow(/1-256 chars/);
  });

  it('rejects keys with leading/trailing/embedded spaces', async () => {
    const { reserveIdempotencyKey } = await import('../src/util/idempotency.js');
    expect(() => reserveIdempotencyKey(' leading', 'tx_send')).toThrow(/1-256 chars/);
    expect(() => reserveIdempotencyKey('trailing ', 'tx_send')).toThrow(/1-256 chars/);
    expect(() => reserveIdempotencyKey('mid dle', 'tx_send')).toThrow(/1-256 chars/);
    expect(() => reserveIdempotencyKey('\ttab', 'tx_send')).toThrow(/1-256 chars/);
    expect(() => reserveIdempotencyKey('new\nline', 'tx_send')).toThrow(/1-256 chars/);
  });
});
