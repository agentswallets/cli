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

vi.mock('../src/core/session.js', () => ({
  isSessionValid: () => true,
  clearSession: () => {},
  touchSession: () => {}
}));

vi.mock('../src/core/wallet-store.js', () => ({
  getWalletById: (id: string) => ({
    id,
    name: 'test',
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    encrypted_private_key: '{}',
    key_type: 'legacy' as const,
    encrypted_mnemonic: null,
    encrypted_solana_key: null,
    solana_address: null,
    created_at: new Date().toISOString()
  }),
  resolveWallet: (identifier: string) => ({
    id: TEST_WALLET_ID,
    name: identifier,
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    encrypted_private_key: '{}',
    key_type: 'legacy' as const,
    encrypted_mnemonic: null,
    encrypted_solana_key: null,
    solana_address: null,
    created_at: new Date().toISOString()
  }),
  getPolicy: () => ({
    daily_limit: null,
    per_tx_limit: null,
    max_tx_per_day: null,
    allowed_tokens: [],
    allowed_addresses: [],
    require_approval_above: null
  })
}));

vi.mock('../src/core/crypto.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/core/crypto.js')>();
  return {
    ...original,
    decryptSecretAsBuffer: () => Buffer.from('ab'.repeat(32), 'hex')
  };
});

vi.mock('../src/core/audit-service.js', () => ({
  logAudit: vi.fn()
}));

vi.mock('../src/util/agent-input.js', () => ({
  getMasterPassword: async () => 'test-password',
  isNonInteractive: () => true
}));

// Mock hyperliquid modules
const mockGetPerps = vi.fn();
const mockGetPrices = vi.fn();
const mockGetFundingRates = vi.fn();
const mockResolveAssetIndex = vi.fn();

vi.mock('../src/core/hyperliquid/market.js', () => ({
  getPerps: mockGetPerps,
  getPrices: mockGetPrices,
  getFundingRates: mockGetFundingRates,
  resolveAssetIndex: mockResolveAssetIndex,
}));

const mockGetAccountSummary = vi.fn();
const mockGetOpenOrders = vi.fn();

vi.mock('../src/core/hyperliquid/account.js', () => ({
  getAccountSummary: mockGetAccountSummary,
  getOpenOrders: mockGetOpenOrders,
  getUserFills: vi.fn(),
}));

const mockOpenPosition = vi.fn();
const mockClosePosition = vi.fn();
const mockCancelOrder = vi.fn();

vi.mock('../src/core/hyperliquid/trading.js', () => ({
  openPosition: mockOpenPosition,
  closePosition: mockClosePosition,
  cancelOrder: mockCancelOrder,
}));

vi.mock('../src/core/hyperliquid/client.js', () => ({
  createInfoClient: vi.fn(),
  createExchangeClient: () => ({
    exchange: {},
    wallet: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  }),
}));

vi.mock('../src/core/hyperliquid/builder-fee.js', () => ({
  ensureBuilderFeeApproved: vi.fn().mockResolvedValue(undefined),
}));

const TEST_WALLET_ID = 'wallet-1';

beforeEach(() => {
  memDb = new Database(':memory:');
  memDb.pragma('journal_mode = WAL');
  memDb.pragma('foreign_keys = ON');
  memDb.exec(SCHEMA_SQL);
  // Insert a wallet to satisfy FK constraints
  memDb.prepare(
    'INSERT INTO wallets(id,name,address,encrypted_private_key,key_type,encrypted_mnemonic,encrypted_solana_key,solana_address,created_at) VALUES(?,?,?,?,?,?,?,?,?)'
  ).run(TEST_WALLET_ID, 'test', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '{}', 'legacy', null, null, null, new Date().toISOString());
  vi.clearAllMocks();
});

afterEach(() => {
  memDb.close();
});

describe('perp assets command', () => {
  it('returns asset list', async () => {
    mockGetPerps.mockResolvedValue({
      assets: [
        { name: 'BTC', szDecimals: 5, maxLeverage: 100 },
        { name: 'ETH', szDecimals: 4, maxLeverage: 50 },
      ],
      assetIndexMap: { BTC: 0, ETH: 1 },
    });

    const { perpAssetsCommand } = await import('../src/commands/perp.js');
    const result = await perpAssetsCommand();

    expect(result.assets).toHaveLength(2);
    expect(result.assets[0].name).toBe('BTC');
  });
});

