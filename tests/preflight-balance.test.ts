import { describe, expect, it, vi } from 'vitest';

// Mock wallet-store (legacy wallet)
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
  })
}));

// Dynamic balance mocks — updated per test
let mockPolBalanceWei = BigInt(1e18); // 1 POL
let mockUsdcBalance6 = BigInt(100e6); // 100 USDC
let mockUsdcBridgedBalance6 = BigInt(50e6); // 50 USDC.e
let mockUsdtBalance6 = BigInt(0); // 0 USDT

vi.mock('../src/core/rpc.js', () => ({
  getProvider: () => ({
    getBalance: async () => mockPolBalanceWei
  }),
  verifyChainId: async () => {},
  mapRpcError: (err: unknown) => { throw err; }
}));

vi.mock('ethers', () => {
  let callCount = 0;
  return {
    Contract: class {
      balanceOf = vi.fn().mockImplementation(() => {
        // Polygon tokens: USDC (0), USDC.e (1), USDT (2)
        const balances = [mockUsdcBalance6, mockUsdcBridgedBalance6, mockUsdtBalance6];
        const result = balances[callCount % 3];
        callCount++;
        return Promise.resolve(result);
      });
    },
    JsonRpcProvider: class {},
    formatEther: (v: bigint) => (Number(v) / 1e18).toString(),
    formatUnits: (v: bigint, d: number) => (Number(v) / 10 ** d).toString(),
    parseEther: (v: string) => BigInt(Math.floor(Number(v) * 1e18)),
    parseUnits: (v: string, d: number) => BigInt(Math.floor(Number(v) * 10 ** d))
  };
});

describe('preflightBalanceCheck', () => {
  it('passes when POL balance is sufficient', async () => {
    mockPolBalanceWei = BigInt(2e18); // 2 POL
    const { preflightBalanceCheck } = await import('../src/core/tx-service.js');
    await expect(preflightBalanceCheck('w1', 'POL', 1.0, 'polygon')).resolves.toBeUndefined();
  });

  it('throws when POL balance is insufficient', async () => {
    mockPolBalanceWei = BigInt(5e15); // 0.005 POL
    vi.resetModules();
    const { preflightBalanceCheck } = await import('../src/core/tx-service.js');
    await expect(preflightBalanceCheck('w1', 'POL', 1.0, 'polygon')).rejects.toThrow(/Insufficient POL/);
  });

  it('passes when USDC balance is sufficient and has gas', async () => {
    mockPolBalanceWei = BigInt(1e17); // 0.1 POL
    mockUsdcBalance6 = BigInt(50e6); // 50 USDC
    vi.resetModules();
    const { preflightBalanceCheck } = await import('../src/core/tx-service.js');
    await expect(preflightBalanceCheck('w1', 'USDC', 25, 'polygon')).resolves.toBeUndefined();
  });

  it('throws when USDC balance is insufficient', async () => {
    mockPolBalanceWei = BigInt(1e17); // 0.1 POL
    mockUsdcBalance6 = BigInt(5e6); // 5 USDC
    vi.resetModules();
    const { preflightBalanceCheck } = await import('../src/core/tx-service.js');
    await expect(preflightBalanceCheck('w1', 'USDC', 10, 'polygon')).rejects.toThrow(/Insufficient USDC/);
  });

  it('throws when USDC send lacks gas (POL too low)', async () => {
    mockPolBalanceWei = BigInt(1e15); // 0.001 POL
    mockUsdcBalance6 = BigInt(100e6); // 100 USDC
    vi.resetModules();
    const { preflightBalanceCheck } = await import('../src/core/tx-service.js');
    await expect(preflightBalanceCheck('w1', 'USDC', 10, 'polygon')).rejects.toThrow(/Insufficient POL for gas/);
  });

  it('accounts for gas in POL native transfer', async () => {
    // Exactly at threshold: 1.0 POL balance, sending 1.0 → needs ~1.01 with gas
    mockPolBalanceWei = BigInt(1e18); // 1.0 POL
    vi.resetModules();
    const { preflightBalanceCheck } = await import('../src/core/tx-service.js');
    await expect(preflightBalanceCheck('w1', 'POL', 1.0, 'polygon')).rejects.toThrow(/Insufficient POL/);
  });

  it('passes when USDC.e balance is sufficient', async () => {
    mockPolBalanceWei = BigInt(1e17); // 0.1 POL
    mockUsdcBridgedBalance6 = BigInt(100e6); // 100 USDC.e
    vi.resetModules();
    const { preflightBalanceCheck } = await import('../src/core/tx-service.js');
    await expect(preflightBalanceCheck('w1', 'USDC.e', 50, 'polygon')).resolves.toBeUndefined();
  });

  it('throws when USDC.e balance is insufficient', async () => {
    mockPolBalanceWei = BigInt(1e17); // 0.1 POL
    mockUsdcBridgedBalance6 = BigInt(5e6); // 5 USDC.e
    vi.resetModules();
    const { preflightBalanceCheck } = await import('../src/core/tx-service.js');
    await expect(preflightBalanceCheck('w1', 'USDC.e', 10, 'polygon')).rejects.toThrow(/Insufficient USDC\.e/);
  });
});
