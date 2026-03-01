import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/core/db.js', () => ({
  getDb: () => ({}),
  ensureDataDir: () => {},
  isInitialized: () => true,
  assertInitialized: () => {}
}));

vi.mock('../src/core/session.js', () => ({
  isSessionValid: () => false
}));

vi.mock('../src/core/rpc.js', () => ({
  getProvider: () => ({
    getNetwork: async () => ({ chainId: 137n })
  })
}));

describe('health command', () => {
  const originalEnv = process.env.AW_RPC_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AW_RPC_URL;
    } else {
      process.env.AW_RPC_URL = originalEnv;
    }
  });

  it('returns health status object with top-level ok', async () => {
    const { healthCommand } = await import('../src/commands/health.js');
    const result = await healthCommand();
    expect(result).toHaveProperty('ok');
    expect(result).toHaveProperty('version');
    expect(result).toHaveProperty('chain_id', 137);
    expect(result).toHaveProperty('db');
    expect(result).toHaveProperty('session');
    expect(result).toHaveProperty('rpc');
    expect(result).toHaveProperty('polymarket_cli');
    expect(result.db.ok).toBe(true);
    expect(result.session.ok).toBe(false);
    expect(result.rpc.ok).toBe(true);
    // db.ok && rpc.ok => ok=true
    expect(result.ok).toBe(true);
  });

  it('redacts API key from RPC URL', async () => {
    process.env.AW_RPC_URL = 'https://eth-mainnet.g.alchemy.com/v2/abc123secretkey';
    vi.resetModules();
    vi.doMock('../src/core/db.js', () => ({
      getDb: () => ({}),
      ensureDataDir: () => {},
      isInitialized: () => true,
      assertInitialized: () => {}
    }));
    vi.doMock('../src/core/session.js', () => ({ isSessionValid: () => false }));
    vi.doMock('../src/core/rpc.js', () => ({
      getProvider: () => ({ getNetwork: async () => ({ chainId: 137n }) })
    }));
    const { healthCommand } = await import('../src/commands/health.js');
    const result = await healthCommand();

    expect(result.rpc.url).not.toContain('abc123secretkey');
    expect(result.rpc.url).toContain('/***');
    expect(result.rpc.url).toContain('alchemy.com');
  });

  it('redacts API key from query param URL', async () => {
    process.env.AW_RPC_URL = 'https://rpc.example.com/rpc?apikey=mysecret123';
    vi.resetModules();
    vi.doMock('../src/core/db.js', () => ({
      getDb: () => ({}),
      ensureDataDir: () => {},
      isInitialized: () => true,
      assertInitialized: () => {}
    }));
    vi.doMock('../src/core/session.js', () => ({ isSessionValid: () => false }));
    vi.doMock('../src/core/rpc.js', () => ({
      getProvider: () => ({ getNetwork: async () => ({ chainId: 137n }) })
    }));
    const { healthCommand } = await import('../src/commands/health.js');
    const result = await healthCommand();

    expect(result.rpc.url).not.toContain('mysecret123');
    expect(result.rpc.url).toContain('apikey=***');
  });

  it('sanitizes RPC error messages via safeSummary', async () => {
    vi.resetModules();
    vi.doMock('../src/core/db.js', () => ({
      getDb: () => ({}),
      ensureDataDir: () => {},
      isInitialized: () => true,
      assertInitialized: () => {}
    }));
    vi.doMock('../src/core/session.js', () => ({ isSessionValid: () => false }));
    vi.doMock('../src/core/rpc.js', () => ({
      getProvider: () => ({
        getNetwork: async () => { throw new Error('connect ECONNREFUSED https://eth-mainnet.g.alchemy.com/v2/secretkey999'); }
      })
    }));
    const { healthCommand } = await import('../src/commands/health.js');
    const result = await healthCommand();

    expect(result.rpc.ok).toBe(false);
    expect(result.rpc.error).toBeDefined();
    expect(result.rpc.error).not.toContain('secretkey999');
  });

  it('ok is false when rpc fails', async () => {
    vi.resetModules();
    vi.doMock('../src/core/db.js', () => ({
      getDb: () => ({}),
      ensureDataDir: () => {},
      isInitialized: () => true,
      assertInitialized: () => {}
    }));
    vi.doMock('../src/core/session.js', () => ({ isSessionValid: () => false }));
    vi.doMock('../src/core/rpc.js', () => ({
      getProvider: () => ({
        getNetwork: async () => { throw new Error('connection refused'); }
      })
    }));
    const { healthCommand } = await import('../src/commands/health.js');
    const result = await healthCommand();
    expect(result.rpc.ok).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('ok is false when db is not initialized', async () => {
    vi.resetModules();
    vi.doMock('../src/core/db.js', () => ({
      getDb: () => ({}),
      ensureDataDir: () => {},
      isInitialized: () => false,
      assertInitialized: () => {}
    }));
    vi.doMock('../src/core/session.js', () => ({ isSessionValid: () => false }));
    vi.doMock('../src/core/rpc.js', () => ({
      getProvider: () => ({ getNetwork: async () => ({ chainId: 137n }) })
    }));
    const { healthCommand } = await import('../src/commands/health.js');
    const result = await healthCommand();
    expect(result.db.ok).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('health failure from DB returns ERR_NOT_INITIALIZED in result', async () => {
    vi.resetModules();
    vi.doMock('../src/core/db.js', () => ({
      getDb: () => ({}),
      ensureDataDir: () => {},
      isInitialized: () => false,
      assertInitialized: () => {}
    }));
    vi.doMock('../src/core/session.js', () => ({ isSessionValid: () => false }));
    vi.doMock('../src/core/rpc.js', () => ({
      getProvider: () => ({ getNetwork: async () => ({ chainId: 137n }) })
    }));
    const { healthCommand } = await import('../src/commands/health.js');
    const result = await healthCommand();
    // healthCommand returns data; cli.ts handler classifies the error code
    expect(result.ok).toBe(false);
    expect(result.db.ok).toBe(false);
    expect(result.db.error).toBe('not initialized');
  });

  it('health failure from RPC returns rpc error info', async () => {
    vi.resetModules();
    vi.doMock('../src/core/db.js', () => ({
      getDb: () => ({}),
      ensureDataDir: () => {},
      isInitialized: () => true,
      assertInitialized: () => {}
    }));
    vi.doMock('../src/core/session.js', () => ({ isSessionValid: () => false }));
    vi.doMock('../src/core/rpc.js', () => ({
      getProvider: () => ({
        getNetwork: async () => { throw new Error('ECONNREFUSED'); }
      })
    }));
    const { healthCommand } = await import('../src/commands/health.js');
    const result = await healthCommand();
    expect(result.ok).toBe(false);
    expect(result.rpc.ok).toBe(false);
    expect(result.rpc.error).toBeDefined();
  });

  it('tries polymarket-cli before polymarket', async () => {
    const callLog: string[] = [];
    vi.resetModules();
    vi.doMock('../src/core/db.js', () => ({
      getDb: () => ({}),
      ensureDataDir: () => {},
      isInitialized: () => true,
      assertInitialized: () => {}
    }));
    vi.doMock('../src/core/session.js', () => ({ isSessionValid: () => false }));
    vi.doMock('../src/core/rpc.js', () => ({
      getProvider: () => ({ getNetwork: async () => ({ chainId: 137n }) })
    }));
    vi.doMock('node:child_process', () => ({
      execFileSync: (binary: string) => {
        callLog.push(binary);
        if (binary === 'polymarket-cli') throw new Error('not found');
        if (binary === 'polymarket') return Buffer.from('1.0.0');
        throw new Error('not found');
      }
    }));
    const { healthCommand } = await import('../src/commands/health.js');
    const result = await healthCommand();

    // Should try polymarket-cli first
    expect(callLog[0]).toBe('polymarket-cli');
    // Falls back to polymarket
    expect(callLog).toContain('polymarket');
    expect(result.polymarket_cli.ok).toBe(true);
  });
});
