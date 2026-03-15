import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { SCHEMA_SQL } from '../src/core/schema.js';

let memDb: Database.Database;

vi.mock('../src/core/db.js', () => ({
  getDb: () => memDb,
  ensureDataDir: () => {},
  initDbSchema: () => memDb.exec(SCHEMA_SQL),
  assertInitialized: () => {},
  isInitialized: () => true
}));

vi.mock('../src/core/session.js', () => ({
  isSessionValid: () => true
}));

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function insertAuditLog(opts: {
  id: string;
  walletId: string | null;
  action: string;
  requestJson: string;
  decision: string;
  createdAt: string;
  prevHash: string | null;
  entryHash: string | null;
}): void {
  memDb.prepare(
    `INSERT INTO audit_logs(id, wallet_id, action, request_json, decision, created_at, prev_hash, entry_hash)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    opts.id,
    opts.walletId,
    opts.action,
    opts.requestJson,
    opts.decision,
    opts.createdAt,
    opts.prevHash,
    opts.entryHash
  );
}

describe('security report', () => {
  beforeEach(() => {
    memDb = new Database(':memory:');
    memDb.pragma('journal_mode = WAL');
    memDb.exec(SCHEMA_SQL);
    // Insert test wallets to satisfy FK constraints
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

  it('generates report with all 12 checks', async () => {
    const { generateSecurityReport } = await import('../src/security/report.js');
    const report = generateSecurityReport();
    expect(report.checks.length).toBe(12);
  });

  it('all checks pass on empty DB', async () => {
    // Reset to a truly empty DB (no wallets) to match "empty DB" semantics
    memDb.close();
    memDb = new Database(':memory:');
    memDb.pragma('journal_mode = WAL');
    memDb.exec(SCHEMA_SQL);

    const { generateSecurityReport } = await import('../src/security/report.js');
    const report = generateSecurityReport();

    for (const check of report.checks) {
      expect(['pass', 'warn']).toContain(check.status);
    }
  });

  it('detects key integrity issue', async () => {
    // Insert a wallet with empty encrypted_private_key — violates NOT NULL, so use a wallet
    // that was inserted with a blank string by bypassing the schema constraint via pragma off.
    memDb.pragma('ignore_check_constraints = ON');
    // SQLite enforces NOT NULL but we can use a trick: turn off FK enforcement and insert directly
    // The schema column is NOT NULL but we can insert an empty string which is valid SQL.
    // encrypted_private_key = '' (empty string) triggers the key_integrity check.
    const now = new Date().toISOString();
    memDb.prepare(
      `INSERT INTO wallets(id, name, address, encrypted_private_key, created_at) VALUES(?, ?, ?, ?, ?)`
    ).run('w3', 'bad-wallet', '0xcccc', '', now);

    const { generateSecurityReport } = await import('../src/security/report.js');
    const report = generateSecurityReport();

    const check = report.checks.find(c => c.name === 'key_integrity');
    expect(check).toBeDefined();
    expect(check!.status).toBe('fail');
    expect(check!.detail).toMatch(/empty or null encrypted_private_key/);
  });

  it('counts transaction stats', async () => {
    // Insert some operations for w1
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      memDb.prepare(
        `INSERT INTO operations(tx_id, wallet_id, kind, status, chain_name, created_at, updated_at)
         VALUES(?, ?, 'send', 'confirmed', 'polygon', ?, ?)`
      ).run(`tx-${i}`, 'w1', now, now);
    }

    const { generateSecurityReport } = await import('../src/security/report.js');
    const report = generateSecurityReport();

    const check = report.checks.find(c => c.name === 'transaction_stats');
    expect(check).toBeDefined();
    expect(check!.detail).toMatch(/3 total/);
  });

  it('detects audit chain break', async () => {
    const now = new Date().toISOString();

    // First entry: prev_hash = zeros
    const prevHash0 = '0'.repeat(64);
    const id1 = 'audit-1';
    const action1 = 'wallet.send';
    const requestJson1 = '{}';
    const decision1 = 'ok';
    const entryHash1 = sha256(`${prevHash0}${id1}${action1}${requestJson1}${decision1}${now}`);

    insertAuditLog({
      id: id1,
      walletId: 'w1',
      action: action1,
      requestJson: requestJson1,
      decision: decision1,
      createdAt: now,
      prevHash: prevHash0,
      entryHash: entryHash1,
    });

    // Second entry: use a WRONG prev_hash (should be entryHash1)
    const wrongPrevHash = 'deadbeef'.repeat(8);
    const id2 = 'audit-2';
    const action2 = 'wallet.send';
    const requestJson2 = '{"amount":"1"}';
    const decision2 = 'ok';
    // entry_hash computed with the wrong prev_hash so the entry_hash itself is internally consistent
    // but the linkage to the previous entry is broken.
    const entryHash2 = sha256(`${wrongPrevHash}${id2}${action2}${requestJson2}${decision2}${now}`);

    insertAuditLog({
      id: id2,
      walletId: 'w1',
      action: action2,
      requestJson: requestJson2,
      decision: decision2,
      createdAt: now,
      prevHash: wrongPrevHash,
      entryHash: entryHash2,
    });

    const { generateSecurityReport } = await import('../src/security/report.js');
    const report = generateSecurityReport();

    const check = report.checks.find(c => c.name === 'audit_chain_integrity');
    expect(check).toBeDefined();
    expect(check!.status).toBe('fail');
    expect(check!.detail).toMatch(/broken link/);
  });
});
