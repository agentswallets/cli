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

describe('idempotency', () => {
  beforeEach(() => {
    memDb = new Database(':memory:');
    memDb.pragma('journal_mode = WAL');
    memDb.pragma('foreign_keys = ON');
    memDb.exec(SCHEMA_SQL);
  });

  afterEach(() => {
    memDb.close();
  });

  it('reserves a key successfully', async () => {
    const { reserveIdempotencyKey } = await import('../src/util/idempotency.js');
    reserveIdempotencyKey('k1', 'tx_send');
    const row = memDb.prepare('SELECT * FROM idempotency_keys WHERE key=?').get('k1') as any;
    expect(row.scope).toBe('tx_send');
    expect(row.status).toBe('reserved');
  });

  it('allows same key same scope (idempotent)', async () => {
    const { reserveIdempotencyKey } = await import('../src/util/idempotency.js');
    reserveIdempotencyKey('k2', 'tx_send');
    // Should not throw
    expect(() => reserveIdempotencyKey('k2', 'tx_send')).not.toThrow();
  });

  it('rejects same key different scope', async () => {
    const { reserveIdempotencyKey } = await import('../src/util/idempotency.js');
    reserveIdempotencyKey('k3', 'tx_send');
    expect(() => reserveIdempotencyKey('k3', 'poly_buy')).toThrow(/different scope/);
  });

  it('binds ref_id to reserved key', async () => {
    const { reserveIdempotencyKey, bindIdempotencyKeyRef } = await import('../src/util/idempotency.js');
    reserveIdempotencyKey('k4', 'tx_send');
    bindIdempotencyKeyRef('k4', 'tx_abc', 'completed');
    const row = memDb.prepare('SELECT * FROM idempotency_keys WHERE key=?').get('k4') as any;
    expect(row.ref_id).toBe('tx_abc');
    expect(row.status).toBe('completed');
  });

  it('rejects empty idempotency key', async () => {
    const { reserveIdempotencyKey } = await import('../src/util/idempotency.js');
    expect(() => reserveIdempotencyKey('', 'tx_send')).toThrow(/must not be empty/);
    expect(() => reserveIdempotencyKey('   ', 'tx_send')).toThrow(/must not be empty/);
  });

  it('getOperationByIdempotencyKey returns null for unknown key', async () => {
    const { getOperationByIdempotencyKey } = await import('../src/util/idempotency.js');
    expect(getOperationByIdempotencyKey('unknown')).toBeNull();
  });

  it('getOperationByIdempotencyKey returns matching operation', async () => {
    const { getOperationByIdempotencyKey } = await import('../src/util/idempotency.js');
    // Insert a test wallet first (FK constraint)
    memDb
      .prepare('INSERT INTO wallets(id,name,address,encrypted_private_key,created_at) VALUES(?,?,?,?,?)')
      .run('w1', 'test', '0xaa', '{}', new Date().toISOString());
    memDb
      .prepare(
        'INSERT INTO operations(tx_id,wallet_id,kind,status,token,amount,to_address,tx_hash,provider_order_id,idempotency_key,meta_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
      )
      .run('tx_1', 'w1', 'send', 'broadcasted', 'USDC', '10', '0xbb', '0xhash', null, 'k5', '{}', new Date().toISOString(), new Date().toISOString());
    const op = getOperationByIdempotencyKey('k5');
    expect(op).not.toBeNull();
    expect(op!.tx_id).toBe('tx_1');
    expect(op!.tx_hash).toBe('0xhash');
  });
});
