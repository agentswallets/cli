import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

// Mock confirmAction to auto-approve by default
vi.mock('../src/util/agent-input.js', () => ({
  confirmAction: vi.fn().mockResolvedValue(true),
  getMasterPassword: vi.fn().mockResolvedValue('testpass'),
  isNonInteractive: () => true,
}));

// Mock config for audit-service
vi.mock('../src/core/config.js', () => ({
  getHomeDir: () => '/tmp/test-aw',
  getDbPath: () => ':memory:',
}));

describe('security guard', () => {
  beforeEach(() => {
    memDb = new Database(':memory:');
    memDb.pragma('journal_mode = WAL');
    memDb.exec(SCHEMA_SQL);
    // Allow --yes auto-confirm for tests
    process.env.AW_ALLOW_YES = '1';
  });

  afterEach(() => {
    delete process.env.AW_ALLOW_YES;
    memDb.close();
  });

  it('allows normal transaction with no warnings', async () => {
    const { securityCheck } = await import('../src/security/guard.js');
    const ctx: SecurityContext = {
      walletId: 'w1',
      action: 'tx.send',
      amount: 10,
      toAddress: '0xaaaa1111222233334444555566667777aaaabbbb',
    };
    // Mock that address has history
    const result = await securityCheck(ctx, {
      yes: true,
      hasHistory: () => true,
      getRecentTxCount: () => 0,
    });
    expect(result.warnings.length).toBe(0);
  });

  it('blocks blacklisted address', async () => {
    const { addToBlacklist } = await import('../src/security/blacklist.js');
    const { securityCheck } = await import('../src/security/guard.js');

    addToBlacklist('0xdead', undefined, 'scam');

    const ctx: SecurityContext = {
      walletId: 'w1',
      action: 'tx.send',
      toAddress: '0xdead',
    };

    await expect(securityCheck(ctx)).rejects.toThrow('security blacklist');
  });

  it('requires confirmation for large transfer with --yes', async () => {
    const { securityCheck } = await import('../src/security/guard.js');
    const ctx: SecurityContext = {
      walletId: 'w1',
      action: 'tx.send',
      amount: 5000,
      toAddress: '0xaaaa',
    };
    const result = await securityCheck(ctx, {
      yes: true,
      hasHistory: () => true,
      getRecentTxCount: () => 0,
    });
    // Should have LARGE_TRANSFER warning (confirmed via --yes)
    expect(result.warnings.some(w => w.rule === 'LARGE_TRANSFER')).toBe(true);
  });

  it('blocks when user denies red line confirmation', async () => {
    const agentInput = await import('../src/util/agent-input.js');
    vi.mocked(agentInput.confirmAction).mockResolvedValueOnce(false);

    const { securityCheck } = await import('../src/security/guard.js');
    const ctx: SecurityContext = {
      walletId: 'w1',
      action: 'wallet.drain',
    };

    await expect(securityCheck(ctx, {
      hasHistory: () => true,
      getRecentTxCount: () => 0,
    })).rejects.toThrow();
  });

  it('collects yellow line warnings', async () => {
    const { securityCheck } = await import('../src/security/guard.js');
    const ctx: SecurityContext = {
      walletId: 'w1',
      action: 'perp.open',
      amount: 10000,
      leverage: 25,
    };
    const result = await securityCheck(ctx, {
      yes: true,
      hasHistory: () => true,
      getRecentTxCount: () => 0,
    });
    // Should have HIGH_LEVERAGE and LARGE_PERP_POSITION warnings
    expect(result.warnings.some(w => w.rule === 'HIGH_LEVERAGE')).toBe(true);
    expect(result.warnings.some(w => w.rule === 'LARGE_PERP_POSITION')).toBe(true);
  });

  it('force flag suppresses yellow line stderr output but still collects warnings', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { securityCheck } = await import('../src/security/guard.js');
    const ctx: SecurityContext = {
      walletId: 'w1',
      action: 'perp.open',
      leverage: 25,
    };
    const result = await securityCheck(ctx, {
      yes: true,
      force: true,
      hasHistory: () => true,
      getRecentTxCount: () => 0,
    });
    // Should have HIGH_LEVERAGE warning collected
    expect(result.warnings.some(w => w.rule === 'HIGH_LEVERAGE')).toBe(true);
    // But no stderr output (force suppresses it)
    const securityCalls = stderrSpy.mock.calls.filter(
      c => typeof c[0] === 'string' && c[0].includes('[security warning]')
    );
    expect(securityCalls.length).toBe(0);
    stderrSpy.mockRestore();
  });

  // ── Combination scenarios ──

  it('collects both red line and yellow line warnings in one call', async () => {
    const { securityCheck } = await import('../src/security/guard.js');
    // Large transfer (red) + high leverage (yellow) + large perp (yellow)
    const ctx: SecurityContext = {
      walletId: 'w1',
      action: 'perp.open',
      amount: 10000,
      leverage: 25,
    };
    const result = await securityCheck(ctx, {
      yes: true,
      hasHistory: () => true,
      getRecentTxCount: () => 0,
    });
    // Should have LARGE_TRANSFER (red, confirmed) + HIGH_LEVERAGE (yellow) + LARGE_PERP_POSITION (yellow)
    expect(result.warnings.some(w => w.rule === 'LARGE_TRANSFER')).toBe(true);
    expect(result.warnings.some(w => w.rule === 'HIGH_LEVERAGE')).toBe(true);
    expect(result.warnings.some(w => w.rule === 'LARGE_PERP_POSITION')).toBe(true);
    expect(result.warnings.length).toBe(3);
  });

  it('gracefully handles hasHistory callback throwing', async () => {
    const { securityCheck } = await import('../src/security/guard.js');
    const ctx: SecurityContext = {
      walletId: 'w1',
      action: 'tx.send',
      amount: 10,
      toAddress: '0xaaaa',
    };
    // hasHistory throws — securityCheck should propagate the error
    await expect(securityCheck(ctx, {
      yes: true,
      hasHistory: () => { throw new Error('DB connection lost'); },
      getRecentTxCount: () => 0,
    })).rejects.toThrow('DB connection lost');
  });

  it('gracefully handles getBalance callback throwing', async () => {
    const { securityCheck } = await import('../src/security/guard.js');
    const ctx: SecurityContext = {
      walletId: 'w1',
      action: 'swap.exec',
      amount: 100,
      token: 'USDC',
      chain: 'Polygon',
    };
    // getBalance throws — should propagate
    await expect(securityCheck(ctx, {
      yes: true,
      hasHistory: () => true,
      getRecentTxCount: () => 0,
      getBalance: () => { throw new Error('RPC timeout'); },
    })).rejects.toThrow('RPC timeout');
  });

  it('blocks --yes auto-confirm when AW_ALLOW_YES is not set', async () => {
    delete process.env.AW_ALLOW_YES;
    const agentInput = await import('../src/util/agent-input.js');
    // confirmAction will be called with effectiveYes=false, mock returns false (user denies)
    vi.mocked(agentInput.confirmAction).mockResolvedValueOnce(false);

    const { securityCheck } = await import('../src/security/guard.js');
    const ctx: SecurityContext = {
      walletId: 'w1',
      action: 'tx.send',
      amount: 5000,
      toAddress: '0xaaaa',
    };
    await expect(securityCheck(ctx, {
      yes: true, // --yes passed, but AW_ALLOW_YES not set → should still prompt
      hasHistory: () => true,
      getRecentTxCount: () => 0,
    })).rejects.toThrow();
  });
});
