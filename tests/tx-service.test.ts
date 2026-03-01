import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/core/schema.js';

// Mock db to use in-memory SQLite
let memDb: Database.Database;

vi.mock('../src/core/db.js', () => ({
  getDb: () => memDb,
  ensureDataDir: () => {},
  initDbSchema: () => memDb.exec(SCHEMA_SQL),
  assertInitialized: () => {},
  isInitialized: () => true
}));

// Mock wallet-store to return a test wallet
vi.mock('../src/core/wallet-store.js', () => ({
  getWalletById: (id: string) => ({
    id,
    name: 'test',
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    encrypted_private_key: '{}',
    created_at: new Date().toISOString()
  })
}));

// Mock crypto to return a dummy private key as Buffer
vi.mock('../src/core/crypto.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/core/crypto.js')>();
  return {
    ...original,
    decryptSecretAsBuffer: () => Buffer.from('0x' + 'ab'.repeat(32), 'utf8')
  };
});

// Mock ethers
const mockSendTransaction = vi.fn();
const mockTransfer = vi.fn();
const mockBalanceOf = vi.fn();
const mockWaitForTransaction = vi.fn();

vi.mock('ethers', () => {
  return {
    Wallet: class {
      constructor() {}
      sendTransaction = mockSendTransaction;
    },
    Contract: class {
      constructor() {}
      transfer = mockTransfer;
      balanceOf = mockBalanceOf.mockResolvedValue(BigInt(1000e6));
    },
    JsonRpcProvider: class {
      getBalance = vi.fn().mockResolvedValue(BigInt(100e18));
    },
    formatEther: (v: bigint) => String(Number(v) / 1e18),
    formatUnits: (v: bigint, d: number) => String(Number(v) / 10 ** d),
    parseEther: (v: string) => BigInt(Math.floor(Number(v) * 1e18)),
    parseUnits: (v: string, d: number) => BigInt(Math.floor(Number(v) * 10 ** d))
  };
});

vi.mock('../src/core/rpc.js', () => ({
  getProvider: () => ({
    getBalance: vi.fn().mockResolvedValue(BigInt(100e18)),
    waitForTransaction: mockWaitForTransaction
  }),
  verifyChainId: async () => {},
  erc20: () => ({}),
  mapRpcError: (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (/insufficient funds/i.test(msg)) throw new Error(msg);
    if (/timeout|network/i.test(msg)) throw new Error(msg);
    throw new Error(msg);
  }
}));

