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

vi.mock('../src/core/config.js', () => ({
  getHomeDir: () => '/tmp/aw-test-home',
  getDbPath: () => ':memory:',
  getSessionPath: () => '/tmp/aw-test-home/session.json',
  getSessionTokenPath: () => '/tmp/aw-test-home/session-token'
}));

describe('audit-service enhanced columns', () => {
  beforeEach(() => {
    memDb = new Database(':memory:');
    memDb.pragma('journal_mode = WAL');
    memDb.pragma('foreign_keys = ON');
    memDb.exec(SCHEMA_SQL);
  });

  afterEach(() => {
    memDb.close();
  });

  it('logAudit with wallet_id resolves wallet_address from DB', async () => {
    // Insert a wallet so the address lookup works
    memDb.prepare(
      "INSERT INTO wallets(id,name,address,encrypted_private_key,created_at) VALUES(?,?,?,?,?)"
    ).run('w1', 'alice', '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'enc', new Date().toISOString());

    const { logAudit } = await import('../src/core/audit-service.js');
    logAudit({ wallet_id: 'w1', action: 'test.addr', request: {}, decision: 'ok' });

    const row = memDb.prepare('SELECT wallet_address, home_dir FROM audit_logs LIMIT 1').get() as any;
    expect(row.wallet_address).toBe('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(row.home_dir).toBe('/tmp/aw-test-home');
  });

  it('logAudit without wallet_id sets wallet_address to null', async () => {
    const { logAudit } = await import('../src/core/audit-service.js');
    logAudit({ action: 'test.noaddr', request: {}, decision: 'ok' });

    const row = memDb.prepare('SELECT wallet_address, home_dir FROM audit_logs LIMIT 1').get() as any;
    expect(row.wallet_address).toBeNull();
    expect(row.home_dir).toBe('/tmp/aw-test-home');
  });

  it('logAudit with nonexistent wallet_id does not throw', async () => {
    const { logAudit } = await import('../src/core/audit-service.js');
    expect(() => {
      logAudit({ wallet_id: 'nonexistent-id', action: 'test.missing', request: {}, decision: 'ok' });
    }).not.toThrow();

    const row = memDb.prepare('SELECT wallet_address FROM audit_logs LIMIT 1').get() as any;
    expect(row.wallet_address).toBeNull();
  });

  it('home_dir is always populated', async () => {
    const { logAudit } = await import('../src/core/audit-service.js');
    logAudit({ action: 'test.homedir', request: {}, decision: 'ok' });
    logAudit({ wallet_id: 'w1', action: 'test.homedir2', request: {}, decision: 'ok' });

    const rows = memDb.prepare('SELECT home_dir FROM audit_logs ORDER BY rowid').all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].home_dir).toBe('/tmp/aw-test-home');
    expect(rows[1].home_dir).toBe('/tmp/aw-test-home');
  });

  it('listAuditLogs returns wallet_address and home_dir', async () => {
    memDb.prepare(
      "INSERT INTO wallets(id,name,address,encrypted_private_key,created_at) VALUES(?,?,?,?,?)"
    ).run('w2', 'bob', '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'enc', new Date().toISOString());

    const { logAudit, listAuditLogs } = await import('../src/core/audit-service.js');
    logAudit({ wallet_id: 'w2', action: 'test.list', request: {}, decision: 'ok' });

    const logs = listAuditLogs({ wallet_id: 'w2', limit: 10 });
    expect(logs).toHaveLength(1);
    expect(logs[0].wallet_address).toBe('0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    expect(logs[0].home_dir).toBe('/tmp/aw-test-home');
  });

  it('listAuditLogs with action filter returns new fields', async () => {
    memDb.prepare(
      "INSERT INTO wallets(id,name,address,encrypted_private_key,created_at) VALUES(?,?,?,?,?)"
    ).run('w3', 'carol', '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', 'enc', new Date().toISOString());

    const { logAudit, listAuditLogs } = await import('../src/core/audit-service.js');
    logAudit({ wallet_id: 'w3', action: 'tx.send', request: {}, decision: 'ok' });
    logAudit({ wallet_id: 'w3', action: 'unlock', request: {}, decision: 'ok' });

    const sends = listAuditLogs({ wallet_id: 'w3', action: 'tx.send', limit: 10 });
    expect(sends).toHaveLength(1);
    expect(sends[0].wallet_address).toBe('0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC');
    expect(sends[0].home_dir).toBe('/tmp/aw-test-home');
  });
});
