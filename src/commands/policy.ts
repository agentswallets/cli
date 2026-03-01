import { assertInitialized } from '../core/db.js';
import { isSessionValid } from '../core/session.js';
import { getPolicy, getWalletById, upsertPolicy } from '../core/wallet-store.js';
import { requireAddress, requirePositiveNumber, requirePositiveInt } from '../util/validate.js';
import { logAudit } from '../core/audit-service.js';
import { AppError } from '../core/errors.js';
import type { PolicyConfig } from '../core/types.js';

export function policySetCommand(
  walletId: string,
  opts: {
    limitDaily?: string;
    limitPerTx?: string;
    maxTxPerDay?: string;
    allowedTokens?: string;
    allowedAddresses?: string;
    requireApprovalAbove?: string;
  }
): { name: string; address: string; policy: PolicyConfig } {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'This command requires an unlocked session. Run `aw unlock`.');
  const wallet = getWalletById(walletId);
  const existing = getPolicy(walletId);

  // Require at least one field to be set
  const hasAnyField = opts.limitDaily !== undefined || opts.limitPerTx !== undefined ||
    opts.maxTxPerDay !== undefined || opts.allowedTokens !== undefined ||
    opts.allowedAddresses !== undefined || opts.requireApprovalAbove !== undefined;
  if (!hasAnyField) {
    throw new AppError('ERR_INVALID_PARAMS', 'At least one policy field must be specified.');
  }

  // Parse allowed_addresses with validation
  let allowedAddresses = existing.allowed_addresses;
  if (opts.allowedAddresses !== undefined) {
    const raw = opts.allowedAddresses.trim();
    allowedAddresses = raw === '' ? [] : raw.split(',').map(a => requireAddress(a.trim()));
  }

  // Parse allowed_tokens
  let allowedTokens = existing.allowed_tokens;
  if (opts.allowedTokens !== undefined) {
    const raw = opts.allowedTokens.trim();
    allowedTokens = raw === '' ? [] : raw.split(',').map(t => {
      const upper = t.trim().toUpperCase();
      return upper === 'USDC.E' ? 'USDC.e' : upper;
    });
  }

  // Parse require_approval_above (0 = clear/disable)
  let requireApprovalAbove = existing.require_approval_above;
  if (opts.requireApprovalAbove !== undefined) {
    const val = requirePositiveNumber(opts.requireApprovalAbove, 'require-approval-above');
    requireApprovalAbove = val === 0 ? null : val;
  }

  const policy: PolicyConfig = {
    daily_limit:
      opts.limitDaily !== undefined ? requirePositiveNumber(opts.limitDaily, 'limit-daily') : existing.daily_limit,
    per_tx_limit:
      opts.limitPerTx !== undefined ? requirePositiveNumber(opts.limitPerTx, 'limit-per-tx') : existing.per_tx_limit,
    max_tx_per_day:
      opts.maxTxPerDay !== undefined ? requirePositiveInt(opts.maxTxPerDay, 'max-tx-per-day') : existing.max_tx_per_day,
    allowed_tokens: allowedTokens,
    allowed_addresses: allowedAddresses,
    require_approval_above: requireApprovalAbove
  };

  upsertPolicy(walletId, policy);
  logAudit({ wallet_id: walletId, action: 'policy.set', request: opts, decision: 'ok' });
  return { name: wallet.name, address: wallet.address, policy };
}

export function policyShowCommand(walletId: string): { name: string; address: string; policy: PolicyConfig } {
  assertInitialized();
  const wallet = getWalletById(walletId);
  return { name: wallet.name, address: wallet.address, policy: getPolicy(walletId) };
}
