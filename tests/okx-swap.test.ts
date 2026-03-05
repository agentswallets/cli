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
    id: 'wallet-1',
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
    decryptSecretAsBuffer: () => Buffer.from('0x' + 'ab'.repeat(32), 'utf8')
  };
});

vi.mock('../src/core/audit-service.js', () => ({
  logAudit: vi.fn()
}));

vi.mock('../src/util/agent-input.js', () => ({
  getMasterPassword: async () => 'test-password',
  isNonInteractive: () => true
}));

// Mock OKX client
vi.mock('../src/core/okx/client.js', () => ({
  getOkxCredentials: () => ({
    apiKey: 'test-key',
    secretKey: 'test-secret',
    passphrase: 'test-pass'
  }),
  okxRequest: vi.fn()
}));

// Mock swap-executor
const mockExecuteSwap = vi.fn();
vi.mock('../src/core/okx/swap-executor.js', () => ({
  executeSwap: mockExecuteSwap,
  signAndBroadcastTx: vi.fn()
}));

// Mock swap service
const mockGetSwapQuote = vi.fn();
const mockGetSwapApproval = vi.fn();
const mockGetSupportedSwapChains = vi.fn();
vi.mock('../src/core/okx/swap.js', () => ({
  getSwapQuote: mockGetSwapQuote,
  getSwapApproval: mockGetSwapApproval,
  getSupportedSwapChains: mockGetSupportedSwapChains
}));

// Mock ethers
vi.mock('ethers', () => ({
  Wallet: class { constructor() {} },
  parseUnits: (v: string, d: number) => BigInt(Math.floor(Number(v) * 10 ** d)),
  formatUnits: (v: bigint, d: number) => String(Number(v) / 10 ** d)
}));

// Mock RPC
vi.mock('../src/core/rpc.js', () => ({
  getProvider: () => ({}),
  verifyChainId: async () => {},
  mapRpcError: (err: unknown) => { throw err; }
}));

// Mock EVM adapter
vi.mock('../src/core/evm-adapter.js', () => ({
  getEvmAdapter: () => ({
    waitForConfirmation: vi.fn().mockResolvedValue({ status: 'confirmed' })
  })
}));

const TEST_WALLET_ID = 'wallet-1';

beforeEach(() => {
  memDb = new Database(':memory:');
  memDb.pragma('journal_mode = WAL');
  memDb.pragma('foreign_keys = ON');
  memDb.exec(SCHEMA_SQL);
  memDb.prepare(
    'INSERT INTO wallets(id,name,address,encrypted_private_key,key_type,encrypted_mnemonic,encrypted_solana_key,solana_address,created_at) VALUES(?,?,?,?,?,?,?,?,?)'
  ).run(TEST_WALLET_ID, 'test', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '{}', 'legacy', null, null, null, new Date().toISOString());
  vi.clearAllMocks();
});

afterEach(() => {
  memDb.close();
});

