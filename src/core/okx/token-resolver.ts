import type { ChainKey } from '../chains.js';
import { getChain } from '../chains.js';
import { AppError } from '../errors.js';
import { NATIVE_TOKEN_ADDRESS } from './constants.js';

/**
 * Map our ChainKey to OKX chainIndex (string).
 * OKX uses EVM chain IDs directly; Solana is special: '501'.
 */
export function chainKeyToOkxChainIndex(chainKey: ChainKey): string {
  if (chainKey === 'solana') return '501';
  return String(getChain(chainKey).chainId);
}

/**
 * Resolve a token symbol or contract address to an OKX-compatible token address.
 * - Native tokens (ETH, POL, BNB, SOL) → NATIVE_TOKEN_ADDRESS
 * - Known tokens (USDC, USDT) → their contract address from our registry
 * - 0x-prefixed addresses → passed through as-is (user knows the contract)
 */
export function resolveTokenAddress(chainKey: ChainKey, symbolOrAddress: string): {
  address: string;
  symbol: string;
  decimals: number;
} {
  // If it looks like a contract address, pass through
  if (symbolOrAddress.startsWith('0x') && symbolOrAddress.length === 42) {
    return { address: symbolOrAddress, symbol: symbolOrAddress, decimals: 18 };
  }

  const chain = getChain(chainKey);
  const upper = symbolOrAddress.toUpperCase();
  const normalized = upper === 'USDC.E' ? 'USDC.e' : upper;

  const token = chain.tokens.find(t => t.symbol === normalized || t.symbol.toUpperCase() === upper);

  if (token) {
    return {
      address: token.address ?? NATIVE_TOKEN_ADDRESS,
      symbol: token.symbol,
      decimals: token.decimals,
    };
  }

  // Solana token address (base58, not 0x-prefixed)
  if (chainKey === 'solana' && symbolOrAddress.length >= 32) {
    return { address: symbolOrAddress, symbol: symbolOrAddress, decimals: 9 };
  }

  // Unknown symbol — require contract address
  const available = chain.tokens.map(t => t.symbol).join(', ');
  throw new AppError('ERR_INVALID_PARAMS',
    `Token "${symbolOrAddress}" not found on ${chain.name}. Known: ${available}. Pass a contract address for other tokens.`
  );
}
