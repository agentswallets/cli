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

// Mock token service
const mockSearchTokens = vi.fn();
const mockGetTokenInfo = vi.fn();
const mockGetTrendingTokens = vi.fn();
const mockGetTokenHolders = vi.fn();
vi.mock('../src/core/okx/token.js', () => ({
  searchTokens: mockSearchTokens,
  getTokenInfo: mockGetTokenInfo,
  getTrendingTokens: mockGetTrendingTokens,
  getTokenHolders: mockGetTokenHolders
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

describe('tokenSearchCommand', () => {
  it('should return search results', async () => {
    mockSearchTokens.mockResolvedValue([
      { tokenContractAddress: '0xabc', tokenSymbol: 'USDC', tokenName: 'USD Coin', decimal: '6', chainId: '1' },
      { tokenContractAddress: '0xdef', tokenSymbol: 'USDT', tokenName: 'Tether USD', decimal: '6', chainId: '1' },
    ]);

    const { tokenSearchCommand } = await import('../src/commands/token-cmd.js');

    const result = await tokenSearchCommand({
      chain: 'ethereum',
      keyword: 'USD',
    });

    expect(result.chain).toBe('Ethereum');
    expect(result.results.length).toBe(2);
    expect(result.results[0].tokenSymbol).toBe('USDC');
  });
});

describe('tokenInfoCommand', () => {
  it('should return token details', async () => {
    mockGetTokenInfo.mockResolvedValue({
      tokenContractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      tokenSymbol: 'USDC',
      tokenName: 'USD Coin',
      decimal: '6',
      totalSupply: '30000000000000000',
      holders: '1500000',
      chainId: '1',
    });

    const { tokenInfoCommand } = await import('../src/commands/token-cmd.js');

    const result = await tokenInfoCommand({
      chain: 'ethereum',
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    });

    expect(result.token).toBeTruthy();
    expect(result.token!.tokenSymbol).toBe('USDC');
  });
});

describe('tokenTrendingCommand', () => {
  it('should return trending tokens', async () => {
    mockGetTrendingTokens.mockResolvedValue([
      { tokenContractAddress: '0xabc', tokenSymbol: 'PEPE', tokenName: 'Pepe', price: '0.000001', change24h: '50', volume24h: '10000000', chainId: '1' },
    ]);

    const { tokenTrendingCommand } = await import('../src/commands/token-cmd.js');

    const result = await tokenTrendingCommand({
      chain: 'ethereum',
    });

    expect(result.tokens.length).toBe(1);
    expect(result.tokens[0].tokenSymbol).toBe('PEPE');
  });
});

describe('tokenHoldersCommand', () => {
  it('should return top holders', async () => {
    mockGetTokenHolders.mockResolvedValue([
      { holderAddress: '0x1111111111111111111111111111111111111111', amount: '500000000000', percentage: '25.5' },
      { holderAddress: '0x2222222222222222222222222222222222222222', amount: '300000000000', percentage: '15.3' },
    ]);

    const { tokenHoldersCommand } = await import('../src/commands/token-cmd.js');

    const result = await tokenHoldersCommand({
      chain: 'ethereum',
      address: 'USDC',
    });

    expect(result.chain).toBe('Ethereum');
    expect(result.holders.length).toBe(2);
    expect(result.holders[0].percentage).toBe('25.5');
  });
});
