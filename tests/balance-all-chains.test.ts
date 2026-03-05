import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChainKey } from '../src/core/chains.js';

// --- Mocks ---

vi.mock('../src/core/db.js', () => ({ assertInitialized: () => {} }));

const mockHdWallet = {
  id: 'w-hd',
  name: 'bot',
  address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  encrypted_private_key: '{}',
  key_type: 'hd' as const,
  encrypted_mnemonic: 'enc',
  encrypted_solana_key: 'enc',
  solana_address: 'SoLAddressAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  created_at: '2025-01-01T00:00:00Z',
};

const mockLegacyWallet = {
  id: 'w-legacy',
  name: 'old',
  address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  encrypted_private_key: '{}',
  key_type: 'legacy' as const,
  encrypted_mnemonic: null,
  encrypted_solana_key: null,
  solana_address: null,
  created_at: '2025-01-01T00:00:00Z',
};

let walletsInternal = [mockHdWallet, mockLegacyWallet];

vi.mock('../src/core/wallet-store.js', () => ({
  getWalletById: (id: string) => {
    const found = walletsInternal.find(w => w.id === id);
    if (!found) throw new Error(`Wallet ${id} not found`);
    return found;
  },
  listWalletsInternal: () => walletsInternal,
  listWallets: () => walletsInternal.map(w => ({
    name: w.name, address: w.address, key_type: w.key_type,
    solana_address: w.solana_address, created_at: w.created_at,
  })),
}));

// Track which chainKeys are queried for balance
const balanceCalls: ChainKey[] = [];
// Track which chainKeys are fetched for price
const priceFetchCalls: ChainKey[] = [];

// Chain key → should the RPC fail?
let failingChains = new Set<ChainKey>();

vi.mock('../src/core/tx-service.js', () => ({
  walletBalance: async (walletId: string, chainKey: ChainKey) => {
    balanceCalls.push(chainKey);
    if (failingChains.has(chainKey)) throw new Error(`RPC timeout for ${chainKey}`);

    // Return zero balances for all tokens on the chain
    const { getChain } = await import('../src/core/chains.js');
    const chain = getChain(chainKey);
    const wallet = walletsInternal.find(w => w.id === walletId)!;
    const address = chain.chainType === 'solana' ? wallet.solana_address! : wallet.address;
    const balances: Record<string, string> = {};
    for (const token of chain.tokens) {
      balances[token.symbol] = '0';
    }
    return { name: wallet.name, address, chain: chain.name, balances };
  },
}));

vi.mock('../src/core/price.js', () => ({
  fetchNativeTokenPrice: async (chainKey: ChainKey) => {
    priceFetchCalls.push(chainKey);
    const prices: Record<string, number> = {
      'ethereum': 2500,
      'polygon': 0.45,
      'bnb': 600,
      'solana': 180,
    };
    return prices[chainKey] ?? null;
  },
}));

// --- Tests ---

beforeEach(() => {
  balanceCalls.length = 0;
  priceFetchCalls.length = 0;
  failingChains = new Set();
  walletsInternal = [mockHdWallet, mockLegacyWallet];
});

