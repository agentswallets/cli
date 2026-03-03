import { AppError } from '../core/errors.js';
import { assertInitialized, getDb } from '../core/db.js';
import { isSessionValid } from '../core/session.js';
import { evaluatePolicy } from '../core/policy-engine.js';
import { createPendingProviderOperation, dailySpendStats, executeSend, txHistory, txStatus } from '../core/tx-service.js';
import { getPolicy } from '../core/wallet-store.js';
import type { PublicOperationRow } from '../core/types.js';
import { getOperationByIdempotencyKey, isStalePending, reserveIdempotencyKey } from '../util/idempotency.js';
import { requireAddress, requireChainAddress, requirePositiveNumber } from '../util/validate.js';
import { getMasterPassword } from '../util/agent-input.js';
import { logAudit } from '../core/audit-service.js';
import { type ChainKey, getChain, resolveChainKey, resolveToken } from '../core/chains.js';

export async function txSendCommand(
  walletId: string,
  opts: { to: string; token: string; amount: string; idempotencyKey: string; dryRun?: boolean; chain?: string }
): Promise<{ tx_id: string; tx_hash: string | null; status: string; token: string; amount: string; to: string; chain?: string; explorer_url?: string; dry_run?: boolean }> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'This command requires an unlocked session. Run `aw unlock`.');

  const chainKey = resolveChainKey(opts.chain);
  const chain = getChain(chainKey);

  // Resolve and validate token for this chain
  const tokenInfo = resolveToken(chain, opts.token);
  const token = tokenInfo.symbol;

  const to = requireChainAddress(opts.to, chain.chainType);
  const amount = requirePositiveNumber(opts.amount, 'amount');

  // Dry-run: validate policy + preflight only, no DB writes or broadcast
  if (opts.dryRun) {
    const policy = getPolicy(walletId);
    const stats = dailySpendStats(walletId, token);
    const decision = evaluatePolicy({ policy, token, amount, toAddress: to, stats });
    if (decision.status !== 'allowed') {
      throw new AppError(decision.code, decision.message, decision.details);
    }
    return { tx_id: '', tx_hash: null, status: 'dry_run', token, amount: String(amount), to, chain: chain.name, dry_run: true };
  }

  // ATOMIC: idempotency + policy check + pending INSERT under IMMEDIATE lock.
  const policy = getPolicy(walletId);
  const db = getDb();
  const atomicResult = db.transaction(() => {
    reserveIdempotencyKey(opts.idempotencyKey, 'tx_send');
    const existing = getOperationByIdempotencyKey(opts.idempotencyKey);
    if (existing) {
      if (existing.status === 'failed' || isStalePending(existing)) {
        // Failed or stale pending (process crashed) — safe to delete and recreate
        db.prepare('DELETE FROM operations WHERE tx_id=?').run(existing.tx_id);
        db.prepare('DELETE FROM idempotency_keys WHERE key=?').run(opts.idempotencyKey);
        reserveIdempotencyKey(opts.idempotencyKey, 'tx_send');
      } else {
        // pending/broadcasted/confirmed — return existing to avoid double-send
        return {
          type: 'replay' as const,
          tx_id: existing.tx_id,
          tx_hash: existing.tx_hash ?? null,
          status: existing.status ?? 'pending',
          token: existing.token ?? token,
          amount: existing.amount ?? String(amount),
          to: existing.to_address ?? to
        };
      }
    }
    const stats = dailySpendStats(walletId, token);
    const decision = evaluatePolicy({ policy, token, amount, toAddress: to, stats });
    if (decision.status !== 'allowed') {
      logAudit({
        wallet_id: walletId,
        action: 'tx.send',
        request: { walletId, ...opts },
        decision: 'denied',
        error_code: decision.code,
        chain_name: chain.name,
        chain_id: chain.chainId
      });
      throw new AppError(decision.code, decision.message, decision.details);
    }
    return {
      type: 'new' as const,
      txId: createPendingProviderOperation({
        wallet_id: walletId,
        kind: 'send',
        token,
        amount: String(amount),
        to_address: to,
        idempotency_key: opts.idempotencyKey,
        meta: { to },
        chain_name: chain.name,
        chain_id: chain.chainId
      })
    };
  }).immediate();

  if (atomicResult.type === 'replay') {
    return { tx_id: atomicResult.tx_id, tx_hash: atomicResult.tx_hash, status: atomicResult.status, token: atomicResult.token, amount: atomicResult.amount, to: atomicResult.to, chain: chain.name };
  }
  const txId = atomicResult.txId;

  const password = await getMasterPassword('Master password for signing: ');
  const sendResult = await executeSend({
    wallet_id: walletId,
    to,
    token,
    amount: String(amount),
    idempotency_key: opts.idempotencyKey,
    password,
    txId,
    chain: chainKey
  });

  logAudit({
    wallet_id: walletId,
    action: 'tx.send',
    request: { walletId, ...opts },
    decision: 'sent',
    result: sendResult,
    chain_name: chain.name,
    chain_id: chain.chainId
  });
  return sendResult;
}

export function txHistoryCommand(walletId: string, limit: number): { name: string; address: string; operations: PublicOperationRow[]; hint?: string } {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'This command requires an unlocked session. Run `aw unlock`.');
  const result = txHistory(walletId, limit);
  return result.operations.length === 0
    ? { ...result, hint: 'No transactions found. Send tokens with: aw send --wallet <name> --to <addr> --amount <n> --token USDC' }
    : result;
}

export function txStatusCommand(txId: string): PublicOperationRow {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'This command requires an unlocked session. Run `aw unlock`.');
  return txStatus(txId);
}
