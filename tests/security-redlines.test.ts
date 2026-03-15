import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/core/schema.js';
import type { SecurityContext } from '../src/security/types.js';

let memDb: Database.Database;

vi.mock('../src/core/db.js', () => ({
  getDb: () => memDb,
  ensureDataDir: () => {},
  initDbSchema: () => memDb.exec(SCHEMA_SQL),
  assertInitialized: () => {},
  isInitialized: () => true
}));

describe('security redlines', () => {
  beforeEach(() => {
    memDb = new Database(':memory:');
    memDb.pragma('journal_mode = WAL');
    memDb.exec(SCHEMA_SQL);
  });

  afterEach(() => {
    memDb.close();
  });

  it('checkDrainAll triggers on wallet.drain', async () => {
    const { checkDrainAll } = await import('../src/security/redlines.js');
    const ctx: SecurityContext = { walletId: 'w1', action: 'wallet.drain' };
    const result = checkDrainAll(ctx);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('REQUIRE_CONFIRMATION');
    expect(result!.rule).toBe('DRAIN_ALL');
  });

  it('checkDrainAll returns null for tx.send', async () => {
    const { checkDrainAll } = await import('../src/security/redlines.js');
    const ctx: SecurityContext = { walletId: 'w1', action: 'tx.send' };
    expect(checkDrainAll(ctx)).toBeNull();
  });

  it('checkExportKey triggers on wallet.export_key', async () => {
    const { checkExportKey } = await import('../src/security/redlines.js');
    const ctx: SecurityContext = { walletId: 'w1', action: 'wallet.export_key' };
    const result = checkExportKey(ctx);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('REQUIRE_CONFIRMATION');
    expect(result!.rule).toBe('EXPORT_KEY');
  });

  it('checkLargeTransfer triggers above threshold', async () => {
    const { checkLargeTransfer } = await import('../src/security/redlines.js');
    const ctx: SecurityContext = { walletId: 'w1', action: 'tx.send', amount: 1500 };
    const result = checkLargeTransfer(ctx, 1000);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('REQUIRE_CONFIRMATION');
    expect(result!.rule).toBe('LARGE_TRANSFER');
  });

  it('checkLargeTransfer returns null below threshold', async () => {
    const { checkLargeTransfer } = await import('../src/security/redlines.js');
    const ctx: SecurityContext = { walletId: 'w1', action: 'tx.send', amount: 500 };
    expect(checkLargeTransfer(ctx, 1000)).toBeNull();
  });

  it('checkNewAddress triggers for unknown address', async () => {
    const { checkNewAddress } = await import('../src/security/redlines.js');
    const ctx: SecurityContext = { walletId: 'w1', action: 'tx.send', toAddress: '0xaaaa' };
    const hasHistory = () => false;
    const result = checkNewAddress(ctx, hasHistory);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('REQUIRE_CONFIRMATION');
    expect(result!.rule).toBe('NEW_ADDRESS');
  });

  it('checkNewAddress returns null for known address', async () => {
    const { checkNewAddress } = await import('../src/security/redlines.js');
    const ctx: SecurityContext = { walletId: 'w1', action: 'tx.send', toAddress: '0xaaaa' };
    const hasHistory = () => true;
    expect(checkNewAddress(ctx, hasHistory)).toBeNull();
  });

  it('checkAllBalanceSwap triggers at 90%+ balance', async () => {
    const { checkAllBalanceSwap } = await import('../src/security/redlines.js');
    const ctx: SecurityContext = { walletId: 'w1', action: 'swap.exec', amount: 95, token: 'USDC', chain: 'Polygon' };
    const getBalance = () => 100;
    const result = checkAllBalanceSwap(ctx, getBalance);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('REQUIRE_CONFIRMATION');
    expect(result!.rule).toBe('ALL_BALANCE_SWAP');
  });

  it('checkAllBalanceSwap returns null below 90%', async () => {
    const { checkAllBalanceSwap } = await import('../src/security/redlines.js');
    const ctx: SecurityContext = { walletId: 'w1', action: 'swap.exec', amount: 50, token: 'USDC', chain: 'Polygon' };
    const getBalance = () => 100;
    expect(checkAllBalanceSwap(ctx, getBalance)).toBeNull();
  });

  it('checkPolicyChange triggers on policy.set', async () => {
    const { checkPolicyChange } = await import('../src/security/redlines.js');
    const ctx: SecurityContext = { walletId: 'w1', action: 'policy.set' };
    const result = checkPolicyChange(ctx);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('REQUIRE_CONFIRMATION');
    expect(result!.rule).toBe('POLICY_CHANGE');
  });

  it('checkBlacklistedAddress blocks blacklisted address', async () => {
    const { addToBlacklist } = await import('../src/security/blacklist.js');
    const { checkBlacklistedAddress } = await import('../src/security/redlines.js');
    addToBlacklist('0xdead1234', undefined, 'scam');
    const ctx: SecurityContext = { walletId: 'w1', action: 'tx.send', toAddress: '0xdead1234' };
    const result = checkBlacklistedAddress(ctx);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('BLOCK');
    expect(result!.rule).toBe('BLACKLISTED_ADDRESS');
  });

  it('checkBlacklistedAddress returns null for clean address', async () => {
    const { checkBlacklistedAddress } = await import('../src/security/redlines.js');
    const ctx: SecurityContext = { walletId: 'w1', action: 'tx.send', toAddress: '0xaaaa1234' };
    expect(checkBlacklistedAddress(ctx)).toBeNull();
  });
});
