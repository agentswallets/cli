import type { ExchangeClient } from '@nktkas/hyperliquid';
import { HL_BUILDER_ADDRESS, HL_BUILDER_FEE } from './constants.js';
import { AppError } from '../errors.js';

/** Slippage multiplier for market orders (0.5% each side). */
const SLIPPAGE_BPS = 0.005;

/** Parse an order status from the SDK response. */
function parseOrderStatus(status: unknown): { oid: number; avgPx?: string; totalSz?: string } {
  if (typeof status === 'string') {
    // "waitingForFill" | "waitingForTrigger"
    return { oid: 0 };
  }
  const s = status as Record<string, unknown>;
  if ('error' in s) {
    throw new AppError('ERR_HL_ORDER_FAILED', `Order failed: ${s.error}`);
  }
  if ('filled' in s) {
    const f = s.filled as { oid: number; avgPx: string; totalSz: string };
    return { oid: f.oid, avgPx: f.avgPx, totalSz: f.totalSz };
  }
  if ('resting' in s) {
    const r = s.resting as { oid: number };
    return { oid: r.oid };
  }
  return { oid: 0 };
}

/**
 * Open a perpetual position (market order via IOC + slippage protection).
 */
export async function openPosition(opts: {
  exchange: ExchangeClient;
  assetIndex: number;
  isBuy: boolean;
  size: string;
  price: string;
  leverage: number;
}): Promise<{ oid: number; avgPx?: string; totalSz?: string }> {
  // Set leverage first
  try {
    await opts.exchange.updateLeverage({
      asset: opts.assetIndex,
      isCross: true,
      leverage: opts.leverage,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('ERR_HL_ORDER_FAILED', `Failed to set leverage: ${(err as Error).message}`);
  }

  // Place the order
  try {
    const midPrice = parseFloat(opts.price);
    const slippagePrice = opts.isBuy
      ? (midPrice * (1 + SLIPPAGE_BPS)).toPrecision(8)
      : (midPrice * (1 - SLIPPAGE_BPS)).toPrecision(8);

    const result = await opts.exchange.order({
      orders: [{
        a: opts.assetIndex,
        b: opts.isBuy,
        p: slippagePrice,
        s: opts.size,
        r: false,
        t: { limit: { tif: 'Ioc' } },
      }],
      grouping: 'na',
      builder: {
        b: HL_BUILDER_ADDRESS as `0x${string}`,
        f: HL_BUILDER_FEE,
      },
    });

    return parseOrderStatus(result.response.data.statuses[0]);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('ERR_HL_ORDER_FAILED', `Failed to open position: ${(err as Error).message}`);
  }
}

/**
 * Close a perpetual position (reduce-only market order).
 */
export async function closePosition(opts: {
  exchange: ExchangeClient;
  assetIndex: number;
  isBuy: boolean;
  size: string;
  price: string;
}): Promise<{ oid: number; avgPx?: string; totalSz?: string }> {
  try {
    const midPrice = parseFloat(opts.price);
    const slippagePrice = opts.isBuy
      ? (midPrice * (1 + SLIPPAGE_BPS)).toPrecision(8)
      : (midPrice * (1 - SLIPPAGE_BPS)).toPrecision(8);

    const result = await opts.exchange.order({
      orders: [{
        a: opts.assetIndex,
        b: opts.isBuy,
        p: slippagePrice,
        s: opts.size,
        r: true, // reduce-only
        t: { limit: { tif: 'Ioc' } },
      }],
      grouping: 'na',
      builder: {
        b: HL_BUILDER_ADDRESS as `0x${string}`,
        f: HL_BUILDER_FEE,
      },
    });

    return parseOrderStatus(result.response.data.statuses[0]);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('ERR_HL_ORDER_FAILED', `Failed to close position: ${(err as Error).message}`);
  }
}

/**
 * Cancel an open order.
 */
export async function cancelOrder(opts: {
  exchange: ExchangeClient;
  assetIndex: number;
  oid: number;
}): Promise<void> {
  try {
    const result = await opts.exchange.cancel({
      cancels: [{ a: opts.assetIndex, o: opts.oid }],
    });
    const status = result.response.data.statuses[0];
    if (typeof status === 'object' && status !== null && 'error' in status) {
      throw new AppError('ERR_HL_ORDER_FAILED', `Cancel failed: ${(status as { error: string }).error}`);
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('ERR_HL_ORDER_FAILED', `Failed to cancel order: ${(err as Error).message}`);
  }
}
