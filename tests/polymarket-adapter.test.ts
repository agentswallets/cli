import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the SDK dependencies at module level
const mockCreateOrDeriveApiKey = vi.fn(async () => ({ key: 'k', secret: 's', passphrase: 'p' }));
const mockGetMarket = vi.fn(async () => ({
  condition_id: '0xcond1',
  tokens: [
    { token_id: 'tok_yes', outcome: 'Yes', price: 0.65 },
    { token_id: 'tok_no', outcome: 'No', price: 0.35 },
  ],
}));
const mockGetTickSize = vi.fn(async () => '0.01' as const);
const mockGetNegRisk = vi.fn(async () => false);
const mockCreateAndPostOrder = vi.fn(async () => ({ success: true, orderID: 'ord_1', status: 'matched', transactionsHashes: [], errorMsg: '', takingAmount: '10', makingAmount: '6.5' }));
const mockCreateAndPostMarketOrder = vi.fn(async () => ({ success: true, orderID: 'ord_2', status: 'matched', transactionsHashes: [], errorMsg: '', takingAmount: '5', makingAmount: '3' }));
const mockCancelOrder = vi.fn(async () => ({ canceled: ['ord_1'] }));
const mockGetOpenOrders = vi.fn(async () => [{ id: 'ord_1', status: 'live', price: '0.65' }]);
const mockUpdateBalanceAllowance = vi.fn(async () => {});
const mockGetBalanceAllowance = vi.fn(async () => ({ balance: '100.0', allowance: '999999' }));

vi.mock('@polymarket/clob-client', () => {
  class MockClobClient {
    createOrDeriveApiKey = mockCreateOrDeriveApiKey;
    getMarket = mockGetMarket;
    getTickSize = mockGetTickSize;
    getNegRisk = mockGetNegRisk;
    createAndPostOrder = mockCreateAndPostOrder;
    createAndPostMarketOrder = mockCreateAndPostMarketOrder;
    cancelOrder = mockCancelOrder;
    getOpenOrders = mockGetOpenOrders;
    updateBalanceAllowance = mockUpdateBalanceAllowance;
    getBalanceAllowance = mockGetBalanceAllowance;
  }
  return {
    ClobClient: MockClobClient,
    Chain: { POLYGON: 137 },
    Side: { BUY: 'BUY', SELL: 'SELL' },
    OrderType: { GTC: 'GTC', FOK: 'FOK' },
    SignatureType: { EOA: 0 },
    AssetType: { COLLATERAL: 'COLLATERAL' },
  };
});

vi.mock('@polymarket/builder-signing-sdk', () => {
  class MockBuilderConfig {
    constructor() {}
  }
  return { BuilderConfig: MockBuilderConfig };
});

vi.mock('@ethersproject/wallet', () => {
  class MockWallet {
    address: string;
    constructor() {
      this.address = '0xaaaa000000000000000000000000000000000001';
    }
    async getAddress() {
      return this.address;
    }
  }
  return { Wallet: MockWallet };
});

vi.mock('../src/core/polymarket/embedded-keys.js', () => ({
  EMBEDDED_POLY_BUILDER_API_KEY: '',
  EMBEDDED_POLY_BUILDER_SECRET: '',
  EMBEDDED_POLY_BUILDER_PASSPHRASE: '',
}));

// Mock ethers v6 for on-chain operations (approveCheck, approveSet, etc.)
const mockAllowance = vi.fn(async () => 0n);
const mockIsApprovedForAll = vi.fn(async () => false);
const mockApprove = vi.fn(async () => ({ hash: '0xtx1', wait: vi.fn(async () => {}) }));
const mockSetApprovalForAll = vi.fn(async () => ({ hash: '0xtx2', wait: vi.fn(async () => {}) }));
vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class MockV6Wallet {
    address: string;
    provider: unknown;
    constructor() {
      this.address = '0xaaaa000000000000000000000000000000000001';
      this.provider = {};
    }
  }
  class MockContract {
    allowance: typeof mockAllowance;
    approve: typeof mockApprove;
    isApprovedForAll: typeof mockIsApprovedForAll;
    setApprovalForAll: typeof mockSetApprovalForAll;
    constructor(_addr: string, abi: string[]) {
      if (abi.some((a: string) => a.includes('allowance'))) {
        this.allowance = mockAllowance;
        this.approve = mockApprove;
        this.isApprovedForAll = vi.fn();
        this.setApprovalForAll = vi.fn();
      } else {
        this.allowance = vi.fn();
        this.approve = vi.fn();
        this.isApprovedForAll = mockIsApprovedForAll;
        this.setApprovalForAll = mockSetApprovalForAll;
      }
    }
  }
  return {
    ...actual,
    Wallet: MockV6Wallet,
    JsonRpcProvider: class { constructor() {} },
    Contract: MockContract,
  };
});

