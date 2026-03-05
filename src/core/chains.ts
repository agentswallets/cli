import { AppError } from './errors.js';
import { getSetting } from './settings.js';

export type ChainKey = 'ethereum' | 'bnb' | 'base' | 'polygon' | 'arbitrum' | 'solana';

export type TokenInfo = {
  symbol: string;
  address: string | null; // null = native token
  decimals: number;
};

export type ChainType = 'evm' | 'solana';

export type ChainConfig = {
  key: ChainKey;
  chainType: ChainType;
  chainId: number;
  name: string;
  nativeToken: string;
  defaultRpcUrls: string;
  rpcEnvVar: string;
  tokens: TokenInfo[];
  gasEstimateNative: number;
  gasEstimateErc20: number;
  explorerTxUrl: string;
};

export const CHAINS: Record<ChainKey, ChainConfig> = {
  ethereum: {
    key: 'ethereum',
    chainType: 'evm',
    chainId: 1,
    name: 'Ethereum',
    nativeToken: 'ETH',
    defaultRpcUrls: 'https://eth.drpc.org,https://ethereum-rpc.publicnode.com,https://1rpc.io/eth',
    rpcEnvVar: 'AW_RPC_URL_ETHEREUM',
    tokens: [
      { symbol: 'ETH', address: null, decimals: 18 },
      { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
      { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    ],
    gasEstimateNative: 0.001,
    gasEstimateErc20: 0.0005,

    explorerTxUrl: 'https://etherscan.io/tx/',
  },
  bnb: {
    key: 'bnb',
    chainType: 'evm',
    chainId: 56,
    name: 'BNB Chain',
    nativeToken: 'BNB',
    defaultRpcUrls: 'https://bsc.drpc.org,https://bsc-rpc.publicnode.com,https://1rpc.io/bnb',
    rpcEnvVar: 'AW_RPC_URL_BNB',
    tokens: [
      { symbol: 'BNB', address: null, decimals: 18 },
      { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
      { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    ],
    gasEstimateNative: 0.0005,
    gasEstimateErc20: 0.0003,

    explorerTxUrl: 'https://bscscan.com/tx/',
  },
  base: {
    key: 'base',
    chainType: 'evm',
    chainId: 8453,
    name: 'Base',
    nativeToken: 'ETH',
    defaultRpcUrls: 'https://base.drpc.org,https://base-rpc.publicnode.com,https://1rpc.io/base',
    rpcEnvVar: 'AW_RPC_URL_BASE',
    tokens: [
      { symbol: 'ETH', address: null, decimals: 18 },
      { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    ],
    gasEstimateNative: 0.0001,
    gasEstimateErc20: 0.00005,

    explorerTxUrl: 'https://basescan.org/tx/',
  },
  polygon: {
    key: 'polygon',
    chainType: 'evm',
    chainId: 137,
    name: 'Polygon',
    nativeToken: 'POL',
    defaultRpcUrls: 'https://polygon.drpc.org,https://polygon-bor-rpc.publicnode.com,https://1rpc.io/matic',
    rpcEnvVar: 'AW_RPC_URL_POLYGON',
    tokens: [
      { symbol: 'POL', address: null, decimals: 18 },
      { symbol: 'USDC', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
      { symbol: 'USDC.e', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimals: 6 },
      { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    ],
    gasEstimateNative: 0.01,
    gasEstimateErc20: 0.005,

    explorerTxUrl: 'https://polygonscan.com/tx/',
  },
  arbitrum: {
    key: 'arbitrum',
    chainType: 'evm',
    chainId: 42161,
    name: 'Arbitrum',
    nativeToken: 'ETH',
    defaultRpcUrls: 'https://arbitrum.drpc.org,https://arbitrum-one-rpc.publicnode.com,https://1rpc.io/arb',
    rpcEnvVar: 'AW_RPC_URL_ARBITRUM',
    tokens: [
      { symbol: 'ETH', address: null, decimals: 18 },
      { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
      { symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    ],
    gasEstimateNative: 0.0001,
    gasEstimateErc20: 0.00005,

    explorerTxUrl: 'https://arbiscan.io/tx/',
  },
  solana: {
    key: 'solana',
    chainType: 'solana',
    chainId: 0,
    name: 'Solana',
    nativeToken: 'SOL',
    defaultRpcUrls: 'https://api.mainnet-beta.solana.com',
    rpcEnvVar: 'AW_RPC_URL_SOLANA',
    tokens: [
      { symbol: 'SOL', address: null, decimals: 9 },
      { symbol: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
      { symbol: 'USDT', address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
    ],
    gasEstimateNative: 0.000005,
    gasEstimateErc20: 0.002,

    explorerTxUrl: 'https://solscan.io/tx/',
  },
};

const CHAIN_ALIASES: Record<string, ChainKey> = {
  ethereum: 'ethereum', eth: 'ethereum', '1': 'ethereum',
  bnb: 'bnb', bsc: 'bnb', binance: 'bnb', '56': 'bnb',
  base: 'base', '8453': 'base',
  polygon: 'polygon', matic: 'polygon', pol: 'polygon', '137': 'polygon',
  arbitrum: 'arbitrum', arb: 'arbitrum', '42161': 'arbitrum',
  solana: 'solana', sol: 'solana',
};

export function getChain(key: ChainKey): ChainConfig {
  return CHAINS[key];
}

export function resolveChainKey(input?: string): ChainKey {
  if (!input) return getDefaultChainKey();
  const key = CHAIN_ALIASES[input.toLowerCase()];
  if (!key) {
    throw new AppError('ERR_INVALID_PARAMS', `Unknown chain: ${input}. Supported: ethereum, bnb, base, polygon, arbitrum, solana`);
  }
  return key;
}

export function resolveToken(chain: ChainConfig, symbol: string): TokenInfo {
  const upper = symbol.toUpperCase();
  // Normalize USDC.E → USDC.e
  const normalized = upper === 'USDC.E' ? 'USDC.e' : upper;
  const token = chain.tokens.find(t => t.symbol === normalized || t.symbol.toUpperCase() === upper);
  if (!token) {
    const available = chain.tokens.map(t => t.symbol).join(', ');
    throw new AppError('ERR_INVALID_PARAMS', `Token ${symbol} not available on ${chain.name}. Available: ${available}`);
  }
  return token;
}

export function isEvmChain(key: ChainKey): boolean {
  return CHAINS[key].chainType === 'evm';
}

export function isSolanaChain(key: ChainKey): boolean {
  return CHAINS[key].chainType === 'solana';
}

/** Summary of all supported chains for display (e.g. wallet create response). */
export function getSupportedChainsSummary(): Array<{
  name: string; native_token: string; tokens: string[];
}> {
  return Object.values(CHAINS).map(c => ({
    name: c.name,
    native_token: c.nativeToken,
    tokens: c.tokens.map(t => t.symbol),
  }));
}

export function getAllChainKeys(): ChainKey[] {
  return Object.keys(CHAINS) as ChainKey[];
}

export function getDefaultChainKey(): ChainKey {
  try {
    const saved = getSetting('default_chain');
    if (saved && saved in CHAINS) return saved as ChainKey;
  } catch {
    // DB not initialized yet — default to ethereum
  }
  return 'ethereum';
}
