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

const mockClearinghouseState = vi.fn();
const mockOpenOrders = vi.fn();
const mockUserFills = vi.fn();

vi.mock('../src/core/hyperliquid/client.js', () => ({
  createInfoClient: () => ({
    clearinghouseState: mockClearinghouseState,
    openOrders: mockOpenOrders,
    userFills: mockUserFills,
  }),
}));

beforeEach(() => {
  memDb = new Database(':memory:');
  memDb.pragma('journal_mode = WAL');
  memDb.exec(SCHEMA_SQL);
  vi.clearAllMocks();
});

afterEach(() => {
  memDb.close();
});

describe('Hyperliquid account — getAccountSummary', () => {
  it('returns parsed account summary with positions', async () => {
    mockClearinghouseState.mockResolvedValue({
      marginSummary: {
        accountValue: '10000.00',
        totalNtlPos: '5000.00',
        totalRawUsd: '5000.00',
        totalMarginUsed: '1000.00',
      },
      crossMarginSummary: {
        accountValue: '10000.00',
        totalNtlPos: '5000.00',
        totalRawUsd: '5000.00',
        totalMarginUsed: '1000.00',
      },
      crossMaintenanceMarginUsed: '500.00',
      withdrawable: '9000.00',
      assetPositions: [
        {
          type: 'oneWay',
          position: {
            coin: 'BTC',
            szi: '0.01',
            leverage: { type: 'cross', value: 5 },
            entryPx: '95000.0',
            positionValue: '950.0',
            unrealizedPnl: '50.0',
            returnOnEquity: '0.05',
            liquidationPx: '80000.0',
            marginUsed: '190.0',
            maxLeverage: 100,
            cumFunding: { allTime: '-5.0', sinceOpen: '-2.0', sinceChange: '-1.0' },
          },
        },
        {
          type: 'oneWay',
          position: {
            coin: 'ETH',
            szi: '0',
            leverage: { type: 'cross', value: 1 },
            entryPx: '0',
            positionValue: '0',
            unrealizedPnl: '0',
            returnOnEquity: '0',
            liquidationPx: null,
            marginUsed: '0',
            maxLeverage: 50,
            cumFunding: { allTime: '0', sinceOpen: '0', sinceChange: '0' },
          },
        },
      ],
      time: Date.now(),
    });

    const { getAccountSummary } = await import('../src/core/hyperliquid/account.js');
    const summary = await getAccountSummary('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    expect(summary.accountValue).toBe('10000.00');
    expect(summary.totalMarginUsed).toBe('1000.00');
    expect(summary.withdrawable).toBe('9000.00');
    expect(summary.positions).toHaveLength(1);
    expect(summary.positions[0].coin).toBe('BTC');
    expect(summary.positions[0].szi).toBe('0.01');
    expect(summary.positions[0].leverage).toBe(5);
  });

  it('wraps API errors', async () => {
    mockClearinghouseState.mockRejectedValue(new Error('api down'));

    const { getAccountSummary } = await import('../src/core/hyperliquid/account.js');
    try {
      await getAccountSummary('0xaaaa');
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('ERR_HL_API_FAILED');
    }
  });
});

describe('Hyperliquid account — getOpenOrders', () => {
  it('returns parsed orders with side mapping', async () => {
    mockOpenOrders.mockResolvedValue([
      { coin: 'BTC', side: 'B', limitPx: '94000.0', sz: '0.01', oid: 123, timestamp: 1700000000000, origSz: '0.01' },
      { coin: 'ETH', side: 'A', limitPx: '3200.0', sz: '0.5', oid: 456, timestamp: 1700000001000, origSz: '0.5' },
    ]);

    const { getOpenOrders } = await import('../src/core/hyperliquid/account.js');
    const orders = await getOpenOrders('0xaaaa');

    expect(orders).toHaveLength(2);
    expect(orders[0].side).toBe('buy');
    expect(orders[0].oid).toBe(123);
    expect(orders[1].side).toBe('sell');
    expect(orders[1].coin).toBe('ETH');
  });
});

describe('Hyperliquid account — getUserFills', () => {
  it('returns parsed fills', async () => {
    mockUserFills.mockResolvedValue([
      { coin: 'BTC', side: 'B', px: '95000.0', sz: '0.01', fee: '0.95', time: 1700000000000, oid: 789 },
    ]);

    const { getUserFills } = await import('../src/core/hyperliquid/account.js');
    const fills = await getUserFills('0xaaaa');

    expect(fills).toHaveLength(1);
    expect(fills[0].coin).toBe('BTC');
    expect(fills[0].px).toBe('95000.0');
  });
});
