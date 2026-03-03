const cache = new Map<string, { usd: number; ts: number }>();
const CACHE_TTL = 60_000; // 1 minute

/**
 * Fetch native token USD price from CoinPaprika free API (no key required, 25k calls/month).
 * Returns null on any failure (network, rate-limit, etc.) — never throws.
 */
export async function fetchNativeTokenPrice(coinpaprikaId: string): Promise<number | null> {
  const cached = cache.get(coinpaprikaId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.usd;
  }
  try {
    const res = await fetch(
      `https://api.coinpaprika.com/v1/tickers/${coinpaprikaId}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return cached?.usd ?? null;
    const data = await res.json() as { quotes?: { USD?: { price?: number } } };
    const usd = data?.quotes?.USD?.price;
    if (typeof usd === 'number') {
      cache.set(coinpaprikaId, { usd, ts: Date.now() });
      return usd;
    }
    return cached?.usd ?? null;
  } catch {
    return cached?.usd ?? null;
  }
}

/** Backward-compatible alias for POL/USD price. */
export async function fetchPolUsdPrice(): Promise<number | null> {
  return fetchNativeTokenPrice('pol-polygon-ecosystem-token');
}
