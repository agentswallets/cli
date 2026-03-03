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

vi.mock('../src/core/config.js', () => ({
  getHomeDir: () => '/tmp/aw-drain-test',
  getDbPath: () => ':memory:',
  getSessionPath: () => '/tmp/aw-drain-test/session.json',
  getSessionTokenPath: () => '/tmp/aw-drain-test/session-token'
}));

vi.mock('../src/core/session.js', () => ({
  isSessionValid: () => true,
  clearSession: () => {}
}));

const mockWalletBalance = vi.fn();
vi.mock('../src/core/tx-service.js', () => ({
  walletBalance: (...args: unknown[]) => mockWalletBalance(...args)
}));

vi.mock('../src/core/wallet-store.js', () => ({
  getWalletById: (id: string) => ({
    id,
    name: 'alice',
    address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    encrypted_private_key: 'enc',
    created_at: new Date().toISOString()
  }),
  resolveWallet: (identifier: string) => ({
    id: identifier,
    name: 'alice',
    address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    encrypted_private_key: 'enc',
    created_at: new Date().toISOString()
  }),
  getPolicy: () => ({
    daily_limit: 10000,
    per_tx_limit: 10000,
    max_tx_per_day: 100,
    allowed_tokens: ['POL', 'USDC', 'USDC.e'],
    allowed_addresses: [],
    require_approval_above: null
  })
}));

const mockTxSend = vi.fn();
vi.mock('./tx.js', () => ({
  txSendCommand: (...args: unknown[]) => mockTxSend(...args)
}));

// Also mock the relative import path that drain.ts uses
vi.mock('../src/commands/tx.js', () => ({
  txSendCommand: (...args: unknown[]) => mockTxSend(...args)
}));

