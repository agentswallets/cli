import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * P0 concurrent test: Verify that two transactions individually under the daily limit
 * but together exceeding it are handled correctly — one succeeds, one gets rejected.
 *
 * This tests the IMMEDIATE transaction lock in tx.ts that wraps
 * dailySpendStats + evaluatePolicy + createPendingProviderOperation.
 */

// Shared state to simulate concurrent spend accumulation
let insertedOps: Array<{ wallet_id: string; token: string; amount: string; created_at: string }> = [];

const mockPrepare = vi.fn((sql: string) => {
  // SELECT sum for dailySpendStats — returns total from insertedOps
  if (/COALESCE\(SUM/i.test(sql)) {
    return {
      get: (_walletId: string, token: string) => {
        const total = insertedOps
          .filter((o) => o.token === token)
          .reduce((sum, o) => sum + Number(o.amount), 0);
        return { total };
      }
    };
  }
  // SELECT count for todayTxCount
  if (/COUNT\(\*\)/i.test(sql)) {
    return {
      get: () => ({ cnt: insertedOps.length })
    };
  }
  // INSERT into operations — track for spend accumulation
  if (/INSERT INTO operations/i.test(sql)) {
    return {
      run: (...args: unknown[]) => {
        const walletId = args[1] as string;
        const token = args[4] as string;
        const amount = args[5] as string;
        insertedOps.push({
          wallet_id: walletId,
          token,
          amount,
          created_at: new Date().toISOString()
        });
      }
    };
  }
  // Default passthrough
  return { run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) };
});

// Track whether IMMEDIATE was used (the critical lock)
let immediateUsed = false;

vi.mock('../src/core/db.js', () => ({
  assertInitialized: vi.fn(),
  getDb: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: (fn: () => unknown) => {
      const wrapper = () => fn();
      wrapper.immediate = () => {
        immediateUsed = true;
        return fn();
      };
      wrapper.exclusive = () => fn();
      wrapper.deferred = () => fn();
      return wrapper;
    }
  }))
}));

vi.mock('../src/core/session.js', () => ({
  isSessionValid: vi.fn(() => true)
}));

vi.mock('../src/core/wallet-store.js', () => ({
  getPolicy: vi.fn(() => ({
    daily_limit: 500,
    per_tx_limit: null,
    max_tx_per_day: null,
    allowed_tokens: [],
    allowed_addresses: [],
    require_approval_above: null
  })),
  getWalletById: vi.fn(() => ({
    id: 'w1',
    name: 'bot',
    address: '0x1111111111111111111111111111111111111111',
    encrypted_private_key: 'enc',
    created_at: new Date().toISOString()
  }))
}));

vi.mock('../src/util/idempotency.js', () => ({
  reserveIdempotencyKey: vi.fn(),
  getOperationByIdempotencyKey: vi.fn(() => null)
}));

vi.mock('../src/util/agent-input.js', () => ({
  getMasterPassword: vi.fn(async () => 'StrongPass123')
}));

vi.mock('../src/core/crypto.js', () => ({
  decryptSecretAsBuffer: vi.fn(() => Buffer.from('0x' + 'ab'.repeat(32)))
}));

vi.mock('../src/core/audit-service.js', () => ({
  logAudit: vi.fn()
}));

// Mock executeSend to avoid real RPC calls — it's called after the atomic block
vi.mock('../src/core/tx-service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/core/tx-service.js')>();
  return {
    ...original,
    executeSend: vi.fn(async (input: { wallet_id: string; to: string; token: string; amount: string; txId?: string }) => ({
      tx_id: input.txId || 'tx_mock',
      tx_hash: '0xmockhash',
      status: 'confirmed',
      token: input.token,
      amount: input.amount,
      to: input.to
    }))
  };
});

describe('P0: concurrent spend limit enforcement', () => {
  beforeEach(() => {
    insertedOps = [];
    immediateUsed = false;
    vi.clearAllMocks();
  });

  it('uses IMMEDIATE transaction for atomic policy check', async () => {
    const { txSendCommand } = await import('../src/commands/tx.js');

    await txSendCommand('w1', {
      to: '0x2222222222222222222222222222222222222222',
      amount: '100',
      token: 'USDC',
      idempotencyKey: 'k_imm_1'
    });

    expect(immediateUsed).toBe(true);
  });

  it('sequential requests: first passes, second exceeds $500 daily limit', async () => {
    const { txSendCommand } = await import('../src/commands/tx.js');

    // First tx: $300 — should pass (300 < 500)
    const result1 = await txSendCommand('w1', {
      to: '0x2222222222222222222222222222222222222222',
      amount: '300',
      token: 'USDC',
      idempotencyKey: 'k_seq_1'
    });
    expect(result1.status).toBeDefined();

    // Second tx: $300 — should fail (300 + 300 = 600 > 500)
    // insertedOps now has the first $300, so dailySpendStats returns 300
    const err: any = await txSendCommand('w1', {
      to: '0x2222222222222222222222222222222222222222',
      amount: '300',
      token: 'USDC',
      idempotencyKey: 'k_seq_2'
    }).catch((e) => e);

    expect(err.code).toBe('ERR_DAILY_LIMIT_EXCEEDED');
  });

  it('two requests at exactly the limit boundary: second must be rejected', async () => {
    const { txSendCommand } = await import('../src/commands/tx.js');

    // First: $250 — passes
    await txSendCommand('w1', {
      to: '0x2222222222222222222222222222222222222222',
      amount: '250',
      token: 'USDC',
      idempotencyKey: 'k_boundary_1'
    });

    // Second: $251 — 250 + 251 = 501 > 500, must fail
    const err: any = await txSendCommand('w1', {
      to: '0x2222222222222222222222222222222222222222',
      amount: '251',
      token: 'USDC',
      idempotencyKey: 'k_boundary_2'
    }).catch((e) => e);

    expect(err.code).toBe('ERR_DAILY_LIMIT_EXCEEDED');
  });

  it('different tokens have independent daily limits', async () => {
    const { txSendCommand } = await import('../src/commands/tx.js');

    // $400 USDC — passes
    await txSendCommand('w1', {
      to: '0x2222222222222222222222222222222222222222',
      amount: '400',
      token: 'USDC',
      idempotencyKey: 'k_token_1'
    });

    // $400 POL — should pass (independent daily limit, different token)
    const result = await txSendCommand('w1', {
      to: '0x2222222222222222222222222222222222222222',
      amount: '400',
      token: 'POL',
      idempotencyKey: 'k_token_2'
    });
    expect(result.status).toBeDefined();
  });
});
