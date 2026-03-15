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

function insertOp(walletId: string, overrides: { kind?: string; status?: string; amount?: string; to_address?: string; created_at?: string } = {}): void {
  const now = new Date().toISOString();
  memDb.prepare(
    `INSERT INTO operations(tx_id, wallet_id, kind, status, amount, to_address, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uuidv4(), walletId, overrides.kind ?? 'send', overrides.status ?? 'confirmed', overrides.amount ?? '10', overrides.to_address ?? '0xaaaa', overrides.created_at ?? now, now);
}

describe('security anomaly detection', () => {
  beforeEach(() => {
    memDb = new Database(':memory:');
    memDb.pragma('journal_mode = WAL');
    memDb.exec(SCHEMA_SQL);
    const now = new Date().toISOString();
    memDb.prepare(
      `INSERT INTO wallets(id, name, address, encrypted_private_key, created_at) VALUES(?, ?, ?, ?, ?)`
    ).run('w1', 'test1', '0xaaaa', 'enc', now);
  });

  afterEach(() => {
    memDb.close();
  });

  it('returns empty array when no operations', async () => {
    const { detectAnomalies } = await import('../src/security/anomaly.js');
    const anomalies = detectAnomalies('w1');
    expect(anomalies).toHaveLength(0);
  });

  it('detects consecutive failures', async () => {
    const { detectAnomalies } = await import('../src/security/anomaly.js');
    for (let i = 0; i < 5; i++) {
      insertOp('w1', { status: 'failed' });
    }
    const anomalies = detectAnomalies('w1');
    expect(anomalies.some(a => a.type === 'consecutive_failures')).toBe(true);
  });

  it('detects drain pattern', async () => {
    const { detectAnomalies } = await import('../src/security/anomaly.js');
    insertOp('w1', { kind: 'drain' });
    const anomalies = detectAnomalies('w1');
    expect(anomalies.some(a => a.type === 'drain_pattern')).toBe(true);
  });

  it('does not flag normal activity', async () => {
    const { detectAnomalies } = await import('../src/security/anomaly.js');
    insertOp('w1');
    insertOp('w1');
    const anomalies = detectAnomalies('w1');
    expect(anomalies).toHaveLength(0);
  });

  it('detects volume spike when today exceeds 3x average', async () => {
    const { detectAnomalies } = await import('../src/security/anomaly.js');
    // 2 ops per day for past 3 days = avg 2/day
    for (let d = 1; d <= 3; d++) {
      for (let i = 0; i < 2; i++) {
        insertOp('w1', { created_at: new Date(Date.now() - d * 86_400_000).toISOString() });
      }
    }
    // 7 ops today (>3x avg of 2)
    for (let i = 0; i < 7; i++) {
      insertOp('w1');
    }
    const anomalies = detectAnomalies('w1');
    expect(anomalies.some(a => a.type === 'volume_spike')).toBe(true);
  });

  it('detects new address burst when >5 unique new addresses in 24h', async () => {
    const { detectAnomalies } = await import('../src/security/anomaly.js');
    // Insert 6 ops with unique addresses (all recent)
    for (let i = 0; i < 6; i++) {
      insertOp('w1', { to_address: `0x${i.toString().padStart(40, '0')}` });
    }
    const anomalies = detectAnomalies('w1');
    expect(anomalies.some(a => a.type === 'new_address_burst')).toBe(true);
  });

  it('detects night large transactions', async () => {
    const { detectAnomalies } = await import('../src/security/anomaly.js');
    // Create a date at 3:00 AM today
    const nightTime = new Date();
    nightTime.setHours(3, 0, 0, 0);
    insertOp('w1', { amount: '1000', created_at: nightTime.toISOString() });
    const anomalies = detectAnomalies('w1');
    expect(anomalies.some(a => a.type === 'night_large_transactions')).toBe(true);
  });

  // ── Boundary value tests ──

  it('volume_spike does not trigger at exactly 3x average', async () => {
    const { detectAnomalies } = await import('../src/security/anomaly.js');
    // 2 ops per day for past 3 days = avg 2/day
    for (let d = 1; d <= 3; d++) {
      for (let i = 0; i < 2; i++) {
        insertOp('w1', { created_at: new Date(Date.now() - d * 86_400_000).toISOString() });
      }
    }
    // 6 ops today = exactly 3x avg of 2 → should NOT trigger (> 3x required)
    for (let i = 0; i < 6; i++) {
      insertOp('w1');
    }
    const anomalies = detectAnomalies('w1');
    expect(anomalies.some(a => a.type === 'volume_spike')).toBe(false);
  });

  it('new_address_burst does not trigger with exactly 5 new addresses', async () => {
    const { detectAnomalies } = await import('../src/security/anomaly.js');
    // Insert exactly 5 ops with unique addresses → threshold is >5, so should NOT trigger
    for (let i = 0; i < 5; i++) {
      insertOp('w1', { to_address: `0x${i.toString().padStart(40, '0')}` });
    }
    const anomalies = detectAnomalies('w1');
    expect(anomalies.some(a => a.type === 'new_address_burst')).toBe(false);
  });

  it('consecutive_failures does not trigger with exactly 3 failures', async () => {
    const { detectAnomalies } = await import('../src/security/anomaly.js');
    // Insert exactly 3 consecutive failures → threshold is >3, so should NOT trigger
    for (let i = 0; i < 3; i++) {
      insertOp('w1', { status: 'failed' });
    }
    const anomalies = detectAnomalies('w1');
    expect(anomalies.some(a => a.type === 'consecutive_failures')).toBe(false);
  });
});
