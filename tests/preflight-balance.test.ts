import { describe, expect, it, vi } from 'vitest';

// Mock wallet-store
vi.mock('../src/core/wallet-store.js', () => ({
  getWalletById: (id: string) => ({
    id,
    name: 'test',
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    encrypted_private_key: '{}',
    created_at: new Date().toISOString()
  })
}));

// Dynamic balance mocks — updated per test
let mockPolBalanceWei = BigInt(1e18); // 1 POL
let mockUsdcBalance6 = BigInt(100e6); // 100 USDC
let mockUsdcBridgedBalance6 = BigInt(50e6); // 50 USDC.e

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
        // First Contract instance = native USDC, second = bridged USDC
        const result = callCount % 2 === 0 ? mockUsdcBalance6 : mockUsdcBridgedBalance6;
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
    await expect(preflightBalanceCheck('w1', 'POL', 1.0)).resolves.toBeUndefined();
  });

  it('throws when POL balance is insufficient', async () => {
    mockPolBalanceWei = BigInt(5e15); // 0.005 POL
    vi.resetModules();
    const { preflightBalanceCheck } = await import('../src/core/tx-service.js');
    await expect(preflightBalanceCheck('w1', 'POL', 1.0)).rejects.toThrow(/Insufficient POL/);
  });

  it('passes when USDC balance is sufficient and has gas', async () => {
    mockPolBalanceWei = BigInt(1e17); // 0.1 POL
    mockUsdcBalance6 = BigInt(50e6); // 50 USDC
    vi.resetModules();
    const { preflightBalanceCheck } = await import('../src/core/tx-service.js');
    await expect(preflightBalanceCheck('w1', 'USDC', 25)).resolves.toBeUndefined();
  });

  it('throws when USDC balance is insufficient', async () => {
    mockPolBalanceWei = BigInt(1e17); // 0.1 POL
    mockUsdcBalance6 = BigInt(5e6); // 5 USDC
    vi.resetModules();
    const { preflightBalanceCheck } = await import('../src/core/tx-service.js');
    await expect(preflightBalanceCheck('w1', 'USDC', 10)).rejects.toThrow(/Insufficient USDC/);
  });

  it('throws when USDC send lacks gas (POL too low)', async () => {
    mockPolBalanceWei = BigInt(1e15); // 0.001 POL
    mockUsdcBalance6 = BigInt(100e6); // 100 USDC
    vi.resetModules();
    const { preflightBalanceCheck } = await import('../src/core/tx-service.js');
    await expect(preflightBalanceCheck('w1', 'USDC', 10)).rejects.toThrow(/Insufficient POL for gas/);
  });

  it('accounts for gas in POL native transfer', async () => {
    // Exactly at threshold: 1.0 POL balance, sending 1.0 → needs ~1.01 with gas
    mockPolBalanceWei = BigInt(1e18); // 1.0 POL
    vi.resetModules();
    const { preflightBalanceCheck } = await import('../src/core/tx-service.js');
    await expect(preflightBalanceCheck('w1', 'POL', 1.0)).rejects.toThrow(/Insufficient POL/);
  });

  it('passes when USDC.e balance is sufficient', async () => {
    mockPolBalanceWei = BigInt(1e17); // 0.1 POL
    mockUsdcBridgedBalance6 = BigInt(100e6); // 100 USDC.e
    vi.resetModules();
    const { preflightBalanceCheck } = await import('../src/core/tx-service.js');
    await expect(preflightBalanceCheck('w1', 'USDC.e', 50)).resolves.toBeUndefined();
  });

  it('throws when USDC.e balance is insufficient', async () => {
    mockPolBalanceWei = BigInt(1e17); // 0.1 POL
    mockUsdcBridgedBalance6 = BigInt(5e6); // 5 USDC.e
    vi.resetModules();
    const { preflightBalanceCheck } = await import('../src/core/tx-service.js');
    await expect(preflightBalanceCheck('w1', 'USDC.e', 10)).rejects.toThrow(/Insufficient USDC\.e/);
  });
});
