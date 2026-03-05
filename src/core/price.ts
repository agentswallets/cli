import type { ChainKey } from './chains.js';
import { getOkxCredentials } from './okx/client.js';
import { chainKeyToOkxChainIndex } from './okx/token-resolver.js';
import { getTokenPrice } from './okx/market.js';
import { NATIVE_TOKEN_ADDRESS } from './okx/constants.js';

const cache = new Map<string, { usd: number; ts: number }>();
const CACHE_TTL = 60_000; // 1 minute

/**
 * Fetch native token USD price via OKX API.
 * Returns null on any failure — never throws.
 */
export async function fetchNativeTokenPrice(chainKey: ChainKey): Promise<number | null> {
  const cached = cache.get(chainKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.usd;
  }
  try {
    const credentials = getOkxCredentials();
    const result = await getTokenPrice({
      chainId: chainKeyToOkxChainIndex(chainKey),
      tokenContractAddress: NATIVE_TOKEN_ADDRESS,
      credentials,
    });
    const usd = parseFloat(result.price);
    if (!isNaN(usd) && usd > 0) {
      cache.set(chainKey, { usd, ts: Date.now() });
      return usd;
    }
    return cached?.usd ?? null;
  } catch {
    return cached?.usd ?? null;
  }
}

/** Backward-compatible alias for POL/USD price. */
export async function fetchPolUsdPrice(): Promise<number | null> {
  return fetchNativeTokenPrice('polygon');
}
