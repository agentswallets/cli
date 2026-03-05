import { createInfoClient } from './client.js';
import { AppError } from '../errors.js';
import type { HlAccountSummary, HlOrder, HlPosition } from './types.js';

/**
 * Get account summary (margins, positions, PnL).
 */
export async function getAccountSummary(address: string): Promise<HlAccountSummary> {
  try {
    const info = createInfoClient();
    const state = await info.clearinghouseState({ user: address });
    const positions: HlPosition[] = state.assetPositions
      .filter((ap) => ap.position.szi !== '0' && ap.position.szi !== '0.0')
      .map((ap) => ({
        coin: ap.position.coin,
        szi: ap.position.szi,
        leverage: ap.position.leverage.value,
        entryPx: ap.position.entryPx,
        unrealizedPnl: ap.position.unrealizedPnl,
        liquidationPx: ap.position.liquidationPx,
        marginUsed: ap.position.marginUsed,
      }));
    return {
      accountValue: state.marginSummary.accountValue,
      totalMarginUsed: state.marginSummary.totalMarginUsed,
      withdrawable: state.withdrawable,
      positions,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('ERR_HL_API_FAILED', `Failed to fetch account summary: ${(err as Error).message}`);
  }
}

/**
 * Get open orders for a user.
 */
export async function getOpenOrders(address: string): Promise<HlOrder[]> {
  try {
    const info = createInfoClient();
    const orders = await info.openOrders({ user: address });
    return orders.map((o) => ({
      oid: o.oid,
      coin: o.coin,
      side: o.side === 'B' ? 'buy' as const : 'sell' as const,
      sz: o.sz,
      limitPx: o.limitPx,
      orderType: 'limit',
      timestamp: o.timestamp,
    }));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('ERR_HL_API_FAILED', `Failed to fetch open orders: ${(err as Error).message}`);
  }
}

/**
 * Get recent fills for a user.
 */
export async function getUserFills(address: string): Promise<Array<{
  coin: string;
  side: string;
  px: string;
  sz: string;
  fee: string;
  time: number;
  oid: number;
}>> {
  try {
    const info = createInfoClient();
    const fills = await info.userFills({ user: address });
    return fills.map((f: Record<string, unknown>) => ({
      coin: f.coin as string,
      side: f.side as string,
      px: f.px as string,
      sz: f.sz as string,
      fee: f.fee as string,
      time: f.time as number,
      oid: f.oid as number,
    }));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('ERR_HL_API_FAILED', `Failed to fetch user fills: ${(err as Error).message}`);
  }
}
