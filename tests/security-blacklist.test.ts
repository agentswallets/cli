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

describe('security blacklist', () => {
  beforeEach(() => {
    memDb = new Database(':memory:');
    memDb.pragma('journal_mode = WAL');
    memDb.exec(SCHEMA_SQL);
  });

  afterEach(() => {
    memDb.close();
  });

  it('addToBlacklist and isBlacklisted', async () => {
    const { addToBlacklist, isBlacklisted } = await import('../src/security/blacklist.js');
    expect(isBlacklisted('0xDEAD1234')).toBe(false);
    addToBlacklist('0xDEAD1234', 'polygon', 'scam');
    expect(isBlacklisted('0xdead1234')).toBe(true);  // case-insensitive
  });

  it('removeFromBlacklist', async () => {
    const { addToBlacklist, removeFromBlacklist, isBlacklisted } = await import('../src/security/blacklist.js');
    addToBlacklist('0xaaaa', undefined, 'test');
    expect(isBlacklisted('0xaaaa')).toBe(true);
    const removed = removeFromBlacklist('0xaaaa');
    expect(removed).toBe(true);
    expect(isBlacklisted('0xaaaa')).toBe(false);
  });

  it('removeFromBlacklist returns false for unknown address', async () => {
    const { removeFromBlacklist } = await import('../src/security/blacklist.js');
    expect(removeFromBlacklist('0xunknown')).toBe(false);
  });

  it('listBlacklist returns all entries', async () => {
    const { addToBlacklist, listBlacklist } = await import('../src/security/blacklist.js');
    addToBlacklist('0xaaaa', 'polygon', 'reason1');
    addToBlacklist('0xbbbb', 'ethereum', 'reason2');
    const list = listBlacklist();
    expect(list.length).toBe(2);
    const addresses = list.map(e => e.address).sort();
    expect(addresses).toEqual(['0xaaaa', '0xbbbb']);
  });

  it('addToBlacklist upserts on conflict', async () => {
    const { addToBlacklist, listBlacklist } = await import('../src/security/blacklist.js');
    addToBlacklist('0xaaaa', 'polygon', 'old reason');
    addToBlacklist('0xaaaa', 'ethereum', 'new reason');
    const list = listBlacklist();
    expect(list.length).toBe(1);
    expect(list[0].reason).toBe('new reason');
    expect(list[0].chain).toBe('ethereum');
  });
});
