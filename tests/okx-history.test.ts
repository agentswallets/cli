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
  resolveWallet: (identifier: string) => ({
    id: 'wallet-1',
    name: identifier,
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    encrypted_private_key: '{}',
    key_type: 'legacy' as const,
    encrypted_mnemonic: null,
    encrypted_solana_key: null,
    solana_address: null,
    created_at: new Date().toISOString()
  })
}));

vi.mock('../src/core/okx/client.js', () => ({
  getOkxCredentials: () => ({
    apiKey: 'test-key',
    secretKey: 'test-secret',
    passphrase: 'test-pass'
  }),
  okxRequest: vi.fn()
}));

const mockGetOkxHistory = vi.fn();
vi.mock('../src/core/okx/history.js', () => ({
  getOkxHistory: mockGetOkxHistory
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

describe('historyListCommand', () => {
  it('should return transaction history', async () => {
    mockGetOkxHistory.mockResolvedValue([
      {
        txHash: '0xabc123',
        time: '1700000000',
        from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        tokenContractAddress: '0xeee',
        tokenSymbol: 'ETH',
        amount: '500000000000000000',
        status: 'success',
        chainId: '1',
      },
      {
        txHash: '0xdef456',
        time: '1700001000',
        from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        to: '0xcccccccccccccccccccccccccccccccccccccccc',
        tokenContractAddress: '0xa0b',
        tokenSymbol: 'USDC',
        amount: '100000000',
        status: 'success',
        chainId: '1',
      },
    ]);

    const { historyListCommand } = await import('../src/commands/history.js');

    const result = await historyListCommand({
      wallet: 'alice',
      chain: 'ethereum',
      limit: '10',
    });

    expect(result.wallet).toBe('alice');
    expect(result.chain).toBe('Ethereum');
    expect(result.transactions.length).toBe(2);
    expect(result.transactions[0].txHash).toBe('0xabc123');
    expect(result.transactions[1].tokenSymbol).toBe('USDC');
  });

  it('should return empty list when no history', async () => {
    mockGetOkxHistory.mockResolvedValue([]);

    const { historyListCommand } = await import('../src/commands/history.js');

    const result = await historyListCommand({
      wallet: 'bob',
      chain: 'polygon',
    });

    expect(result.transactions).toEqual([]);
    expect(result.chain).toBe('Polygon');
  });

  it('should use default limit', async () => {
    mockGetOkxHistory.mockResolvedValue([]);

    const { historyListCommand } = await import('../src/commands/history.js');

    await historyListCommand({ wallet: 'alice', chain: 'ethereum' });

    expect(mockGetOkxHistory).toHaveBeenCalledWith(
      expect.objectContaining({ limit: '50' })
    );
  });
});
