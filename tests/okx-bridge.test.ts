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

vi.mock('../src/core/okx/client.js', () => ({
  getOkxCredentials: () => ({
    apiKey: 'test-key',
    secretKey: 'test-secret',
    passphrase: 'test-pass'
  }),
  okxRequest: vi.fn()
}));

// Mock bridge
const mockGetBridgeTx = vi.fn();
const mockGetSupportedBridgeChains = vi.fn();
const mockGetBridgeQuote = vi.fn();
const mockGetBridgeStatus = vi.fn();
vi.mock('../src/core/okx/bridge.js', () => ({
  getBridgeTx: mockGetBridgeTx,
  getSupportedBridgeChains: mockGetSupportedBridgeChains,
  getBridgeQuote: mockGetBridgeQuote,
  getBridgeStatus: mockGetBridgeStatus
}));

// Mock swap-executor
const mockExecuteBridge = vi.fn();
vi.mock('../src/core/okx/swap-executor.js', () => ({
  signAndBroadcastTx: vi.fn(),
  executeSwap: vi.fn(),
  executeBridge: mockExecuteBridge
}));

vi.mock('ethers', () => ({
  Wallet: class { constructor() {} },
  parseUnits: (v: string, d: number) => BigInt(Math.floor(Number(v) * 10 ** d)),
  formatUnits: (v: bigint, d: number) => String(Number(v) / 10 ** d)
}));

vi.mock('../src/core/rpc.js', () => ({
  getProvider: () => ({}),
  verifyChainId: async () => {},
  mapRpcError: (err: unknown) => { throw err; }
}));

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

describe('bridgeExecCommand', () => {
  it('should execute bridge with full flow', async () => {
    mockGetBridgeTx.mockResolvedValue({
      routerResult: {
        fromToken: { tokenContractAddress: '0xeee', tokenSymbol: 'ETH', decimal: '18', chainId: '1' },
        toToken: { tokenContractAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', tokenSymbol: 'USDC', decimal: '6', chainId: '137' },
        fromTokenAmount: '100000000000000000',
        toTokenAmount: '99000000000000000',
        estimateGasFee: '0.005',
        tx: { from: '0xaaa', to: '0xbridge', value: '100000000000000000', data: '0xbridgedata', gasLimit: '500000' },
      },
    });

    mockExecuteBridge.mockResolvedValue({
      txHash: '0xbridgetxhash123',
      status: 'confirmed',
    });

    const { bridgeExecCommand } = await import('../src/commands/bridge.js');

    const result = await bridgeExecCommand(TEST_WALLET_ID, {
      fromChain: 'ethereum',
      toChain: 'polygon',
      fromToken: 'ETH',
      toToken: 'USDC',
      amount: '0.1',
      idempotencyKey: 'bridge-exec-1',
    });

    expect(result.tx_hash).toBe('0xbridgetxhash123');
    expect(result.from_chain).toBe('Ethereum');
    expect(result.to_chain).toBe('Polygon');
    expect(result.tx_id).toMatch(/^tx_/);
  });

  it('should reject bridge from Solana when wallet has no Solana key', async () => {
    const { bridgeExecCommand } = await import('../src/commands/bridge.js');
    const { AppError } = await import('../src/core/errors.js');

    await expect(
      bridgeExecCommand(TEST_WALLET_ID, {
        fromChain: 'solana',
        toChain: 'polygon',
        fromToken: 'SOL',
        toToken: 'USDC',
        amount: '1',
        idempotencyKey: 'bridge-solana-1',
      })
    ).rejects.toThrow('does not support Solana');
  });
});

describe('bridgeExecCommand — P0 replay safety', () => {
  it('rejects replay of a failed operation', async () => {
    mockGetBridgeTx.mockRejectedValueOnce(new Error('network error'));

    const { bridgeExecCommand } = await import('../src/commands/bridge.js');

    await expect(
      bridgeExecCommand(TEST_WALLET_ID, {
        fromChain: 'ethereum',
        toChain: 'polygon',
        fromToken: 'ETH',
        toToken: 'USDC',
        amount: '0.1',
        idempotencyKey: 'bridge-fail-replay-1',
      })
    ).rejects.toThrow();

    // The operation should now be marked 'failed'
    const op = memDb.prepare('SELECT status FROM operations WHERE idempotency_key=?').get('bridge-fail-replay-1') as { status: string };
    expect(op.status).toBe('failed');

    // Retry with same key: must reject, not return ok:true
    try {
      await bridgeExecCommand(TEST_WALLET_ID, {
        fromChain: 'ethereum',
        toChain: 'polygon',
        fromToken: 'ETH',
        toToken: 'USDC',
        amount: '0.1',
        idempotencyKey: 'bridge-fail-replay-1',
      });
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('ERR_INVALID_PARAMS');
      expect(err.message).toContain('failed');
    }
  });
});

describe('bridgeQuoteCommand', () => {
  it('should return quote', async () => {
    mockGetBridgeQuote.mockResolvedValue({
      routerResult: {
        fromToken: { tokenContractAddress: '0xeee', tokenSymbol: 'ETH', decimal: '18', chainId: '1' },
        toToken: { tokenContractAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', tokenSymbol: 'USDC', decimal: '6', chainId: '137' },
        fromTokenAmount: '1000000000000000000',
        toTokenAmount: '990000000000000000',
        estimateGasFee: '0.005',
        tx: { from: '0xaaa', to: '0xbridge', value: '0', data: '0x', gasLimit: '500000' },
      },
    });

    const { bridgeQuoteCommand } = await import('../src/commands/bridge.js');

    const result = await bridgeQuoteCommand({
      fromChain: 'ethereum',
      toChain: 'polygon',
      fromToken: 'ETH',
      toToken: 'USDC',
      amount: '1',
      wallet: 'test',
    });

    expect(result.from_chain).toBe('Ethereum');
    expect(result.to_chain).toBe('Polygon');
    expect(result.from_token).toBe('ETH');
  });
});