describe('tx-service', () => {
  beforeEach(() => {
    memDb = new Database(':memory:');
    memDb.pragma('journal_mode = WAL');
    memDb.pragma('foreign_keys = ON');
    memDb.exec(SCHEMA_SQL);
    // Insert a test wallet
    memDb
      .prepare(
        'INSERT INTO wallets(id,name,address,encrypted_private_key,created_at) VALUES(?,?,?,?,?)'
      )
      .run('w1', 'test', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '{}', new Date().toISOString());

    mockSendTransaction.mockReset();
    mockTransfer.mockReset();
    mockWaitForTransaction.mockReset();
    mockWaitForTransaction.mockResolvedValue({ status: 1 });
    mockBalanceOf.mockReset();
    mockBalanceOf.mockResolvedValue(BigInt(1000e6));
  });

  afterEach(() => {
    memDb.close();
  });

  describe('executeSend', () => {
    it('sends POL successfully', async () => {
      mockSendTransaction.mockResolvedValue({ hash: '0xhash123' });
      const { executeSend } = await import('../src/core/tx-service.js');
      const result = await executeSend({
        wallet_id: 'w1',
        to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        token: 'POL',
        amount: '1.0',
        idempotency_key: 'k1',
        password: 'test'
      });
      expect(result.tx_hash).toBe('0xhash123');
      expect(result.status).toBe('confirmed');
      expect(result.token).toBe('POL');
    });

    it('sends USDC successfully', async () => {
      mockTransfer.mockResolvedValue({ hash: '0xusdc456' });
      const { executeSend } = await import('../src/core/tx-service.js');
      const result = await executeSend({
        wallet_id: 'w1',
        to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        token: 'USDC',
        amount: '50',
        idempotency_key: 'k2',
        password: 'test'
      });
      expect(result.tx_hash).toBe('0xusdc456');
      expect(result.token).toBe('USDC');
    });

    it('throws ERR_INSUFFICIENT_FUNDS on insufficient funds (preflight)', async () => {
      mockSendTransaction.mockRejectedValue(new Error('insufficient funds for transfer'));
      const { executeSend } = await import('../src/core/tx-service.js');
      await expect(
        executeSend({
          wallet_id: 'w1',
          to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          token: 'POL',
          amount: '999',
          idempotency_key: 'k3',
          password: 'test'
        })
      ).rejects.toThrow(/Insufficient POL/i);
    });

    it('throws on nonce error', async () => {
      mockSendTransaction.mockRejectedValue(new Error('nonce too low'));
      const { executeSend } = await import('../src/core/tx-service.js');
      await expect(
        executeSend({
          wallet_id: 'w1',
          to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          token: 'POL',
          amount: '1',
          idempotency_key: 'k4',
          password: 'test'
        })
      ).rejects.toThrow(/nonce/i);
    });

    it('records operation in operations table', async () => {
      mockSendTransaction.mockResolvedValue({ hash: '0xrec1' });
      const { executeSend } = await import('../src/core/tx-service.js');
      await executeSend({
        wallet_id: 'w1',
        to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        token: 'POL',
        amount: '1',
        idempotency_key: 'k5',
        password: 'test'
      });
      const ops = memDb.prepare('SELECT * FROM operations WHERE idempotency_key=?').all('k5');
      expect(ops).toHaveLength(1);
    });

    it('updates status to confirmed on receipt success', async () => {
      mockSendTransaction.mockResolvedValue({ hash: '0xconf1' });
      mockWaitForTransaction.mockResolvedValue({ status: 1 });
      const { executeSend } = await import('../src/core/tx-service.js');
      const result = await executeSend({
        wallet_id: 'w1',
        to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        token: 'POL',
        amount: '1',
        idempotency_key: 'k6',
        password: 'test'
      });
      expect(result.status).toBe('confirmed');
      const op = memDb.prepare('SELECT status FROM operations WHERE idempotency_key=?').get('k6') as any;
      expect(op.status).toBe('confirmed');
    });

    it('updates status to failed on receipt revert', async () => {
      mockSendTransaction.mockResolvedValue({ hash: '0xfail1' });
      mockWaitForTransaction.mockResolvedValue({ status: 0 });
      const { executeSend } = await import('../src/core/tx-service.js');
      const result = await executeSend({
        wallet_id: 'w1',
        to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        token: 'POL',
        amount: '1',
        idempotency_key: 'k7',
        password: 'test'
      });
      expect(result.status).toBe('failed');
      const op = memDb.prepare('SELECT status FROM operations WHERE idempotency_key=?').get('k7') as any;
      expect(op.status).toBe('failed');
    });

    it('keeps broadcasted status on receipt timeout', async () => {
      mockSendTransaction.mockResolvedValue({ hash: '0xtimeout1' });
      mockWaitForTransaction.mockRejectedValue(new Error('timeout'));
      const { executeSend } = await import('../src/core/tx-service.js');
      const result = await executeSend({
        wallet_id: 'w1',
        to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        token: 'POL',
        amount: '1',
        idempotency_key: 'k8',
        password: 'test'
      });
      expect(result.status).toBe('broadcasted');
      const op = memDb.prepare('SELECT status FROM operations WHERE idempotency_key=?').get('k8') as any;
      expect(op.status).toBe('broadcasted');
    });
  });

  describe('txHistory strips wallet_id and parses meta', () => {
    it('operations in txHistory do not contain wallet_id or meta_json', async () => {
      const now = new Date().toISOString();
      memDb
        .prepare(
          'INSERT INTO operations(tx_id,wallet_id,kind,status,token,amount,to_address,tx_hash,provider_order_id,idempotency_key,meta_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )
        .run('tx_h1', 'w1', 'send', 'confirmed', 'POL', '1', '0xbb', '0xhash', null, 'ik_h1', '{"to":"0xbb"}', now, now);
      const { txHistory } = await import('../src/core/tx-service.js');
      const result = txHistory('w1', 10);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).not.toHaveProperty('wallet_id');
      expect(result.operations[0]).not.toHaveProperty('meta_json');
      expect(result.operations[0]).toHaveProperty('tx_id');
      expect(result.operations[0].meta).toEqual({ to: '0xbb' });
      expect(result.name).toBe('test');
    });
  });

  describe('txStatus strips wallet_id and parses meta', () => {
    it('txStatus does not contain wallet_id or meta_json', async () => {
      const now = new Date().toISOString();
      memDb
        .prepare(
          'INSERT INTO operations(tx_id,wallet_id,kind,status,token,amount,to_address,tx_hash,provider_order_id,idempotency_key,meta_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )
        .run('tx_s99', 'w1', 'send', 'confirmed', 'POL', '1', '0xbb', '0xhash', null, 'ik_s99', '{"to":"0xbb"}', now, now);
      const { txStatus } = await import('../src/core/tx-service.js');
      const result = txStatus('tx_s99');
      expect(result).not.toHaveProperty('wallet_id');
      expect(result).not.toHaveProperty('meta_json');
      expect(result.tx_id).toBe('tx_s99');
      expect(result.meta).toEqual({ to: '0xbb' });
    });
  });

  describe('createPendingProviderOperation with to_address', () => {
    it('stores to_address when provided', async () => {
      const { createPendingProviderOperation } = await import('../src/core/tx-service.js');
      const txId = createPendingProviderOperation({
        wallet_id: 'w1',
        kind: 'send',
        token: 'POL',
        amount: '1',
        to_address: '0xcccccccccccccccccccccccccccccccccccccccc',
        idempotency_key: 'ik_to1',
        meta: { to: '0xcccccccccccccccccccccccccccccccccccccccc' }
      });
      const row = memDb.prepare('SELECT to_address FROM operations WHERE tx_id=?').get(txId) as any;
      expect(row.to_address).toBe('0xcccccccccccccccccccccccccccccccccccccccc');
    });

    it('stores null when to_address omitted', async () => {
      const { createPendingProviderOperation } = await import('../src/core/tx-service.js');
      const txId = createPendingProviderOperation({
        wallet_id: 'w1',
        kind: 'predict_buy',
        token: 'USDC',
        amount: '5',
        idempotency_key: 'ik_to2'
      });
      const row = memDb.prepare('SELECT to_address FROM operations WHERE tx_id=?').get(txId) as any;
      expect(row.to_address).toBeNull();
    });
  });

  describe('dailySpendStats', () => {
    it('returns zero when no records exist', async () => {
      const { dailySpendStats } = await import('../src/core/tx-service.js');
      const stats = dailySpendStats('w1', 'USDC');
      expect(stats.todaySpent).toBe(0);
      expect(stats.todayTxCount).toBe(0);
    });

    it('sums today operations for the given token', async () => {
      const now = new Date().toISOString();
      memDb
        .prepare(
          'INSERT INTO operations(tx_id,wallet_id,kind,status,token,amount,to_address,tx_hash,provider_order_id,idempotency_key,meta_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )
        .run('tx_s1', 'w1', 'send', 'broadcasted', 'USDC', '10', '0xbb', '0xh', null, 'ik1', '{}', now, now);
      memDb
        .prepare(
          'INSERT INTO operations(tx_id,wallet_id,kind,status,token,amount,to_address,tx_hash,provider_order_id,idempotency_key,meta_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )
        .run('tx_b1', 'w1', 'predict_buy', 'submitted', 'USDC', '2', null, null, 'ord1', 'ik2', '{}', now, now);

      const { dailySpendStats } = await import('../src/core/tx-service.js');
      const stats = dailySpendStats('w1', 'USDC');
      expect(stats.todaySpent).toBe(12); // 10 + 2
      expect(stats.todayTxCount).toBe(2);
    });

    it('excludes records from yesterday (UTC boundary)', async () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString();
      memDb
        .prepare(
          'INSERT INTO operations(tx_id,wallet_id,kind,status,token,amount,to_address,tx_hash,provider_order_id,idempotency_key,meta_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )
        .run('tx_old', 'w1', 'send', 'broadcasted', 'USDC', '50', '0xbb', '0xh', null, 'ik3', '{}', yesterday, yesterday);

      const { dailySpendStats } = await import('../src/core/tx-service.js');
      const stats = dailySpendStats('w1', 'USDC');
      expect(stats.todaySpent).toBe(0);
      expect(stats.todayTxCount).toBe(0);
    });

    it('isolates spend per token but counts all tokens for txCount', async () => {
      const now = new Date().toISOString();
      const ins = memDb.prepare(
        'INSERT INTO operations(tx_id,wallet_id,kind,status,token,amount,to_address,tx_hash,provider_order_id,idempotency_key,meta_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
      );
      ins.run('tx_u1', 'w1', 'send', 'confirmed', 'USDC', '100', '0xbb', '0xh1', null, 'ik4', '{}', now, now);
      ins.run('tx_m1', 'w1', 'send', 'confirmed', 'POL', '50', '0xbb', '0xh2', null, 'ik5', '{}', now, now);
      ins.run('tx_u2', 'w1', 'send', 'broadcasted', 'USDC', '25', '0xcc', '0xh3', null, 'ik6', '{}', now, now);

      const { dailySpendStats } = await import('../src/core/tx-service.js');

      const usdcStats = dailySpendStats('w1', 'USDC');
      expect(usdcStats.todaySpent).toBe(125); // 100 + 25, excludes POL
      expect(usdcStats.todayTxCount).toBe(3); // all 3 txs across all tokens

      const polStats = dailySpendStats('w1', 'POL');
      expect(polStats.todaySpent).toBe(50); // only POL
      expect(polStats.todayTxCount).toBe(3); // still all 3 txs
    });
  });
});
