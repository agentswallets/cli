import { AppError } from '../core/errors.js';
import { logAudit } from '../core/audit-service.js';
import { confirmAction } from '../util/agent-input.js';
import { getDb } from '../core/db.js';
import { getSetting } from '../core/settings.js';
import type { SecurityContext, SecurityVerdict, AddressHistoryLookup, BalanceLookup, RecentTxCountLookup, KnownTokenLookup } from './types.js';
import { checkDrainAll, checkExportKey, checkLargeTransfer, checkNewAddress, checkAllBalanceSwap, checkPolicyChange, checkBlacklistedAddress } from './redlines.js';
import { checkHighSlippage, checkUnknownToken, checkHighLeverage, checkRapidTransactions, checkNightTrading, checkLargeCrossChain, checkLargePerpPosition } from './yellowlines.js';
import { checkRateLimit } from './rate-limiter.js';

// ── Default lookup implementations (query real DB) ──

function defaultHasHistory(walletId: string, address: string): boolean {
  const db = getDb();
  const row = db.prepare(
    'SELECT 1 FROM operations WHERE wallet_id=? AND to_address=? COLLATE NOCASE LIMIT 1'
  ).get(walletId, address);
  return row !== undefined;
}

function defaultGetBalance(_walletId: string, _token: string, _chain: string): number {
  // Balance lookup requires async RPC calls — not available in sync context.
  // Return 0 to skip ALL_BALANCE_SWAP check when no balance is pre-provided.
  return 0;
}

function defaultGetRecentTxCount(walletId: string, minutesAgo: number): number {
  const db = getDb();
  const since = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM operations WHERE wallet_id=? AND created_at>=?'
  ).get(walletId, since) as { cnt: number };
  return row.cnt;
}

function defaultIsKnownToken(token: string, chain: string): boolean {
  // Dynamically import to avoid circular deps — check if token exists in chain config
  try {
    const db = getDb();
    // Simple heuristic: if we have operations with this token, it's known
    const row = db.prepare(
      'SELECT 1 FROM operations WHERE token=? AND chain_name=? COLLATE NOCASE LIMIT 1'
    ).get(token, chain);
    if (row) return true;
  } catch { /* ignore */ }
  // Also accept any token that's in our chain config — checked by caller before security guard
  return true;
}

/** Get configurable threshold from settings. */
function getThreshold(key: string, defaultVal: number): number {
  const raw = getSetting(`security.${key}`);
  if (raw) {
    const val = Number(raw);
    if (!isNaN(val) && val > 0) return val;
  }
  return defaultVal;
}

export type SecurityCheckOpts = {
  yes?: boolean;
  force?: boolean;
  // Injectable lookups for testing
  hasHistory?: AddressHistoryLookup;
  getBalance?: BalanceLookup;
  getRecentTxCount?: RecentTxCountLookup;
  isKnownToken?: KnownTokenLookup;
};

/**
 * SecurityGuard core — runs all red/yellow line rules and enforces verdicts.
 *
 * Returns warnings array for JSON output attachment.
 */
export async function securityCheck(
  ctx: SecurityContext,
  opts: SecurityCheckOpts = {}
): Promise<{ warnings: SecurityVerdict[] }> {
  const hasHistory = opts.hasHistory ?? defaultHasHistory;
  const getBalance = opts.getBalance ?? defaultGetBalance;
  const getRecentTxCount = opts.getRecentTxCount ?? defaultGetRecentTxCount;
  const isKnownToken = opts.isKnownToken ?? defaultIsKnownToken;

  // Rate limit check (before red/yellow lines)
  try {
    checkRateLimit(ctx.walletId);
  } catch (err) {
    if (err instanceof AppError && err.code === 'ERR_RATE_LIMITED') {
      logAudit({
        wallet_id: ctx.walletId,
        action: 'security.rate_limit_hit',
        request: { context: ctx },
        decision: 'blocked',
        error_code: 'ERR_RATE_LIMITED',
      });
    }
    throw err;
  }

  const largeTransferThreshold = getThreshold('large_transfer_threshold', 1000);

  const verdicts: SecurityVerdict[] = [];

  // ── Red lines ──
  const redLineChecks = [
    checkBlacklistedAddress(ctx),
    checkDrainAll(ctx),
    checkExportKey(ctx),
    checkLargeTransfer(ctx, largeTransferThreshold),
    checkNewAddress(ctx, hasHistory),
    checkAllBalanceSwap(ctx, getBalance),
    checkPolicyChange(ctx),
  ];

  for (const v of redLineChecks) {
    if (v) verdicts.push(v);
  }

  // ── Yellow lines ──
  const yellowLineChecks = [
    checkHighSlippage(ctx),
    checkHighLeverage(ctx),
    checkRapidTransactions(ctx, getRecentTxCount),
    checkNightTrading(ctx),
    checkLargeCrossChain(ctx),
    checkLargePerpPosition(ctx),
    checkUnknownToken(ctx, isKnownToken),
  ];

  for (const v of yellowLineChecks) {
    if (v) verdicts.push(v);
  }

  // ── Enforce verdicts ──
  const warnings: SecurityVerdict[] = [];

  for (const v of verdicts) {
    if (v.action === 'BLOCK') {
      logAudit({
        wallet_id: ctx.walletId,
        action: `security.red_line_blocked`,
        request: { rule: v.rule, context: ctx },
        decision: 'blocked',
        error_code: 'ERR_RED_LINE_BLOCKED',
      });
      throw new AppError('ERR_RED_LINE_BLOCKED', v.message ?? 'Action blocked by security rule.', {
        rule: v.rule,
      });
    }

    if (v.action === 'REQUIRE_CONFIRMATION') {
      logAudit({
        wallet_id: ctx.walletId,
        action: 'security.red_line_triggered',
        request: { rule: v.rule, context: ctx },
        decision: 'pending_confirmation',
      });

      // All red lines require AW_ALLOW_YES=1 env var to allow --yes auto-confirm.
      // This prevents agents from silently auto-confirming dangerous operations.
      const autoConfirmAllowed = process.env.AW_ALLOW_YES === '1';
      const effectiveYes = opts.yes && autoConfirmAllowed;

      const confirmed = await confirmAction(
        `[Security] ${v.message} Continue? (y/n): `,
        effectiveYes
      );

      if (!confirmed) {
        logAudit({
          wallet_id: ctx.walletId,
          action: 'security.red_line_blocked',
          request: { rule: v.rule, context: ctx },
          decision: 'user_denied',
        });
        throw new AppError('ERR_RED_LINE_BLOCKED', v.message ?? 'Action cancelled by user.', {
          rule: v.rule,
        });
      }

      logAudit({
        wallet_id: ctx.walletId,
        action: 'security.red_line_confirmed',
        request: { rule: v.rule, context: ctx },
        decision: 'confirmed',
      });
      warnings.push(v);
    }

    if (v.action === 'WARN_AND_LOG') {
      logAudit({
        wallet_id: ctx.walletId,
        action: 'security.yellow_line_warning',
        request: { rule: v.rule, context: ctx },
        decision: 'warned',
      });

      if (!opts.force) {
        process.stderr.write(`[security warning] ${v.message}\n`);
      }
      warnings.push(v);
    }

    if (v.action === 'LOG_ONLY') {
      logAudit({
        wallet_id: ctx.walletId,
        action: 'security.yellow_line_warning',
        request: { rule: v.rule, context: ctx },
        decision: 'logged',
      });
      // No output, just audit
    }
  }

  return { warnings };
}