describe('walletBalanceAllChainsCommand (single wallet × all chains)', () => {
  it('HD wallet queries all 6 chains', async () => {
    const { walletBalanceAllChainsCommand } = await import('../src/commands/wallet.js');
    const result = await walletBalanceAllChainsCommand('w-hd');

    expect(result.name).toBe('bot');
    expect(result.chains).toHaveLength(6);

    const chainNames = result.chains.map(c => c.chain);
    expect(chainNames).toContain('Ethereum');
    expect(chainNames).toContain('Base');
    expect(chainNames).toContain('BNB Chain');
    expect(chainNames).toContain('Polygon');
    expect(chainNames).toContain('Arbitrum');
    expect(chainNames).toContain('Solana');
  });

  it('legacy wallet skips Solana (5 chains)', async () => {
    const { walletBalanceAllChainsCommand } = await import('../src/commands/wallet.js');
    const result = await walletBalanceAllChainsCommand('w-legacy');

    expect(result.name).toBe('old');
    expect(result.chains).toHaveLength(5);
    const chainNames = result.chains.map(c => c.chain);
    expect(chainNames).not.toContain('Solana');
  });

  it('gracefully skips chains where RPC fails', async () => {
    failingChains = new Set(['arbitrum', 'solana'] as ChainKey[]);
    const { walletBalanceAllChainsCommand } = await import('../src/commands/wallet.js');
    const result = await walletBalanceAllChainsCommand('w-hd');

    // 6 total minus 2 failed = 4
    expect(result.chains).toHaveLength(4);
    const chainNames = result.chains.map(c => c.chain);
    expect(chainNames).not.toContain('Arbitrum');
    expect(chainNames).not.toContain('Solana');
  });

  it('deduplicates price fetches (ETH/Base/Arbitrum share nativeToken ETH)', async () => {
    const { walletBalanceAllChainsCommand } = await import('../src/commands/wallet.js');
    await walletBalanceAllChainsCommand('w-hd');

    // Should have only 4 unique native tokens: ETH, POL, BNB, SOL
    const uniqueKeys = new Set(priceFetchCalls);
    expect(uniqueKeys.size).toBe(4);

    // Total calls should be exactly 4 (not 6)
    expect(priceFetchCalls).toHaveLength(4);
  });

  it('includes native_usd_price and native_usd_value when price available', async () => {
    const { walletBalanceAllChainsCommand } = await import('../src/commands/wallet.js');
    const result = await walletBalanceAllChainsCommand('w-hd');

    const ethChain = result.chains.find(c => c.chain === 'Ethereum')!;
    expect(ethChain.native_usd_price).toBe(2500);
    expect(ethChain.native_usd_value).toBe(0);

    const polChain = result.chains.find(c => c.chain === 'Polygon')!;
    expect(polChain.native_usd_price).toBe(0.45);
  });

  it('Solana chain uses solana_address', async () => {
    const { walletBalanceAllChainsCommand } = await import('../src/commands/wallet.js');
    const result = await walletBalanceAllChainsCommand('w-hd');

    const solChain = result.chains.find(c => c.chain === 'Solana')!;
    expect(solChain.address).toBe(mockHdWallet.solana_address);
    const ethChain = result.chains.find(c => c.chain === 'Ethereum')!;
    expect(ethChain.address).toBe(mockHdWallet.address);
  });
});

describe('walletBalanceAllWalletsAllChainsCommand (--all without --chain)', () => {
  it('returns nested structure with all wallets', async () => {
    const { walletBalanceAllWalletsAllChainsCommand } = await import('../src/commands/wallet.js');
    const result = await walletBalanceAllWalletsAllChainsCommand();

    expect(result.wallets).toHaveLength(2);
    const hdResult = result.wallets.find(w => w.name === 'bot')!;
    const legacyResult = result.wallets.find(w => w.name === 'old')!;

    // HD wallet: 6 chains
    expect(hdResult.chains).toHaveLength(6);
    // Legacy wallet: 5 chains (no Solana)
    expect(legacyResult.chains).toHaveLength(5);
  });

  it('returns empty wallets array when no wallets exist', async () => {
    walletsInternal = [];
    const { walletBalanceAllWalletsAllChainsCommand } = await import('../src/commands/wallet.js');
    const result = await walletBalanceAllWalletsAllChainsCommand();
    expect(result.wallets).toEqual([]);
  });

  it('pre-fetches prices once for all wallets (4 unique native tokens)', async () => {
    const { walletBalanceAllWalletsAllChainsCommand } = await import('../src/commands/wallet.js');
    await walletBalanceAllWalletsAllChainsCommand();

    // Price fetches should be exactly 4 regardless of number of wallets
    expect(priceFetchCalls).toHaveLength(4);
  });
});

describe('walletBalanceCommand (single chain — backward compat)', () => {
  it('returns flat structure with chain field', async () => {
    const { walletBalanceCommand } = await import('../src/commands/wallet.js');
    const result = await walletBalanceCommand('w-hd', 'ethereum');

    expect(result.name).toBe('bot');
    expect(result.chain).toBe('Ethereum');
    expect(result.address).toBe(mockHdWallet.address);
    expect(result.balances).toHaveProperty('ETH');
    expect(result.balances_number).toHaveProperty('ETH');
    expect(result.native_usd_price).toBe(2500);
    // Should NOT have 'chains' array (flat format)
    expect(result).not.toHaveProperty('chains');
  });
});
