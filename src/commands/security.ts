import { assertInitialized } from '../core/db.js';
import { isSessionValid } from '../core/session.js';
import { AppError } from '../core/errors.js';
import { logAudit } from '../core/audit-service.js';
import { addToBlacklist, removeFromBlacklist, listBlacklist, type BlacklistEntry } from '../security/blacklist.js';
import { requireAddress } from '../util/validate.js';
import { initBaseline, verifyBaseline } from '../security/baseline.js';
import { generateSecurityReport, type SecurityReport } from '../security/report.js';
import { detectAnomalies, type Anomaly } from '../security/anomaly.js';

export function securityBlacklistAddCommand(
  address: string,
  opts: { chain?: string; reason?: string }
): { added: true; address: string; chain?: string; reason?: string } {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'Session required. Run `aw unlock`.');

  const normalized = requireAddress(address);
  addToBlacklist(normalized, opts.chain, opts.reason);

  logAudit({
    action: 'security.blacklist_add',
    request: { address: normalized, chain: opts.chain, reason: opts.reason },
    decision: 'ok',
  });

  return { added: true, address: normalized, chain: opts.chain, reason: opts.reason };
}

export function securityBlacklistRemoveCommand(address: string): { removed: boolean; address: string } {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'Session required. Run `aw unlock`.');

  const normalized = requireAddress(address);
  const removed = removeFromBlacklist(normalized);

  logAudit({
    action: 'security.blacklist_remove',
    request: { address: normalized },
    decision: removed ? 'ok' : 'not_found',
  });

  return { removed, address: normalized };
}

export function securityBlacklistListCommand(): { blacklist: BlacklistEntry[] } {
  assertInitialized();
  return { blacklist: listBlacklist() };
}

export function securityStatusCommand(): {
  blacklist_count: number;
  hint: string;
} {
  assertInitialized();
  const entries = listBlacklist();
  return {
    blacklist_count: entries.length,
    hint: 'Use `aw security blacklist list` to see all blacklisted addresses.',
  };
}

// ── Baseline commands ──

export function securityBaselineInitCommand(): { initialized: true } {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'Session required. Run `aw unlock`.');
  initBaseline();
  logAudit({ action: 'security.baseline_init', request: {}, decision: 'ok' });
  return { initialized: true };
}

export function securityBaselineVerifyCommand(): { valid: boolean; mismatches: string[] } {
  assertInitialized();
  const result = verifyBaseline();
  logAudit({
    action: 'security.baseline_verify',
    request: {},
    decision: result.valid ? 'ok' : 'mismatch',
  });
  return result;
}

// ── Report command ──

export function securityReportCommand(opts?: {
  wallet?: string;
  days?: string;
}): SecurityReport {
  assertInitialized();
  const days = opts?.days ? parseInt(opts.days, 10) : 7;
  if (isNaN(days) || days <= 0) {
    throw new AppError('ERR_INVALID_PARAMS', 'Days must be a positive integer.');
  }
  return generateSecurityReport({ walletId: opts?.wallet, days });
}

// ── Anomaly command ──

export function securityAnomalyCommand(walletId: string, opts?: {
  days?: string;
}): { anomalies: Anomaly[] } {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'Session required. Run `aw unlock`.');
  const days = opts?.days ? parseInt(opts.days, 10) : 7;
  if (isNaN(days) || days <= 0) {
    throw new AppError('ERR_INVALID_PARAMS', 'Days must be a positive integer.');
  }
  return { anomalies: detectAnomalies(walletId, days) };
}
