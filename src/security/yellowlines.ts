import type { SecurityContext, SecurityVerdict, RecentTxCountLookup, KnownTokenLookup } from './types.js';

/** Default thresholds — configurable via settings. */
const DEFAULT_HIGH_SLIPPAGE_PCT = 3;
const DEFAULT_HIGH_LEVERAGE = 20;
const DEFAULT_RAPID_TX_WINDOW_MIN = 10;
const DEFAULT_RAPID_TX_COUNT = 5;
const DEFAULT_NIGHT_START = 0;  // 00:00
const DEFAULT_NIGHT_END = 6;    // 06:00
const DEFAULT_NIGHT_AMOUNT_THRESHOLD = 500;
const DEFAULT_LARGE_CROSS_CHAIN_THRESHOLD = 1000;
const DEFAULT_LARGE_PERP_THRESHOLD = 5000;

export function checkHighSlippage(ctx: SecurityContext, threshold = DEFAULT_HIGH_SLIPPAGE_PCT): SecurityVerdict | null {
  if (ctx.slippage !== undefined && ctx.slippage > threshold) {
    return {
      action: 'WARN_AND_LOG',
      rule: 'HIGH_SLIPPAGE',
      message: `High slippage: ${ctx.slippage}% exceeds ${threshold}% threshold.`
    };
  }
  return null;
}

export function checkUnknownToken(
  ctx: SecurityContext,
  isKnown: KnownTokenLookup
): SecurityVerdict | null {
  if (!ctx.token || !ctx.chain) return null;
  if (ctx.action !== 'swap.exec' && ctx.action !== 'bridge.exec') return null;
  if (!isKnown(ctx.token, ctx.chain)) {
    return {
      action: 'WARN_AND_LOG',
      rule: 'UNKNOWN_TOKEN',
      message: `Token ${ctx.token} is not in the known token list for ${ctx.chain}.`
    };
  }
  return null;
}

export function checkHighLeverage(ctx: SecurityContext, threshold = DEFAULT_HIGH_LEVERAGE): SecurityVerdict | null {
  if (ctx.action !== 'perp.open') return null;
  if (ctx.leverage !== undefined && ctx.leverage > threshold) {
    return {
      action: 'WARN_AND_LOG',
      rule: 'HIGH_LEVERAGE',
      message: `High leverage: ${ctx.leverage}x exceeds ${threshold}x threshold.`
    };
  }
  return null;
}

export function checkRapidTransactions(
  ctx: SecurityContext,
  getRecentCount: RecentTxCountLookup,
  windowMin = DEFAULT_RAPID_TX_WINDOW_MIN,
  maxCount = DEFAULT_RAPID_TX_COUNT
): SecurityVerdict | null {
  const count = getRecentCount(ctx.walletId, windowMin);
  if (count >= maxCount) {
    return {
      action: 'WARN_AND_LOG',
      rule: 'RAPID_TRANSACTIONS',
      message: `${count} transactions in the last ${windowMin} minutes (threshold: ${maxCount}).`
    };
  }
  return null;
}

export function checkNightTrading(
  ctx: SecurityContext,
  amountThreshold = DEFAULT_NIGHT_AMOUNT_THRESHOLD,
  nightStart = DEFAULT_NIGHT_START,
  nightEnd = DEFAULT_NIGHT_END
): SecurityVerdict | null {
  const hour = new Date().getHours();
  if (hour >= nightStart && hour < nightEnd && ctx.amount !== undefined && ctx.amount > amountThreshold) {
    return {
      action: 'LOG_ONLY',
      rule: 'NIGHT_TRADING',
      message: `Night trading (${hour}:00): $${ctx.amount} exceeds $${amountThreshold} threshold.`
    };
  }
  return null;
}

export function checkLargeCrossChain(
  ctx: SecurityContext,
  threshold = DEFAULT_LARGE_CROSS_CHAIN_THRESHOLD
): SecurityVerdict | null {
  if (ctx.action !== 'bridge.exec') return null;
  if (ctx.amount !== undefined && ctx.amount > threshold) {
    return {
      action: 'WARN_AND_LOG',
      rule: 'LARGE_CROSS_CHAIN',
      message: `Large cross-chain transfer: $${ctx.amount} exceeds $${threshold} threshold.`
    };
  }
  return null;
}

export function checkLargePerpPosition(
  ctx: SecurityContext,
  threshold = DEFAULT_LARGE_PERP_THRESHOLD
): SecurityVerdict | null {
  if (ctx.action !== 'perp.open') return null;
  if (ctx.amount !== undefined && ctx.amount > threshold) {
    return {
      action: 'WARN_AND_LOG',
      rule: 'LARGE_PERP_POSITION',
      message: `Large perp position: $${ctx.amount} notional exceeds $${threshold} threshold.`
    };
  }
  return null;
}