describe('SdkPolymarketAdapter', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('searchMarkets calls Gamma API and returns data', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'evt_1', title: 'Trump wins' }],
    } as Response);

    const { SdkPolymarketAdapter } = await import('../src/core/polymarket/sdk-adapter.js');
    const adapter = new SdkPolymarketAdapter();
    const result = await adapter.searchMarkets({ query: 'trump', limit: 5 });

    expect(Array.isArray(result.data)).toBe(true);
    expect((result.data as Array<{ id: string }>)[0].id).toBe('evt_1');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('gamma-api.polymarket.com/events'),
      expect.any(Object),
    );

    mockFetch.mockRestore();
  });

  it('buy resolves token ID and places order', async () => {
    const { SdkPolymarketAdapter } = await import('../src/core/polymarket/sdk-adapter.js');
    const adapter = new SdkPolymarketAdapter();

    const result = await adapter.buy({
      market: '0xcond1',
      outcome: 'yes',
      size: 10,
      price: 0.65,
      privateKey: '0x' + 'ab'.repeat(32),
    });

    expect(result.provider_order_id).toBe('ord_1');
    expect(result.provider_status).toBe('matched');
    expect(mockGetMarket).toHaveBeenCalledWith('0xcond1');
    expect(mockCreateAndPostOrder).toHaveBeenCalled();
  });

  it('buy throws ERR_MARKET_NOT_FOUND for invalid outcome', async () => {
    mockGetMarket.mockResolvedValueOnce({
      condition_id: '0xcond1',
      tokens: [{ token_id: 'tok_yes', outcome: 'Yes' }],
    });

    const { SdkPolymarketAdapter } = await import('../src/core/polymarket/sdk-adapter.js');
    const adapter = new SdkPolymarketAdapter();

    await expect(
      adapter.buy({
        market: '0xcond1',
        outcome: 'no',
        size: 10,
        price: 0.35,
        privateKey: '0x' + 'ab'.repeat(32),
      }),
    ).rejects.toMatchObject({ code: 'ERR_MARKET_NOT_FOUND' });
  });

  it('sell places market order with FOK', async () => {
    const { SdkPolymarketAdapter } = await import('../src/core/polymarket/sdk-adapter.js');
    const adapter = new SdkPolymarketAdapter();

    const result = await adapter.sell({
      positionId: 'tok_yes',
      size: 5,
      privateKey: '0x' + 'ab'.repeat(32),
    });

    expect(result.provider_order_id).toBe('ord_2');
    expect(mockCreateAndPostMarketOrder).toHaveBeenCalled();
  });

  it('cancelOrder sends correct order ID', async () => {
    const { SdkPolymarketAdapter } = await import('../src/core/polymarket/sdk-adapter.js');
    const adapter = new SdkPolymarketAdapter();

    await adapter.cancelOrder({
      orderId: 'ord_1',
      privateKey: '0x' + 'ab'.repeat(32),
    });

    expect(mockCancelOrder).toHaveBeenCalledWith({ orderID: 'ord_1' });
  });

  it('orders returns open orders', async () => {
    const { SdkPolymarketAdapter } = await import('../src/core/polymarket/sdk-adapter.js');
    const adapter = new SdkPolymarketAdapter();

    const result = await adapter.orders({
      privateKey: '0x' + 'ab'.repeat(32),
    });

    expect(Array.isArray(result.data)).toBe(true);
    expect(mockGetOpenOrders).toHaveBeenCalled();
  });

  it('positions calls Data API', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [{ conditionId: 'c1', size: '10' }],
    } as Response);

    const { SdkPolymarketAdapter } = await import('../src/core/polymarket/sdk-adapter.js');
    const adapter = new SdkPolymarketAdapter();
    const result = await adapter.positions({ walletAddress: '0x1234' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('data-api.polymarket.com/positions?user=0x1234'),
      expect.any(Object),
    );
    expect(result.data).toBeDefined();

    mockFetch.mockRestore();
  });

  it('approveCheck returns approval status', async () => {
    mockAllowance.mockResolvedValue(0n);
    mockIsApprovedForAll.mockResolvedValue(false);

    const { SdkPolymarketAdapter } = await import('../src/core/polymarket/sdk-adapter.js');
    const adapter = new SdkPolymarketAdapter();
    const result = await adapter.approveCheck({ privateKey: '0x' + 'ab'.repeat(32) });

    const data = result.data as { all_approved: boolean };
    expect(data.all_approved).toBe(false);
  });

  it('updateBalance calls SDK balance methods', async () => {
    const { SdkPolymarketAdapter } = await import('../src/core/polymarket/sdk-adapter.js');
    const adapter = new SdkPolymarketAdapter();
    const result = await adapter.updateBalance({ privateKey: '0x' + 'ab'.repeat(32) });

    const data = result.data as { balance: string };
    expect(data.balance).toBe('100.0');
    expect(mockUpdateBalanceAllowance).toHaveBeenCalled();
    expect(mockGetBalanceAllowance).toHaveBeenCalled();
  });

  it('wraps SDK auth errors into ERR_POLYMARKET_AUTH', async () => {
    mockCreateOrDeriveApiKey.mockRejectedValueOnce(new Error('unauthorized'));

    const { SdkPolymarketAdapter } = await import('../src/core/polymarket/sdk-adapter.js');
    const adapter = new SdkPolymarketAdapter();

    await expect(
      adapter.buy({
        market: '0xcond1',
        outcome: 'yes',
        size: 10,
        price: 0.65,
        privateKey: '0x' + 'cc'.repeat(32),
      }),
    ).rejects.toMatchObject({ code: 'ERR_POLYMARKET_AUTH' });
  });

  it('bridgeDeposit returns deposit info', async () => {
    const { SdkPolymarketAdapter } = await import('../src/core/polymarket/sdk-adapter.js');
    const adapter = new SdkPolymarketAdapter();
    const result = await adapter.bridgeDeposit({ walletAddress: '0x1234' });

    const data = result.data as { polygon_address: string };
    expect(data.polygon_address).toBe('0x1234');
  });
});
