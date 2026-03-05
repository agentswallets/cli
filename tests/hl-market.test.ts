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

// Mock the client factory to return a controllable InfoClient
const mockMeta = vi.fn();
const mockAllMids = vi.fn();
const mockFundingHistory = vi.fn();
const mockL2Book = vi.fn();

vi.mock('../src/core/hyperliquid/client.js', () => ({
  createInfoClient: () => ({
    meta: mockMeta,
    allMids: mockAllMids,
    fundingHistory: mockFundingHistory,
    l2Book: mockL2Book,
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

describe('Hyperliquid market — getPerps', () => {
  it('returns asset list with index map', async () => {
    mockMeta.mockResolvedValue({
      universe: [
        { name: 'BTC', szDecimals: 5, maxLeverage: 100, marginTableId: 0 },
        { name: 'ETH', szDecimals: 4, maxLeverage: 50, marginTableId: 1 },
        { name: 'DELIST', szDecimals: 2, maxLeverage: 10, marginTableId: 2, isDelisted: true },
      ],
      marginTables: [],
      collateralToken: 0,
    });

    const { getPerps } = await import('../src/core/hyperliquid/market.js');
    const result = await getPerps();

    expect(result.assets).toHaveLength(2);
    expect(result.assets[0]).toEqual({ name: 'BTC', szDecimals: 5, maxLeverage: 100 });
    expect(result.assets[1]).toEqual({ name: 'ETH', szDecimals: 4, maxLeverage: 50 });
    expect(result.assetIndexMap).toEqual({ BTC: 0, ETH: 1 });
  });

  it('wraps API errors with ERR_HL_API_FAILED', async () => {
    mockMeta.mockRejectedValue(new Error('network error'));

    const { getPerps } = await import('../src/core/hyperliquid/market.js');
    try {
      await getPerps();
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('ERR_HL_API_FAILED');
    }
  });
});

describe('Hyperliquid market — getPrices', () => {
  it('returns all mid prices', async () => {
    mockAllMids.mockResolvedValue({ BTC: '95000.5', ETH: '3200.1' });

    const { getPrices } = await import('../src/core/hyperliquid/market.js');
    const prices = await getPrices();

    expect(prices).toEqual({ BTC: '95000.5', ETH: '3200.1' });
  });
});

describe('Hyperliquid market — getFundingRates', () => {
  it('returns funding rate history for a coin', async () => {
    mockFundingHistory.mockResolvedValue([
      { coin: 'BTC', fundingRate: '0.0001', premium: '0.00005', time: 1700000000000 },
    ]);

    const { getFundingRates } = await import('../src/core/hyperliquid/market.js');
    const rates = await getFundingRates('BTC');

    expect(rates).toHaveLength(1);
    expect(rates[0].coin).toBe('BTC');
    expect(rates[0].fundingRate).toBe('0.0001');
  });
});

describe('Hyperliquid market — resolveAssetIndex', () => {
  it('resolves known asset to index', async () => {
    mockMeta.mockResolvedValue({
      universe: [
        { name: 'BTC', szDecimals: 5, maxLeverage: 100, marginTableId: 0 },
        { name: 'ETH', szDecimals: 4, maxLeverage: 50, marginTableId: 1 },
      ],
      marginTables: [],
      collateralToken: 0,
    });

    const { resolveAssetIndex } = await import('../src/core/hyperliquid/market.js');
    expect(await resolveAssetIndex('btc')).toBe(0);
    expect(await resolveAssetIndex('ETH')).toBe(1);
  });

  it('throws ERR_HL_INVALID_ASSET for unknown asset', async () => {
    mockMeta.mockResolvedValue({
      universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 100, marginTableId: 0 }],
      marginTables: [],
      collateralToken: 0,
    });

    const { resolveAssetIndex } = await import('../src/core/hyperliquid/market.js');
    try {
      await resolveAssetIndex('FAKE');
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('ERR_HL_INVALID_ASSET');
    }
  });
});
