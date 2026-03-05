import { okxRequest } from './client.js';
import type { OkxCredentials, MarketPrice, MarketCandle, MarketTrade } from './types.js';

/**
 * Get real-time token price.
 */
export async function getTokenPrice(input: {
  chainId: string;
  tokenContractAddress: string;
  credentials: OkxCredentials;
}): Promise<MarketPrice> {
  const data = await okxRequest<MarketPrice[]>({
    method: 'GET',
    path: '/api/v5/dex/market/price',
    params: {
      chainId: input.chainId,
      tokenContractAddress: input.tokenContractAddress,
    },
    credentials: input.credentials,
  });

  return data?.[0] ?? { price: '0', time: new Date().toISOString() };
}

/**
 * Get candle (OHLCV) data.
 */
export async function getCandles(input: {
  chainId: string;
  tokenContractAddress: string;
  bar: string;
  limit?: string;
  after?: string;
  credentials: OkxCredentials;
}): Promise<MarketCandle[]> {
  const data = await okxRequest<MarketCandle[]>({
    method: 'GET',
    path: '/api/v5/dex/market/candles',
    params: {
      chainId: input.chainId,
      tokenContractAddress: input.tokenContractAddress,
      bar: input.bar,
      limit: input.limit,
      after: input.after,
    },
    credentials: input.credentials,
  });

  return data ?? [];
}

/**
 * Get recent trades for a token.
 */
export async function getRecentTrades(input: {
  chainId: string;
  tokenContractAddress: string;
  limit?: string;
  credentials: OkxCredentials;
}): Promise<MarketTrade[]> {
  const data = await okxRequest<MarketTrade[]>({
    method: 'GET',
    path: '/api/v5/dex/market/trades',
    params: {
      chainId: input.chainId,
      tokenContractAddress: input.tokenContractAddress,
      limit: input.limit,
    },
    credentials: input.credentials,
  });

  return data ?? [];
}
