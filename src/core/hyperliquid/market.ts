import { createInfoClient } from './client.js';
import { AppError } from '../errors.js';
import type { HlAssetMeta, HlFundingRate } from './types.js';

/**
 * Get all tradable perpetual assets with metadata.
 */
export async function getPerps(): Promise<{ assets: HlAssetMeta[]; assetIndexMap: Record<string, number> }> {
  try {
    const info = createInfoClient();
    const meta = await info.meta();
    const assets: HlAssetMeta[] = [];
    const assetIndexMap: Record<string, number> = {};
    for (let i = 0; i < meta.universe.length; i++) {
      const u = meta.universe[i];
      if (u.isDelisted) continue;
      assets.push({ name: u.name, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage });
      assetIndexMap[u.name] = i;
    }
    return { assets, assetIndexMap };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('ERR_HL_API_FAILED', `Failed to fetch perp assets: ${(err as Error).message}`);
  }
}

/**
 * Get mid prices for all actively traded coins.
 */
export async function getPrices(): Promise<Record<string, string>> {
  try {
    const info = createInfoClient();
    return await info.allMids();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('ERR_HL_API_FAILED', `Failed to fetch prices: ${(err as Error).message}`);
  }
}

/**
 * Get funding rate history for a coin.
 */
export async function getFundingRates(coin: string): Promise<HlFundingRate[]> {
  try {
    const info = createInfoClient();
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const history = await info.fundingHistory({ coin, startTime: oneDayAgo });
    return history.map((r) => ({
      coin: r.coin,
      fundingRate: r.fundingRate,
      premium: r.premium,
      time: r.time,
    }));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('ERR_HL_API_FAILED', `Failed to fetch funding rates: ${(err as Error).message}`);
  }
}

/**
 * Get L2 order book for a coin.
 */
export async function getOrderBook(coin: string): Promise<{ levels: Array<{ px: string; sz: string; n: number }>[] }> {
  try {
    const info = createInfoClient();
    const book = await info.l2Book({ coin });
    const levels = book?.levels ?? [];
    return { levels: levels as unknown as Array<{ px: string; sz: string; n: number }>[] };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('ERR_HL_API_FAILED', `Failed to fetch order book: ${(err as Error).message}`);
  }
}

/**
 * Resolve a coin name to its asset index. Throws if not found.
 */
export async function resolveAssetIndex(coin: string): Promise<number> {
  const { assetIndexMap } = await getPerps();
  const upper = coin.toUpperCase();
  const idx = assetIndexMap[upper];
  if (idx === undefined) {
    throw new AppError('ERR_HL_INVALID_ASSET', `Unknown asset: ${coin}. Use \`aw perp assets\` to see available assets.`);
  }
  return idx;
}