describe('perp prices command', () => {
  it('returns all prices when no asset specified', async () => {
    mockGetPrices.mockResolvedValue({ BTC: '95000.0', ETH: '3200.0' });

    const { perpPricesCommand } = await import('../src/commands/perp.js');
    const result = await perpPricesCommand({});

    expect(result.prices).toEqual({ BTC: '95000.0', ETH: '3200.0' });
  });

  it('filters by asset when specified', async () => {
    mockGetPrices.mockResolvedValue({ BTC: '95000.0', ETH: '3200.0' });

    const { perpPricesCommand } = await import('../src/commands/perp.js');
    const result = await perpPricesCommand({ asset: 'btc' });

    expect(result.prices).toEqual({ BTC: '95000.0' });
  });

  it('throws for unknown asset', async () => {
    mockGetPrices.mockResolvedValue({ BTC: '95000.0' });

    const { perpPricesCommand } = await import('../src/commands/perp.js');
    try {
      await perpPricesCommand({ asset: 'FAKE' });
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('ERR_HL_INVALID_ASSET');
    }
  });
});

describe('perp funding command', () => {
  it('returns funding rates', async () => {
    mockGetFundingRates.mockResolvedValue([
      { coin: 'BTC', fundingRate: '0.0001', premium: '0.00005', time: 1700000000000 },
    ]);

    const { perpFundingCommand } = await import('../src/commands/perp.js');
    const result = await perpFundingCommand({ asset: 'btc' });

    expect(result.coin).toBe('BTC');
    expect(result.rates).toHaveLength(1);
  });
});

describe('perp account command', () => {
  it('returns account summary', async () => {
    mockGetAccountSummary.mockResolvedValue({
      accountValue: '10000.00',
      totalMarginUsed: '1000.00',
      withdrawable: '9000.00',
      positions: [{ coin: 'BTC', szi: '0.01', leverage: 5, entryPx: '95000.0', unrealizedPnl: '50.0', liquidationPx: '80000.0', marginUsed: '190.0' }],
    });

    const { perpAccountCommand } = await import('../src/commands/perp.js');
    const result = await perpAccountCommand(TEST_WALLET_ID);

    expect(result.accountValue).toBe('10000.00');
    expect(result.positions).toHaveLength(1);
  });
});

describe('perp open command', () => {
  it('returns dry_run result without executing', async () => {
    mockResolveAssetIndex.mockResolvedValue(0);
    mockGetPrices.mockResolvedValue({ BTC: '95000.0' });

    const { perpOpenCommand } = await import('../src/commands/perp.js');
    const result = await perpOpenCommand(TEST_WALLET_ID, {
      asset: 'BTC',
      side: 'long',
      size: '0.01',
      leverage: '5',
      idempotencyKey: 'test-key-1',
      dryRun: true,
    });

    expect(result.dry_run).toBe(true);
    expect(result.status).toBe('dry_run');
    expect(result.asset).toBe('BTC');
    expect(result.leverage).toBe(5);
  });

  it('executes open position with policy check', async () => {
    mockResolveAssetIndex.mockResolvedValue(0);
    mockGetPrices.mockResolvedValue({ BTC: '95000.0' });
    mockOpenPosition.mockResolvedValue({ oid: 42, avgPx: '95100.0', totalSz: '0.01' });

    const { perpOpenCommand } = await import('../src/commands/perp.js');
    const result = await perpOpenCommand(TEST_WALLET_ID, {
      asset: 'BTC',
      side: 'long',
      size: '0.01',
      idempotencyKey: 'test-key-2',
    });

    expect(result.status).toBe('confirmed');
    expect(result.oid).toBe(42);
    expect(result.avgPx).toBe('95100.0');
  });

  it('rejects invalid side', async () => {
    const { perpOpenCommand } = await import('../src/commands/perp.js');
    try {
      await perpOpenCommand(TEST_WALLET_ID, { asset: 'BTC', side: 'invalid', size: '0.01', idempotencyKey: 'k' });
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('ERR_INVALID_PARAMS');
    }
  });

  it('handles idempotent replay', async () => {
    mockResolveAssetIndex.mockResolvedValue(0);
    mockGetPrices.mockResolvedValue({ BTC: '95000.0' });
    mockOpenPosition.mockResolvedValue({ oid: 42, avgPx: '95100.0', totalSz: '0.01' });

    const { perpOpenCommand } = await import('../src/commands/perp.js');

    // First call
    const result1 = await perpOpenCommand(TEST_WALLET_ID, {
      asset: 'BTC',
      side: 'long',
      size: '0.01',
      idempotencyKey: 'idem-replay-1',
    });
    expect(result1.status).toBe('confirmed');

    // Second call with same key — should return replay
    const result2 = await perpOpenCommand(TEST_WALLET_ID, {
      asset: 'BTC',
      side: 'long',
      size: '0.01',
      idempotencyKey: 'idem-replay-1',
    });
    expect(result2.tx_id).toBe(result1.tx_id);
    expect(mockOpenPosition).toHaveBeenCalledTimes(1);
  });
});

