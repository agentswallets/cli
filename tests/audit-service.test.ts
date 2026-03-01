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

describe('audit-service', () => {
  beforeEach(() => {
    memDb = new Database(':memory:');
    memDb.pragma('journal_mode = WAL');
    memDb.pragma('foreign_keys = ON');
    memDb.exec(SCHEMA_SQL);
  });

  afterEach(() => {
    memDb.close();
  });

  it('logAudit inserts a row with hash chain', async () => {
    const { logAudit } = await import('../src/core/audit-service.js');
    logAudit({ action: 'test', request: { foo: 1 }, decision: 'ok' });
    const row = memDb.prepare('SELECT * FROM audit_logs LIMIT 1').get() as any;
    expect(row.action).toBe('test');
    expect(row.decision).toBe('ok');
    expect(row.prev_hash).toBe('0'.repeat(64)); // first entry
    expect(row.entry_hash).toBeTruthy();
    expect(row.entry_hash.length).toBe(64); // SHA-256 hex
  });

  it('hash chain links consecutive entries', async () => {
    const { logAudit } = await import('../src/core/audit-service.js');
    logAudit({ action: 'a1', request: {}, decision: 'ok' });
    logAudit({ action: 'a2', request: {}, decision: 'ok' });
    const rows = memDb.prepare('SELECT prev_hash, entry_hash FROM audit_logs ORDER BY rowid').all() as any[];
    expect(rows[1].prev_hash).toBe(rows[0].entry_hash);
  });

  it('logAudit stores wallet_id and error_code', async () => {
    const { logAudit } = await import('../src/core/audit-service.js');
    logAudit({ wallet_id: 'w1', action: 'unlock', request: {}, decision: 'denied', error_code: 'ERR_NEED_UNLOCK' });
    const row = memDb.prepare('SELECT wallet_id, error_code FROM audit_logs LIMIT 1').get() as any;
    expect(row.wallet_id).toBe('w1');
    expect(row.error_code).toBe('ERR_NEED_UNLOCK');
  });

  it('listAuditLogs returns filtered results', async () => {
    const { logAudit, listAuditLogs } = await import('../src/core/audit-service.js');
    logAudit({ wallet_id: 'w1', action: 'send', request: {}, decision: 'ok' });
    logAudit({ wallet_id: 'w1', action: 'unlock', request: {}, decision: 'ok' });
    logAudit({ wallet_id: 'w2', action: 'send', request: {}, decision: 'ok' });

    const all = listAuditLogs({ wallet_id: 'w1', limit: 50 });
    expect(all).toHaveLength(2);

    const sends = listAuditLogs({ wallet_id: 'w1', action: 'send', limit: 50 });
    expect(sends).toHaveLength(1);
    expect(sends[0].action).toBe('send');
  });

  it('listAuditLogs respects limit', async () => {
    const { logAudit, listAuditLogs } = await import('../src/core/audit-service.js');
    for (let i = 0; i < 10; i++) {
      logAudit({ wallet_id: 'w1', action: 'test', request: { i }, decision: 'ok' });
    }
    const limited = listAuditLogs({ wallet_id: 'w1', limit: 3 });
    expect(limited).toHaveLength(3);
  });
});
