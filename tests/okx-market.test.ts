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

vi.mock('../src/core/okx/client.js', () => ({
  getOkxCredentials: () => ({
    apiKey: 'test-key',
    secretKey: 'test-secret',
    passphrase: 'test-pass'
  }),
  okxRequest: vi.fn()
}));

// Mock market service
const mockGetTokenPrice = vi.fn();
const mockGetCandles = vi.fn();
const mockGetRecentTrades = vi.fn();
vi.mock('../src/core/okx/market.js', () => ({
  getTokenPrice: mockGetTokenPrice,
  getCandles: mockGetCandles,
  getRecentTrades: mockGetRecentTrades
}));

beforeEach(() => {
  memDb = new Database(':memory:');
  memDb.pragma('journal_mode = WAL');
  memDb.pragma('foreign_keys = ON');
  memDb.exec(SCHEMA_SQL);
  vi.clearAllMocks();
});

afterEach(() => {
  memDb.close();
});

describe('marketPriceCommand', () => {
  it('should return token price', async () => {
    mockGetTokenPrice.mockResolvedValue({
      price: '3500.42',
      time: '2024-01-01T00:00:00.000Z',
      volume24h: '1000000',
      change24h: '2.5',
    });

    const { marketPriceCommand } = await import('../src/commands/market.js');

    const result = await marketPriceCommand({
      chain: 'ethereum',
      token: 'ETH',
    });

    expect(result.chain).toBe('Ethereum');
    expect(result.token).toBe('ETH');
    expect(result.price.price).toBe('3500.42');
  });
});

describe('marketCandlesCommand', () => {
  it('should return candle data', async () => {
    mockGetCandles.mockResolvedValue([
      { time: '2024-01-01T00:00:00Z', open: '3400', high: '3600', low: '3350', close: '3500', volume: '10000' },
      { time: '2024-01-01T01:00:00Z', open: '3500', high: '3550', low: '3480', close: '3520', volume: '8000' },
    ]);

    const { marketCandlesCommand } = await import('../src/commands/market.js');

    const result = await marketCandlesCommand({
      chain: 'ethereum',
      token: 'ETH',
      interval: '1H',
      limit: '2',
    });

    expect(result.candles.length).toBe(2);
    expect(result.candles[0].open).toBe('3400');
  });
});

describe('marketTradesCommand', () => {
  it('should return recent trades', async () => {
    mockGetRecentTrades.mockResolvedValue([
      { txHash: '0xabc', time: '2024-01-01T00:00:00Z', side: 'buy', amount: '1.5', price: '3500' },
    ]);

    const { marketTradesCommand } = await import('../src/commands/market.js');

    const result = await marketTradesCommand({
      chain: 'ethereum',
      token: 'ETH',
      limit: '10',
    });

    expect(result.trades.length).toBe(1);
    expect(result.trades[0].side).toBe('buy');
  });
});