describe('perp close command', () => {
  it('returns dry_run result', async () => {
    mockGetAccountSummary.mockResolvedValue({
      accountValue: '10000',
      totalMarginUsed: '1000',
      withdrawable: '9000',
      positions: [{ coin: 'BTC', szi: '0.01', leverage: 5, entryPx: '95000.0', unrealizedPnl: '50.0', liquidationPx: '80000.0', marginUsed: '190.0' }],
    });
    mockResolveAssetIndex.mockResolvedValue(0);
    mockGetPrices.mockResolvedValue({ BTC: '96000.0' });

    const { perpCloseCommand } = await import('../src/commands/perp.js');
    const result = await perpCloseCommand(TEST_WALLET_ID, {
      asset: 'BTC',
      idempotencyKey: 'close-dry',
      dryRun: true,
    });

    expect(result.dry_run).toBe(true);
    expect(result.size).toBe('0.01');
  });

  it('closes full position when no size specified', async () => {
    mockGetAccountSummary.mockResolvedValue({
      accountValue: '10000',
      totalMarginUsed: '1000',
      withdrawable: '9000',
      positions: [{ coin: 'BTC', szi: '0.01', leverage: 5, entryPx: '95000.0', unrealizedPnl: '50.0', liquidationPx: '80000.0', marginUsed: '190.0' }],
    });
    mockResolveAssetIndex.mockResolvedValue(0);
    mockGetPrices.mockResolvedValue({ BTC: '96000.0' });
    mockClosePosition.mockResolvedValue({ oid: 77, avgPx: '96000.0', totalSz: '0.01' });

    const { perpCloseCommand } = await import('../src/commands/perp.js');
    const result = await perpCloseCommand(TEST_WALLET_ID, {
      asset: 'BTC',
      idempotencyKey: 'close-full',
    });

    expect(result.status).toBe('confirmed');
    expect(mockClosePosition).toHaveBeenCalledWith(
      expect.objectContaining({ isBuy: false, size: '0.01' })
    );
  });

  it('throws if no open position', async () => {
    mockGetAccountSummary.mockResolvedValue({
      accountValue: '10000',
      totalMarginUsed: '0',
      withdrawable: '10000',
      positions: [],
    });

    const { perpCloseCommand } = await import('../src/commands/perp.js');
    await expect(
      perpCloseCommand(TEST_WALLET_ID, { asset: 'BTC', idempotencyKey: 'close-nope' })
    ).rejects.toThrow('No open position');
  });
});

describe('perp cancel command', () => {
  it('cancels an order', async () => {
    mockResolveAssetIndex.mockResolvedValue(0);
    mockCancelOrder.mockResolvedValue(undefined);

    const { perpCancelCommand } = await import('../src/commands/perp.js');
    const result = await perpCancelCommand(TEST_WALLET_ID, {
      asset: 'BTC',
      orderId: '12345',
      idempotencyKey: 'cancel-1',
    });

    expect(result.status).toBe('confirmed');
    expect(result.orderId).toBe(12345);
  });

  it('rejects non-numeric order ID', async () => {
    const { perpCancelCommand } = await import('../src/commands/perp.js');
    await expect(
      perpCancelCommand(TEST_WALLET_ID, { asset: 'BTC', orderId: 'abc', idempotencyKey: 'cancel-bad' })
    ).rejects.toThrow('order-id must be a number');
  });
});
