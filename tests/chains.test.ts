import { describe, expect, it, vi } from 'vitest';
import { CHAINS, getChain, isEvmChain, isSolanaChain, resolveChainKey, resolveToken } from '../src/core/chains.js';
import type { ChainKey } from '../src/core/chains.js';

// Mock settings so local DB doesn't interfere with default chain tests
vi.mock('../src/core/settings.js', () => ({
  getSetting: () => undefined,
  setSetting: () => {}
}));

describe('chains registry', () => {
  it('has 6 chains', () => {
    expect(Object.keys(CHAINS)).toHaveLength(6);
  });

  it('each chain has required fields', () => {
    for (const [key, chain] of Object.entries(CHAINS)) {
      expect(chain.key).toBe(key);
      // Solana has chainId 0 (no EVM chain ID)
      if (chain.chainType === 'evm') {
        expect(chain.chainId).toBeGreaterThan(0);
      }
      expect(chain.name).toBeTruthy();
      expect(chain.nativeToken).toBeTruthy();
      expect(chain.defaultRpcUrls).toBeTruthy();
      expect(chain.rpcEnvVar).toMatch(/^AW_RPC_URL_/);
      expect(chain.tokens.length).toBeGreaterThan(0);
      expect(chain.gasEstimateNative).toBeGreaterThan(0);
      expect(chain.gasEstimateErc20).toBeGreaterThan(0);

      expect(chain.explorerTxUrl).toMatch(/^https:\/\//);
    }
  });

  it('each chain has a native token with address null', () => {
    for (const chain of Object.values(CHAINS)) {
      const native = chain.tokens.find(t => t.address === null);
      expect(native, `${chain.name} should have a native token`).toBeTruthy();
      // EVM chains use 18 decimals, Solana uses 9
      if (chain.chainType === 'evm') {
        expect(native!.decimals).toBe(18);
      } else {
        expect(native!.decimals).toBe(9);
      }
      expect(native!.symbol).toBe(chain.nativeToken);
    }
  });

  it('polygon has correct chain ID and tokens', () => {
    const polygon = CHAINS.polygon;
    expect(polygon.chainId).toBe(137);
    expect(polygon.nativeToken).toBe('POL');
    const symbols = polygon.tokens.map(t => t.symbol);
    expect(symbols).toContain('POL');
    expect(symbols).toContain('USDC');
    expect(symbols).toContain('USDC.e');
    expect(symbols).toContain('USDT');
  });

  it('BNB Chain USDC and USDT have 18 decimals', () => {
    const bnb = CHAINS.bnb;
    const usdc = bnb.tokens.find(t => t.symbol === 'USDC')!;
    const usdt = bnb.tokens.find(t => t.symbol === 'USDT')!;
    expect(usdc.decimals).toBe(18);
    expect(usdt.decimals).toBe(18);
  });

  it('Base has no USDT', () => {
    const base = CHAINS.base;
    const usdt = base.tokens.find(t => t.symbol === 'USDT');
    expect(usdt).toBeUndefined();
  });

  it('USDC.e is only on Polygon', () => {
    for (const [key, chain] of Object.entries(CHAINS)) {
      const usdce = chain.tokens.find(t => t.symbol === 'USDC.e');
      if (key === 'polygon') {
        expect(usdce).toBeTruthy();
      } else {
        expect(usdce, `${chain.name} should not have USDC.e`).toBeUndefined();
      }
    }
  });
});

describe('getChain', () => {
  it('returns correct chain config', () => {
    expect(getChain('polygon').chainId).toBe(137);
    expect(getChain('ethereum').chainId).toBe(1);
    expect(getChain('base').chainId).toBe(8453);
    expect(getChain('bnb').chainId).toBe(56);
    expect(getChain('arbitrum').chainId).toBe(42161);
  });
});

describe('resolveChainKey', () => {
  it('resolves canonical names', () => {
    expect(resolveChainKey('polygon')).toBe('polygon');
    expect(resolveChainKey('ethereum')).toBe('ethereum');
    expect(resolveChainKey('base')).toBe('base');
    expect(resolveChainKey('bnb')).toBe('bnb');
    expect(resolveChainKey('arbitrum')).toBe('arbitrum');
  });

  it('resolves aliases', () => {
    expect(resolveChainKey('eth')).toBe('ethereum');
    expect(resolveChainKey('matic')).toBe('polygon');
    expect(resolveChainKey('pol')).toBe('polygon');
    expect(resolveChainKey('bsc')).toBe('bnb');
    expect(resolveChainKey('binance')).toBe('bnb');
    expect(resolveChainKey('arb')).toBe('arbitrum');
  });

  it('resolves chain ID strings', () => {
    expect(resolveChainKey('137')).toBe('polygon');
    expect(resolveChainKey('1')).toBe('ethereum');
    expect(resolveChainKey('8453')).toBe('base');
    expect(resolveChainKey('56')).toBe('bnb');
    expect(resolveChainKey('42161')).toBe('arbitrum');
  });

  it('is case insensitive', () => {
    expect(resolveChainKey('POLYGON')).toBe('polygon');
    expect(resolveChainKey('Ethereum')).toBe('ethereum');
    expect(resolveChainKey('BSC')).toBe('bnb');
  });

  it('resolves solana', () => {
    expect(resolveChainKey('solana')).toBe('solana');
    expect(resolveChainKey('sol')).toBe('solana');
  });

  it('throws on unknown chain', () => {
    expect(() => resolveChainKey('avalanche')).toThrow(/Unknown chain/);
    expect(() => resolveChainKey('99999')).toThrow(/Unknown chain/);
  });

  it('returns default chain when input is undefined', () => {
    // Default is ethereum (no DB setting in test env)
    const result = resolveChainKey(undefined);
    expect(result).toBe('ethereum');
  });
});

describe('resolveToken', () => {
  it('resolves native token', () => {
    const chain = getChain('polygon');
    const token = resolveToken(chain, 'POL');
    expect(token.symbol).toBe('POL');
    expect(token.address).toBeNull();
    expect(token.decimals).toBe(18);
  });

  it('resolves ERC20 token', () => {
    const chain = getChain('polygon');
    const token = resolveToken(chain, 'USDC');
    expect(token.symbol).toBe('USDC');
    expect(token.address).toBeTruthy();
    expect(token.decimals).toBe(6);
  });

  it('normalizes USDC.E to USDC.e', () => {
    const chain = getChain('polygon');
    const token = resolveToken(chain, 'USDC.E');
    expect(token.symbol).toBe('USDC.e');
  });

  it('is case insensitive', () => {
    const chain = getChain('ethereum');
    const token = resolveToken(chain, 'eth');
    expect(token.symbol).toBe('ETH');
    expect(token.address).toBeNull();
  });

  it('throws on unknown token', () => {
    const chain = getChain('base');
    expect(() => resolveToken(chain, 'USDT')).toThrow(/not available on Base/);
  });

  it('BNB token decimals are correct', () => {
    const chain = getChain('bnb');
    const usdc = resolveToken(chain, 'USDC');
    expect(usdc.decimals).toBe(18);
    const usdt = resolveToken(chain, 'USDT');
    expect(usdt.decimals).toBe(18);
  });

  it('Solana token config is correct', () => {
    const chain = getChain('solana');
    const sol = resolveToken(chain, 'SOL');
    expect(sol.symbol).toBe('SOL');
    expect(sol.address).toBeNull();
    expect(sol.decimals).toBe(9);
    const usdc = resolveToken(chain, 'USDC');
    expect(usdc.decimals).toBe(6);
    expect(usdc.address).toBeTruthy();
    const usdt = resolveToken(chain, 'USDT');
    expect(usdt.decimals).toBe(6);
  });
});

describe('chain type helpers', () => {
  it('isEvmChain returns true for EVM chains', () => {
    expect(isEvmChain('polygon')).toBe(true);
    expect(isEvmChain('ethereum')).toBe(true);
    expect(isEvmChain('base')).toBe(true);
    expect(isEvmChain('bnb')).toBe(true);
    expect(isEvmChain('arbitrum')).toBe(true);
  });

  it('isEvmChain returns false for Solana', () => {
    expect(isEvmChain('solana')).toBe(false);
  });

  it('isSolanaChain returns true for Solana', () => {
    expect(isSolanaChain('solana')).toBe(true);
  });

  it('isSolanaChain returns false for EVM chains', () => {
    expect(isSolanaChain('polygon')).toBe(false);
    expect(isSolanaChain('ethereum')).toBe(false);
  });
});
