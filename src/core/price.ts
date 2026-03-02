let cachedPrice: { usd: number; ts: number } | null = null;
const CACHE_TTL = 60_000; // 1 minute

/**
 * Fetch POL/USD price from CoinPaprika free API (no key required, 25k calls/month).
 * Returns null on any failure (network, rate-limit, etc.) — never throws.
 */
export async function fetchPolUsdPrice(): Promise<number | null> {
  if (cachedPrice && Date.now() - cachedPrice.ts < CACHE_TTL) {
    return cachedPrice.usd;
  }
  try {
    const res = await fetch(
      'https://api.coinpaprika.com/v1/tickers/pol-polygon-ecosystem-token',
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return cachedPrice?.usd ?? null;
    const data = await res.json() as { quotes?: { USD?: { price?: number } } };
    const usd = data?.quotes?.USD?.price;
    if (typeof usd === 'number') {
      cachedPrice = { usd, ts: Date.now() };
      return usd;
    }
    return cachedPrice?.usd ?? null;
  } catch {
    return cachedPrice?.usd ?? null;
  }
}
