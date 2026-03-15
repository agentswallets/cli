import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/core/schema.js';
import { v4 as uuidv4 } from 'uuid';

let memDb: Database.Database;

vi.mock('../src/core/db.js', () => ({
  getDb: () => memDb,
  ensureDataDir: () => {},
  initDbSchema: () => memDb.exec(SCHEMA_SQL),
  assertInitialized: () => {},
  isInitialized: () => true
}));

function insertOp(walletId: string, minutesAgo = 0): void {
  const createdAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  memDb.prepare(
    `INSERT INTO operations(tx_id, wallet_id, kind, status, created_at, updated_at)
     VALUES(?, ?, 'send', 'confirmed', ?, ?)`
  ).run(uuidv4(), walletId, createdAt, createdAt);
}

describe('security rate-limiter', () => {
  beforeEach(() => {
    memDb = new Database(':memory:');
    memDb.pragma('journal_mode = WAL');
    memDb.exec(SCHEMA_SQL);
    // Insert test wallets to satisfy FK constraint
    const now = new Date().toISOString();
    memDb.prepare(
      `INSERT INTO wallets(id, name, address, encrypted_private_key, created_at) VALUES(?, ?, ?, ?, ?)`
    ).run('w1', 'test1', '0xaaaa', 'enc', now);
    memDb.prepare(
      `INSERT INTO wallets(id, name, address, encrypted_private_key, created_at) VALUES(?, ?, ?, ?, ?)`
    ).run('w2', 'test2', '0xbbbb', 'enc', now);
  });

  afterEach(() => {
    memDb.close();
  });

  it('allows transactions below rate limit', async () => {
    const { checkRateLimit } = await import('../src/security/rate-limiter.js');
    insertOp('w1', 0);
    insertOp('w1', 0);
    expect(() => checkRateLimit('w1')).not.toThrow();
  });

  it('blocks when per-minute limit exceeded', async () => {
    const { checkRateLimit } = await import('../src/security/rate-limiter.js');
    for (let i = 0; i < 5; i++) {
      insertOp('w1', 0);
    }
    expect(() => checkRateLimit('w1')).toThrow('Rate limit exceeded');
  });

  it('does not count old transactions for per-minute limit', async () => {
    const { checkRateLimit } = await import('../src/security/rate-limiter.js');
    for (let i = 0; i < 5; i++) {
      insertOp('w1', 5); // 5 minutes ago
    }
    expect(() => checkRateLimit('w1')).not.toThrow();
  });

  it('blocks when per-hour limit exceeded', async () => {
    const { checkRateLimit } = await import('../src/security/rate-limiter.js');
    for (let i = 0; i < 30; i++) {
      insertOp('w1', 30); // 30 minutes ago
    }
    expect(() => checkRateLimit('w1')).toThrow('Rate limit exceeded');
  });

  it('isolates rate limits per wallet', async () => {
    const { checkRateLimit } = await import('../src/security/rate-limiter.js');
    for (let i = 0; i < 5; i++) {
      insertOp('w1', 0);
    }
    // w1 should be blocked
    expect(() => checkRateLimit('w1')).toThrow();
    // w2 should be fine
    expect(() => checkRateLimit('w2')).not.toThrow();
  });
});
