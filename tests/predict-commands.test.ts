import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/core/db.js', () => ({
  assertInitialized: vi.fn(),
  getDb: vi.fn(() => ({
    transaction: (fn: () => unknown) => {
      const wrapper = () => fn();
      wrapper.immediate = () => fn();
      wrapper.exclusive = () => fn();
      wrapper.deferred = () => fn();
      return wrapper;
    }
  }))
}));

vi.mock('../src/core/session.js', () => ({
  isSessionValid: vi.fn(() => true)
}));

vi.mock('../src/core/policy-engine.js', () => ({
  evaluatePolicy: vi.fn(() => ({ status: 'allowed' }))
}));

vi.mock('../src/core/wallet-store.js', () => ({
  getPolicy: vi.fn(() => ({
    daily_limit: null,
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

vi.mock('../src/core/tx-service.js', () => ({
  createPendingProviderOperation: vi.fn(() => 'tx_123'),
  finalizeProviderOperation: vi.fn(),
  dailySpendStats: vi.fn(() => ({ todaySpent: 0, todayTxCount: 0 })),
  preflightBalanceCheck: vi.fn(async () => {})
}));

vi.mock('../src/util/idempotency.js', () => ({
  reserveIdempotencyKey: vi.fn(),
  getOperationByIdempotencyKey: vi.fn(() => null),
  bindIdempotencyKeyRef: vi.fn()
}));

vi.mock('../src/util/agent-input.js', () => ({
  getMasterPassword: vi.fn(async () => 'StrongPass123')
}));

vi.mock('../src/core/crypto.js', () => ({
  decryptSecretAsBuffer: vi.fn(() => Buffer.from('0xabc', 'utf8'))
}));

vi.mock('../src/core/audit-service.js', () => ({
  logAudit: vi.fn()
}));

const adapter = {
  searchMarkets: vi.fn(async () => ({ data: [{ id: 'm1' }], raw: { elapsed_ms: 10 } })),
  buy: vi.fn(async () => ({ provider_order_id: 'ord_buy_1', provider_status: 'submitted', data: { ok: true } })),
  sell: vi.fn(async () => ({ provider_order_id: 'ord_sell_1', provider_status: 'submitted', data: { ok: true } })),
  positions: vi.fn(async () => ({ data: [{ position_id: 'p1' }] })),
  orders: vi.fn(async () => ({ data: [{ id: 'ord_buy_1' }] }))
};

vi.mock('../src/core/polymarket/factory.js', () => ({
  getPolymarketAdapter: vi.fn(() => adapter)
}));

describe('predict command integration (mock adapter)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('predict markets returns flattened markets array', async () => {
    const { polySearchCommand } = await import('../src/commands/poly.js');
    const out = (await polySearchCommand('trump', 10)) as { markets: Array<{ id: string }> };
    expect(out.markets[0]?.id).toBe('m1');
  });

  it('predict buy returns tx_id + provider_order_id', async () => {
    const { polyBuyCommand } = await import('../src/commands/poly.js');
    const out = (await polyBuyCommand('w1', {
      market: 'm1',
      outcome: 'yes',
      size: '2',
      price: '0.4',
      idempotencyKey: 'k_buy_1'
    })) as { tx_id: string; provider_order_id: string };
    expect(out.tx_id).toBe('tx_123');
    expect(out.provider_order_id).toBe('ord_buy_1');
  });

  it('predict sell returns tx_id + provider_order_id', async () => {
    const { polySellCommand } = await import('../src/commands/poly.js');
    const out = (await polySellCommand('w1', {
      position: 'pos_1',
      size: '1',
      idempotencyKey: 'k_sell_1'
    })) as { tx_id: string; provider_order_id: string };
    expect(out.tx_id).toBe('tx_123');
    expect(out.provider_order_id).toBe('ord_sell_1');
  });

  it('predict buy replay returns same shape as new execution', async () => {
    const idempotencyMod = await import('../src/util/idempotency.js');
    vi.mocked(idempotencyMod.getOperationByIdempotencyKey).mockReturnValueOnce({
      tx_id: 'tx_replay',
      tx_hash: null,
      provider_order_id: 'ord_replay',
      status: 'submitted',
      token: 'USDC',
      amount: '0.8',
      to_address: null
    });

    const { polyBuyCommand } = await import('../src/commands/poly.js');
    const replay = (await polyBuyCommand('w1', {
      market: 'm1',
      outcome: 'yes',
      size: '2',
      price: '0.4',
      idempotencyKey: 'k_buy_replay'
    })) as { tx_id: string; provider_order_id: string | null; provider_status: string };

    expect(replay.tx_id).toBe('tx_replay');
    expect(replay.provider_order_id).toBe('ord_replay');
    expect(replay.provider_status).toBe('submitted');
    // Must NOT leak raw DB columns
    expect(replay).not.toHaveProperty('tx_hash');
    expect(replay).not.toHaveProperty('to_address');
    expect(replay).not.toHaveProperty('token');
    expect(replay).not.toHaveProperty('amount');
  });

  it('predict sell replay returns same shape as new execution', async () => {
    const idempotencyMod = await import('../src/util/idempotency.js');
    vi.mocked(idempotencyMod.getOperationByIdempotencyKey).mockReturnValueOnce({
      tx_id: 'tx_sell_replay',
      tx_hash: null,
      provider_order_id: 'ord_sell_replay',
      status: 'submitted',
      token: 'USDC',
      amount: '1',
      to_address: null
    });

    const { polySellCommand } = await import('../src/commands/poly.js');
    const replay = (await polySellCommand('w1', {
      position: 'pos_1',
      size: '1',
      idempotencyKey: 'k_sell_replay'
    })) as { tx_id: string; provider_order_id: string | null; provider_status: string };

    expect(replay.tx_id).toBe('tx_sell_replay');
    expect(replay.provider_order_id).toBe('ord_sell_replay');
    expect(replay.provider_status).toBe('submitted');
    expect(replay).not.toHaveProperty('tx_hash');
    expect(replay).not.toHaveProperty('to_address');
  });

  it('predict positions and orders return flattened arrays', async () => {
    const { polyPositionsCommand, polyOrdersCommand } = await import('../src/commands/poly.js');
    const p = (await polyPositionsCommand('w1')) as { positions: Array<{ position_id: string }> };
    const o = (await polyOrdersCommand('w1')) as { orders: Array<{ id: string }> };
    expect(p.positions[0]?.position_id).toBe('p1');
    expect(o.orders[0]?.id).toBe('ord_buy_1');
  });
});
