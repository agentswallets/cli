import { assertInitialized } from '../core/db.js';
import { resolveChainKey, getChain } from '../core/chains.js';
import { getOkxCredentials } from '../core/okx/client.js';
import { chainKeyToOkxChainIndex, resolveTokenAddress } from '../core/okx/token-resolver.js';
import { getTokenPrice, getCandles, getRecentTrades } from '../core/okx/market.js';
import type { MarketPrice, MarketCandle, MarketTrade } from '../core/okx/types.js';

/**
 * aw market price — get real-time token price.
 */
export async function marketPriceCommand(opts: {
  chain?: string;
  token: string;
}): Promise<{ chain: string; token: string; price: MarketPrice }> {
  assertInitialized();

  const chainKey = resolveChainKey(opts.chain);
  const chain = getChain(chainKey);
  const token = resolveTokenAddress(chainKey, opts.token);
  const credentials = getOkxCredentials();

  const price = await getTokenPrice({
    chainId: chainKeyToOkxChainIndex(chainKey),
    tokenContractAddress: token.address,
    credentials,
  });

  return { chain: chain.name, token: token.symbol, price };
}

/**
 * aw market candles — get K-line (OHLCV) data.
 */
export async function marketCandlesCommand(opts: {
  chain?: string;
  token: string;
  interval: string;
  limit?: string;
}): Promise<{ chain: string; token: string; candles: MarketCandle[] }> {
  assertInitialized();

  const chainKey = resolveChainKey(opts.chain);
  const chain = getChain(chainKey);
  const token = resolveTokenAddress(chainKey, opts.token);
  const credentials = getOkxCredentials();

  const candles = await getCandles({
    chainId: chainKeyToOkxChainIndex(chainKey),
    tokenContractAddress: token.address,
    bar: opts.interval,
    limit: opts.limit,
    credentials,
  });

  return { chain: chain.name, token: token.symbol, candles };
}

/**
 * aw market trades — get recent trades.
 */
export async function marketTradesCommand(opts: {
  chain?: string;
  token: string;
  limit?: string;
}): Promise<{ chain: string; token: string; trades: MarketTrade[] }> {
  assertInitialized();

  const chainKey = resolveChainKey(opts.chain);
  const chain = getChain(chainKey);
  const token = resolveTokenAddress(chainKey, opts.token);
  const credentials = getOkxCredentials();

  const trades = await getRecentTrades({
    chainId: chainKeyToOkxChainIndex(chainKey),
    tokenContractAddress: token.address,
    limit: opts.limit,
    credentials,
  });

  return { chain: chain.name, token: token.symbol, trades };
}
