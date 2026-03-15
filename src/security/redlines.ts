import type { SecurityContext, SecurityVerdict, AddressHistoryLookup, BalanceLookup } from './types.js';
import { isBlacklisted } from './blacklist.js';

/** Default large transfer threshold in USD. Configurable via settings. */
const DEFAULT_LARGE_TRANSFER_THRESHOLD = 1000;

/** Percentage of balance that triggers ALL_BALANCE_SWAP (90%). */
const ALL_BALANCE_SWAP_PCT = 0.9;

export function checkDrainAll(ctx: SecurityContext): SecurityVerdict | null {
  if (ctx.action === 'wallet.drain') {
    return { action: 'REQUIRE_CONFIRMATION', rule: 'DRAIN_ALL', message: 'Draining all tokens from wallet.' };
  }
  return null;
}

export function checkExportKey(ctx: SecurityContext): SecurityVerdict | null {
  if (ctx.action === 'wallet.export_key') {
    return { action: 'REQUIRE_CONFIRMATION', rule: 'EXPORT_KEY', message: 'Exporting wallet private key.' };
  }
  return null;
}

export function checkLargeTransfer(ctx: SecurityContext, threshold = DEFAULT_LARGE_TRANSFER_THRESHOLD): SecurityVerdict | null {
  if (ctx.amount !== undefined && ctx.amount > threshold) {
    return {
      action: 'REQUIRE_CONFIRMATION',
      rule: 'LARGE_TRANSFER',
      message: `Large transfer: $${ctx.amount} exceeds threshold of $${threshold}.`
    };
  }
  return null;
}

export function checkNewAddress(
  ctx: SecurityContext,
  hasHistory: AddressHistoryLookup
): SecurityVerdict | null {
  if (!ctx.toAddress) return null;
  if (ctx.action !== 'tx.send' && ctx.action !== 'wallet.drain') return null;
  const known = hasHistory(ctx.walletId, ctx.toAddress);
  if (!known) {
    return {
      action: 'REQUIRE_CONFIRMATION',
      rule: 'NEW_ADDRESS',
      message: `First transaction to address ${ctx.toAddress.slice(0, 10)}...`
    };
  }
  return null;
}

export function checkAllBalanceSwap(
  ctx: SecurityContext,
  getBalance: BalanceLookup
): SecurityVerdict | null {
  if (ctx.action !== 'swap.exec' && ctx.action !== 'bridge.exec') return null;
  if (ctx.amount === undefined || !ctx.token || !ctx.chain) return null;
  const balance = getBalance(ctx.walletId, ctx.token, ctx.chain);
  if (balance > 0 && ctx.amount >= balance * ALL_BALANCE_SWAP_PCT) {
    return {
      action: 'REQUIRE_CONFIRMATION',
      rule: 'ALL_BALANCE_SWAP',
      message: `Swapping ${((ctx.amount / balance) * 100).toFixed(0)}% of ${ctx.token} balance.`
    };
  }
  return null;
}

export function checkPolicyChange(ctx: SecurityContext): SecurityVerdict | null {
  if (ctx.action === 'policy.set') {
    return { action: 'REQUIRE_CONFIRMATION', rule: 'POLICY_CHANGE', message: 'Modifying wallet security policy.' };
  }
  return null;
}

export function checkBlacklistedAddress(ctx: SecurityContext): SecurityVerdict | null {
  if (!ctx.toAddress) return null;
  if (isBlacklisted(ctx.toAddress)) {
    return {
      action: 'BLOCK',
      rule: 'BLACKLISTED_ADDRESS',
      message: `Address ${ctx.toAddress.slice(0, 10)}... is on the security blacklist.`
    };
  }
  return null;
}
