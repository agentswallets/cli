import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/core/errors.js';

vi.mock('../src/core/db.js', () => ({
  assertInitialized: vi.fn(),
  getDb: vi.fn(() => {
    const db = {
      prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) })),
      transaction: vi.fn((fn: () => unknown) => {
        const wrapper = () => fn();
        wrapper.immediate = () => fn();
        wrapper.exclusive = () => fn();
        wrapper.deferred = () => fn();
        return wrapper;
      })
    };
    return db;
  })
}));

vi.mock('../src/core/session.js', () => ({
  isSessionValid: vi.fn(() => true)
}));

vi.mock('../src/util/idempotency.js', () => ({
  reserveIdempotencyKey: vi.fn(),
  getOperationByIdempotencyKey: vi.fn(() => null),
  bindIdempotencyKeyRef: vi.fn()
}));

vi.mock('../src/core/wallet-store.js', () => ({
  getPolicy: vi.fn(() => ({
    daily_limit: 10,
    per_tx_limit: 10,
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

vi.mock('../src/core/tx-service.js', () => ({
  dailySpendStats: vi.fn(() => ({ todaySpent: 0, todayTxCount: 0 })),
  createPendingProviderOperation: vi.fn(() => 'tx_1'),
  finalizeProviderOperation: vi.fn()
}));

vi.mock('../src/core/policy-engine.js', () => ({
  evaluatePolicy: vi.fn(() => ({
    status: 'denied',
    code: 'ERR_DAILY_LIMIT_EXCEEDED',
    message: 'amount exceeds daily limit',
    details: { limit: '10', amount: '20' }
  }))
}));

describe('predict sell policy guard', () => {
  it('rejects sell when policy denies', async () => {
    const { polySellCommand } = await import('../src/commands/poly.js');
    await expect(
      polySellCommand('w1', {
        position: 'pos_1',
        size: '20',
        idempotencyKey: 'sell-denied-1'
      })
    ).rejects.toMatchObject<AppError>({
      code: 'ERR_DAILY_LIMIT_EXCEEDED'
    });
  });
});
