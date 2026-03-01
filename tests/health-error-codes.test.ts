import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const origArgv = [...process.argv];
const origEnv = { ...process.env };

// Mock deps shared across all tests
vi.mock('../src/core/wallet-store.js', () => ({
  listWallets: () => [],
  getWalletById: () => { throw new Error('not found'); },
  getPolicy: () => ({ daily_limit: null, per_tx_limit: null, max_tx_per_day: null, allowed_tokens: [], allowed_addresses: [], require_approval_above: null }),
  upsertPolicy: () => {},
  insertWallet: () => ({})
}));

describe('health handler error classification', () => {
  beforeEach(() => {
    process.argv = ['node', 'aw'];
  });

  afterEach(() => {
    process.argv = [...origArgv];
    process.env = { ...origEnv };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('throws ERR_NOT_INITIALIZED when DB is not initialized', async () => {
    vi.doMock('../src/core/db.js', () => ({
      getDb: () => ({}),
      ensureDataDir: () => {},
      isInitialized: () => false,
      assertInitialized: () => {}
    }));
    vi.doMock('../src/core/session.js', () => ({ isSessionValid: () => false, touchSession: () => {} }));
    vi.doMock('../src/core/rpc.js', () => ({
      getProvider: () => ({ getNetwork: async () => ({ chainId: 137n }) })
    }));

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    process.argv = ['node', 'aw', 'health', '--json'];

    try {
      await cli.parseAsync(process.argv);
    } catch { /* exitOverride throws */ }

    const errOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).filter(s => { try { return JSON.parse(s).ok === false; } catch { return false; } }).join('');
    const parsed = JSON.parse(errOutput.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('ERR_NOT_INITIALIZED');
  });

  it('throws ERR_RPC_UNAVAILABLE when RPC fails', async () => {
    vi.doMock('../src/core/db.js', () => ({
      getDb: () => ({}),
      ensureDataDir: () => {},
      isInitialized: () => true,
      assertInitialized: () => {}
    }));
    vi.doMock('../src/core/session.js', () => ({ isSessionValid: () => false, touchSession: () => {} }));
    vi.doMock('../src/core/rpc.js', () => ({
      getProvider: () => ({
        getNetwork: async () => { throw new Error('ECONNREFUSED'); }
      })
    }));

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    process.argv = ['node', 'aw', 'health', '--json'];

    try {
      await cli.parseAsync(process.argv);
    } catch { /* exitOverride throws */ }

    const errOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).filter(s => { try { return JSON.parse(s).ok === false; } catch { return false; } }).join('');
    const parsed = JSON.parse(errOutput.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('ERR_RPC_UNAVAILABLE');
  });

  it('DB failure takes priority when both DB and RPC fail', async () => {
    vi.doMock('../src/core/db.js', () => ({
      getDb: () => ({}),
      ensureDataDir: () => {},
      isInitialized: () => false,
      assertInitialized: () => {}
    }));
    vi.doMock('../src/core/session.js', () => ({ isSessionValid: () => false, touchSession: () => {} }));
    vi.doMock('../src/core/rpc.js', () => ({
      getProvider: () => ({
        getNetwork: async () => { throw new Error('ECONNREFUSED'); }
      })
    }));

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    process.argv = ['node', 'aw', 'health', '--json'];

    try {
      await cli.parseAsync(process.argv);
    } catch { /* exitOverride throws */ }

    const errOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).filter(s => { try { return JSON.parse(s).ok === false; } catch { return false; } }).join('');
    const parsed = JSON.parse(errOutput.trim());
    expect(parsed.ok).toBe(false);
    // DB failure is more critical, checked first
    expect(parsed.error.code).toBe('ERR_NOT_INITIALIZED');
  });
});