describe('wallet drain command', () => {
  beforeEach(() => {
    memDb = new Database(':memory:');
    memDb.pragma('journal_mode = WAL');
    memDb.pragma('foreign_keys = ON');
    memDb.exec(SCHEMA_SQL);

    // Insert wallet for audit address lookup
    memDb.prepare(
      "INSERT INTO wallets(id,name,address,encrypted_private_key,created_at) VALUES(?,?,?,?,?)"
    ).run('w1', 'alice', '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'enc', new Date().toISOString());

    vi.clearAllMocks();
  });

  afterEach(() => {
    memDb.close();
  });

  it('drains all three tokens when all have balances', async () => {
    // First call: initial balance check
    mockWalletBalance.mockResolvedValueOnce({
      name: 'alice',
      address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      chain_id: 137,
      balances: { POL: '5.0', USDC: '100.0', 'USDC.e': '50.0' }
    });
    // Second call: re-check POL after ERC20 transfers
    mockWalletBalance.mockResolvedValueOnce({
      name: 'alice',
      address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      chain_id: 137,
      balances: { POL: '4.98', USDC: '0', 'USDC.e': '0' }
    });

    mockTxSend.mockResolvedValue({ tx_id: 'tx_1', tx_hash: '0xhash1', status: 'broadcasted', token: 'USDC', amount: '100', to: '0xDEST' });

    const { walletDrainCommand } = await import('../src/commands/drain.js');
    const result = await walletDrainCommand('w1', { to: '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD' });

    expect(result.results).toHaveLength(3);
    expect(result.results[0].token).toBe('USDC');
    expect(result.results[0].status).toBe('sent');
    expect(result.results[1].token).toBe('USDC.e');
    expect(result.results[1].status).toBe('sent');
    expect(result.results[2].token).toBe('POL');
    expect(result.results[2].status).toBe('sent');

    // txSendCommand called 3 times (USDC, USDC.e, POL)
    expect(mockTxSend).toHaveBeenCalledTimes(3);
  });

  it('only transfers POL when ERC20 balances are zero', async () => {
    mockWalletBalance.mockResolvedValueOnce({
      name: 'alice',
      address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      chain_id: 137,
      balances: { POL: '2.5', USDC: '0', 'USDC.e': '0' }
    });
    mockWalletBalance.mockResolvedValueOnce({
      name: 'alice',
      address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      chain_id: 137,
      balances: { POL: '2.5', USDC: '0', 'USDC.e': '0' }
    });

    mockTxSend.mockResolvedValue({ tx_id: 'tx_pol', tx_hash: '0xhash_pol', status: 'broadcasted', token: 'POL', amount: '2.49', to: '0xDEST' });

    const { walletDrainCommand } = await import('../src/commands/drain.js');
    const result = await walletDrainCommand('w1', { to: '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD' });

    expect(result.results[0]).toEqual({ token: 'USDC', amount: '0', status: 'zero' });
    expect(result.results[1]).toEqual({ token: 'USDC.e', amount: '0', status: 'zero' });
    expect(result.results[2].token).toBe('POL');
    expect(result.results[2].status).toBe('sent');

    // Only POL send
    expect(mockTxSend).toHaveBeenCalledTimes(1);
  });

  it('returns all zero when no balances', async () => {
    mockWalletBalance.mockResolvedValue({
      name: 'alice',
      address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      chain_id: 137,
      balances: { POL: '0', USDC: '0', 'USDC.e': '0' }
    });

    const { walletDrainCommand } = await import('../src/commands/drain.js');
    const result = await walletDrainCommand('w1', { to: '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD' });

    expect(result.results).toEqual([
      { token: 'USDC', amount: '0', status: 'zero' },
      { token: 'USDC.e', amount: '0', status: 'zero' },
      { token: 'POL', amount: '0', status: 'zero' }
    ]);
    expect(mockTxSend).not.toHaveBeenCalled();
  });

  it('marks POL as dust when balance is below gas estimate', async () => {
    mockWalletBalance.mockResolvedValue({
      name: 'alice',
      address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      chain_id: 137,
      balances: { POL: '0.005', USDC: '0', 'USDC.e': '0' }
    });

    const { walletDrainCommand } = await import('../src/commands/drain.js');
    const result = await walletDrainCommand('w1', { to: '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD' });

    expect(result.results[2].token).toBe('POL');
    expect(result.results[2].status).toBe('dust');
    expect(mockTxSend).not.toHaveBeenCalled();
  });

  it('ERC20 failure does not block POL transfer', async () => {
    mockWalletBalance.mockResolvedValueOnce({
      name: 'alice',
      address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      chain_id: 137,
      balances: { POL: '3.0', USDC: '50.0', 'USDC.e': '0' }
    });
    mockWalletBalance.mockResolvedValueOnce({
      name: 'alice',
      address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      chain_id: 137,
      balances: { POL: '3.0', USDC: '50.0', 'USDC.e': '0' }
    });

    // USDC send fails
    mockTxSend.mockRejectedValueOnce(new Error('RPC timeout'));
    // POL send succeeds
    mockTxSend.mockResolvedValueOnce({ tx_id: 'tx_pol', tx_hash: '0xhash_pol', status: 'broadcasted', token: 'POL', amount: '2.99', to: '0xDEST' });

    const { walletDrainCommand } = await import('../src/commands/drain.js');
    const result = await walletDrainCommand('w1', { to: '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD' });

    expect(result.results[0].token).toBe('USDC');
    expect(result.results[0].status).toBe('error');
    expect(result.results[0].error).toBe('RPC timeout');
    expect(result.results[1].token).toBe('USDC.e');
    expect(result.results[1].status).toBe('zero');
    expect(result.results[2].token).toBe('POL');
    expect(result.results[2].status).toBe('sent');
  });

  it('dry-run returns preview status without calling txSendCommand', async () => {
    mockWalletBalance.mockResolvedValueOnce({
      name: 'alice',
      address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      chain_id: 137,
      balances: { POL: '5.0', USDC: '100.0', 'USDC.e': '50.0' }
    });

    const { walletDrainCommand } = await import('../src/commands/drain.js');
    const result = await walletDrainCommand('w1', { to: '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD', dryRun: true });

    expect(result.dry_run).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(result.results[0]).toEqual({ token: 'USDC', amount: '100', status: 'preview' });
    expect(result.results[1]).toEqual({ token: 'USDC.e', amount: '50', status: 'preview' });
    expect(result.results[2].token).toBe('POL');
    expect(result.results[2].status).toBe('preview');
    // No actual transfers
    expect(mockTxSend).not.toHaveBeenCalled();
    // Only one balance call (no re-check)
    expect(mockWalletBalance).toHaveBeenCalledTimes(1);
  });

  it('dry-run classifies zero and dust ERC20 correctly', async () => {
    mockWalletBalance.mockResolvedValueOnce({
      name: 'alice',
      address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      chain_id: 137,
      balances: { POL: '1.0', USDC: '0', 'USDC.e': '0.005' }
    });

    const { walletDrainCommand } = await import('../src/commands/drain.js');
    const result = await walletDrainCommand('w1', { to: '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD', dryRun: true });

    expect(result.dry_run).toBe(true);
    expect(result.results[0]).toEqual({ token: 'USDC', amount: '0', status: 'zero' });
    expect(result.results[1]).toEqual({ token: 'USDC.e', amount: '0.005', status: 'dust' });
    expect(mockTxSend).not.toHaveBeenCalled();
  });

  it('dry-run estimates gas for POL based on ERC20 preview count', async () => {
    // 2 ERC20 tokens above dust → erc20PreviewCount = 2
    // gas estimate = 2 * 0.005 (ERC20) + 0.01 (native) = 0.02
    mockWalletBalance.mockResolvedValueOnce({
      name: 'alice',
      address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      chain_id: 137,
      balances: { POL: '1.0', USDC: '100.0', 'USDC.e': '50.0' }
    });

    const { walletDrainCommand } = await import('../src/commands/drain.js');
    const result = await walletDrainCommand('w1', { to: '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD', dryRun: true });

    const polResult = result.results.find(r => r.token === 'POL')!;
    expect(polResult.status).toBe('preview');
    // 1.0 - 0.02 = 0.98, floored to 18 decimals
    const polAmount = parseFloat(polResult.amount);
    expect(polAmount).toBeCloseTo(0.98, 4);
  });

  it('records wallet.drain audit log', async () => {
    mockWalletBalance.mockResolvedValue({
      name: 'alice',
      address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      chain_id: 137,
      balances: { POL: '0', USDC: '0', 'USDC.e': '0' }
    });

    const { walletDrainCommand } = await import('../src/commands/drain.js');
    await walletDrainCommand('w1', { to: '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD' });

    const row = memDb.prepare("SELECT action, wallet_id FROM audit_logs WHERE action='wallet.drain'").get() as any;
    expect(row).toBeTruthy();
    expect(row.wallet_id).toBe('w1');
    expect(row.action).toBe('wallet.drain');
  });
});