describe('swapExecCommand', () => {
  it('should return dry_run result without executing', async () => {
    const { swapExecCommand } = await import('../src/commands/swap.js');

    const result = await swapExecCommand(TEST_WALLET_ID, {
      chain: 'ethereum',
      from: 'ETH',
      to: 'USDC',
      amount: '0.1',
      idempotencyKey: 'swap-dry-1',
      dryRun: true,
    });

    expect(result.status).toBe('dry_run');
    expect(result.dry_run).toBe(true);
    expect(result.from_token).toBe('ETH');
    expect(result.to_token).toBe('USDC');
    expect(mockGetSwapQuote).not.toHaveBeenCalled();
  });

  it('should execute swap with full flow', async () => {
    mockGetSwapQuote.mockResolvedValue({
      routerResult: {
        fromToken: { tokenContractAddress: '0xeee', tokenSymbol: 'ETH', decimal: '18' },
        toToken: { tokenContractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', tokenSymbol: 'USDC', decimal: '6' },
        fromTokenAmount: '100000000000000000',
        toTokenAmount: '350000000',
        estimateGasFee: '0.001',
        tx: { from: '0xaaa', to: '0xdex', value: '100000000000000000', data: '0xswapdata', gasLimit: '300000' },
      },
      needsApproval: false,
    });

    mockExecuteSwap.mockResolvedValue({
      txHash: '0xswaptxhash123',
      status: 'confirmed',
    });

    const { swapExecCommand } = await import('../src/commands/swap.js');

    const result = await swapExecCommand(TEST_WALLET_ID, {
      chain: 'ethereum',
      from: 'ETH',
      to: 'USDC',
      amount: '0.1',
      idempotencyKey: 'swap-exec-1',
    });

    expect(result.tx_hash).toBe('0xswaptxhash123');
    expect(result.status).toBe('confirmed');
    expect(result.from_token).toBe('ETH');
    expect(result.to_token).toBe('USDC');
    expect(result.explorer_url).toContain('etherscan.io/tx/0xswaptxhash123');
    expect(result.tx_id).toMatch(/^tx_/);
  });

  it('should reject swap on Solana when wallet has no Solana key', async () => {
    const { swapExecCommand } = await import('../src/commands/swap.js');

    await expect(
      swapExecCommand(TEST_WALLET_ID, {
        chain: 'solana',
        from: 'SOL',
        to: 'USDC',
        amount: '1',
        idempotencyKey: 'swap-solana-1',
      })
    ).rejects.toThrow('does not support Solana');
  });

  it('should replay idempotent swap', async () => {
    // First, set up the mock and execute
    mockGetSwapQuote.mockResolvedValue({
      routerResult: {
        fromToken: { tokenContractAddress: '0xeee', tokenSymbol: 'ETH', decimal: '18' },
        toToken: { tokenContractAddress: '0xa0b', tokenSymbol: 'USDC', decimal: '6' },
        fromTokenAmount: '100000000000000000',
        toTokenAmount: '350000000',
        estimateGasFee: '0.001',
        tx: { from: '0xaaa', to: '0xdex', value: '100000000000000000', data: '0x', gasLimit: '300000' },
      },
      needsApproval: false,
    });
    mockExecuteSwap.mockResolvedValue({ txHash: '0xfirst', status: 'confirmed' });

    const { swapExecCommand } = await import('../src/commands/swap.js');

    // First execution
    const first = await swapExecCommand(TEST_WALLET_ID, {
      chain: 'ethereum',
      from: 'ETH',
      to: 'USDC',
      amount: '0.1',
      idempotencyKey: 'swap-idem-1',
    });

    // Second execution with same key → replay
    const second = await swapExecCommand(TEST_WALLET_ID, {
      chain: 'ethereum',
      from: 'ETH',
      to: 'USDC',
      amount: '0.1',
      idempotencyKey: 'swap-idem-1',
    });

    expect(second.tx_id).toBe(first.tx_id);
    // Execute only called once
    expect(mockExecuteSwap).toHaveBeenCalledTimes(1);
  });
});

describe('swapExecCommand — P0 replay safety', () => {
  it('rejects replay of a failed operation', async () => {
    // First call: create pending, then simulate failure by making getSwapQuote throw
    mockGetSwapQuote.mockRejectedValueOnce(new Error('ERR_OKX_AUTH'));

    const { swapExecCommand } = await import('../src/commands/swap.js');

    await expect(
      swapExecCommand(TEST_WALLET_ID, {
        chain: 'ethereum',
        from: 'ETH',
        to: 'USDC',
        amount: '0.1',
        idempotencyKey: 'swap-fail-replay-1',
      })
    ).rejects.toThrow();

    // The operation should now be marked 'failed' in the DB
    const op = memDb.prepare('SELECT status FROM operations WHERE idempotency_key=?').get('swap-fail-replay-1') as { status: string };
    expect(op.status).toBe('failed');

    // Second call with same key: must NOT return ok:true
    try {
      await swapExecCommand(TEST_WALLET_ID, {
        chain: 'ethereum',
        from: 'ETH',
        to: 'USDC',
        amount: '0.1',
        idempotencyKey: 'swap-fail-replay-1',
      });
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('ERR_INVALID_PARAMS');
      expect(err.message).toContain('failed');
    }
  });

  it('rejects replay of a pending (stale) operation', async () => {
    // Directly insert a stale pending operation to simulate a crash
    const now = new Date();
    const staleTime = new Date(now.getTime() - 31 * 60_000).toISOString(); // 31 min ago

    memDb.prepare(
      'INSERT INTO idempotency_keys(key,scope,status,created_at) VALUES(?,?,?,?)'
    ).run('swap-stale-1', 'swap', 'reserved', staleTime);

    memDb.prepare(
      `INSERT INTO operations(tx_id,wallet_id,kind,status,token,amount,to_address,tx_hash,provider_order_id,idempotency_key,meta_json,chain_name,chain_id,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run('tx_stale1', TEST_WALLET_ID, 'swap', 'pending', 'ETH', '0.1', null, null, null, 'swap-stale-1', '{}', 'Ethereum', 1, staleTime, staleTime);

    const { swapExecCommand } = await import('../src/commands/swap.js');

    try {
      await swapExecCommand(TEST_WALLET_ID, {
        chain: 'ethereum',
        from: 'ETH',
        to: 'USDC',
        amount: '0.1',
        idempotencyKey: 'swap-stale-1',
      });
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('ERR_INVALID_PARAMS');
      expect(err.message).toContain('did not complete');
    }
  });
});

describe('swapQuoteCommand', () => {
  it('should return quote without executing', async () => {
    const mockOkxRequest = (await import('../src/core/okx/client.js')).okxRequest as ReturnType<typeof vi.fn>;
    mockOkxRequest.mockResolvedValue([{
      fromToken: { tokenContractAddress: '0xeee', tokenSymbol: 'ETH', decimal: '18' },
      toToken: { tokenContractAddress: '0xa0b', tokenSymbol: 'USDC', decimal: '6' },
      fromTokenAmount: '1000000000000000000',
      toTokenAmount: '3500000000',
      estimateGasFee: '0.003',
      tx: { from: '0xaaa', to: '0xdex', value: '0', data: '0x', gasLimit: '300000' },
    }]);

    // getSwapQuote is mocked, so we need to mock it properly for this test
    mockGetSwapQuote.mockImplementation(async () => ({
      routerResult: {
        fromToken: { tokenContractAddress: '0xeee', tokenSymbol: 'ETH', decimal: '18' },
        toToken: { tokenContractAddress: '0xa0b', tokenSymbol: 'USDC', decimal: '6' },
        fromTokenAmount: '1000000000000000000',
        toTokenAmount: '3500000000',
        estimateGasFee: '0.003',
        tx: { from: '0xaaa', to: '0xdex', value: '0', data: '0x', gasLimit: '300000' },
      },
      needsApproval: false,
    }));

    // swapQuoteCommand calls getSwapQuote internally but it's from swap.js which is mocked,
    // however the quote command imports directly from swap.js
    const { swapQuoteCommand } = await import('../src/commands/swap.js');

    const result = await swapQuoteCommand({
      chain: 'ethereum',
      from: 'ETH',
      to: 'USDC',
      amount: '1',
      wallet: 'test',
    });

    expect(result.chain).toBe('Ethereum');
    expect(result.from_token).toBe('ETH');
    expect(result.to_token).toBe('USDC');
  });
});
