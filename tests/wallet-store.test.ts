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

describe('wallet-store', () => {
  beforeEach(() => {
    memDb = new Database(':memory:');
    memDb.pragma('journal_mode = WAL');
    memDb.pragma('foreign_keys = ON');
    memDb.exec(SCHEMA_SQL);
  });

  afterEach(() => {
    memDb.close();
  });

  it('insertWallet creates a wallet row', async () => {
    const { insertWallet } = await import('../src/core/wallet-store.js');
    const row = insertWallet('bot1', '0xabc', '{"encrypted":"data"}');
    expect(row.id).toBeTruthy();
    expect(row.name).toBe('bot1');
    expect(row.address).toBe('0xabc');
    expect(row.created_at).toBeTruthy();
  });

  it('insertWallet rejects duplicate name', async () => {
    const { insertWallet } = await import('../src/core/wallet-store.js');
    insertWallet('dup', '0x111', '{}');
    expect(() => insertWallet('dup', '0x222', '{}')).toThrow(/already exists/);
  });

  it('getWalletById returns the wallet', async () => {
    const { insertWallet, getWalletById } = await import('../src/core/wallet-store.js');
    const created = insertWallet('w1', '0xfoo', '{"k":"v"}');
    const fetched = getWalletById(created.id);
    expect(fetched.name).toBe('w1');
    expect(fetched.address).toBe('0xfoo');
  });

  it('getWalletById throws for unknown id', async () => {
    const { getWalletById } = await import('../src/core/wallet-store.js');
    expect(() => getWalletById('nonexistent')).toThrow(/not found/);
  });

  it('listWallets returns all wallets', async () => {
    const { insertWallet, listWallets } = await import('../src/core/wallet-store.js');
    insertWallet('a', '0xa', '{}');
    insertWallet('b', '0xb', '{}');
    const list = listWallets();
    expect(list).toHaveLength(2);
    expect(list.map(w => w.name).sort()).toEqual(['a', 'b']);
  });

  it('listWallets returns empty array when no wallets', async () => {
    const { listWallets } = await import('../src/core/wallet-store.js');
    expect(listWallets()).toEqual([]);
  });

  it('upsertPolicy creates and updates policy', async () => {
    const { insertWallet, upsertPolicy, getPolicy } = await import('../src/core/wallet-store.js');
    const w = insertWallet('pol', '0xpol', '{}');
    upsertPolicy(w.id, {
      daily_limit: 500,
      per_tx_limit: 100,
      max_tx_per_day: 10,
      allowed_tokens: ['USDC'],
      allowed_addresses: [],
      require_approval_above: null
    });
    const p = getPolicy(w.id);
    expect(p.daily_limit).toBe(500);
    expect(p.per_tx_limit).toBe(100);
    expect(p.allowed_tokens).toEqual(['USDC']);

    // Update
    upsertPolicy(w.id, {
      daily_limit: 1000,
      per_tx_limit: 200,
      max_tx_per_day: 20,
      allowed_tokens: ['USDC', 'POL'],
      allowed_addresses: ['0xABC'],
      require_approval_above: 500
    });
    const p2 = getPolicy(w.id);
    expect(p2.daily_limit).toBe(1000);
    expect(p2.allowed_tokens).toEqual(['USDC', 'POL']);
    expect(p2.allowed_addresses).toEqual(['0xabc']); // lowercased
  });

  it('getPolicy returns safe defaults for unknown wallet (fail-closed)', async () => {
    const { getPolicy } = await import('../src/core/wallet-store.js');
    const p = getPolicy('no-such-wallet');
    expect(p.daily_limit).toBe(500);
    expect(p.per_tx_limit).toBe(100);
    expect(p.max_tx_per_day).toBe(20);
    expect(p.allowed_tokens).toEqual(['POL', 'USDC', 'USDC.e']);
    expect(p.allowed_addresses).toEqual([]);
  });

  it('insertWallet applies default policy atomically', async () => {
    const { insertWallet, getPolicy } = await import('../src/core/wallet-store.js');
    const w = insertWallet('defpol', '0xdefpol', '{}');
    const p = getPolicy(w.id);
    expect(p.per_tx_limit).toBe(100);
    expect(p.daily_limit).toBe(500);
    expect(p.max_tx_per_day).toBe(20);
    expect(p.allowed_tokens).toEqual(['POL', 'USDC', 'USDC.e']);
    expect(p.allowed_addresses).toEqual([]);
    expect(p.require_approval_above).toBeNull();
  });

  it('default policy is stored in DB (not just in-memory fallback)', async () => {
    const { insertWallet } = await import('../src/core/wallet-store.js');
    const w = insertWallet('dbcheck', '0xdbcheck', '{}');
    const row = memDb.prepare('SELECT * FROM policies WHERE wallet_id=?').get(w.id) as any;
    expect(row).toBeTruthy();
    expect(row.daily_limit).toBe(500);
    expect(row.per_tx_limit).toBe(100);
  });

  it('resolveWallet resolves by name', async () => {
    const { insertWallet, resolveWallet } = await import('../src/core/wallet-store.js');
    const created = insertWallet('alice', '0xAliceAddr000000000000000000000000000000', '{}');
    const resolved = resolveWallet('alice');
    expect(resolved.id).toBe(created.id);
    expect(resolved.name).toBe('alice');
  });

  it('resolveWallet resolves by address (case insensitive)', async () => {
    const { insertWallet, resolveWallet } = await import('../src/core/wallet-store.js');
    const addr = '0xAbCdEf0000000000000000000000000000000001';
    const created = insertWallet('bob', addr, '{}');
    const resolved = resolveWallet(addr.toLowerCase());
    expect(resolved.id).toBe(created.id);
  });

  it('resolveWallet resolves by UUID', async () => {
    const { insertWallet, resolveWallet } = await import('../src/core/wallet-store.js');
    const created = insertWallet('carol', '0xCarol00000000000000000000000000000000', '{}');
    const resolved = resolveWallet(created.id);
    expect(resolved.name).toBe('carol');
  });

  it('resolveWallet throws for invalid 0x address length', async () => {
    const { resolveWallet } = await import('../src/core/wallet-store.js');
    expect(() => resolveWallet('0x1234')).toThrow(/Invalid wallet address/);
  });

  it('resolveWallet throws for unknown name', async () => {
    const { resolveWallet } = await import('../src/core/wallet-store.js');
    expect(() => resolveWallet('unknown_wallet')).toThrow(/not found/);
  });

  it('listWallets does not include id field', async () => {
    const { insertWallet, listWallets } = await import('../src/core/wallet-store.js');
    insertWallet('x', '0xx', '{}');
    const list = listWallets();
    expect(list[0]).toHaveProperty('name');
    expect(list[0]).toHaveProperty('address');
    expect(list[0]).toHaveProperty('created_at');
    expect(list[0]).not.toHaveProperty('id');
  });

  it('getWalletByName returns the wallet', async () => {
    const { insertWallet, getWalletByName } = await import('../src/core/wallet-store.js');
    insertWallet('findme', '0xfindme', '{}');
    const w = getWalletByName('findme');
    expect(w.name).toBe('findme');
    expect(w.address).toBe('0xfindme');
  });

  it('getWalletByAddress returns the wallet (case insensitive)', async () => {
    const { insertWallet, getWalletByAddress } = await import('../src/core/wallet-store.js');
    const addr = '0xABCDef0000000000000000000000000000001234';
    insertWallet('addrtest', addr, '{}');
    const w = getWalletByAddress(addr.toLowerCase());
    expect(w.name).toBe('addrtest');
  });
});
