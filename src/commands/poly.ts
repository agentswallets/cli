import { assertInitialized, getDb } from '../core/db.js';
import { evaluatePolicy } from '../core/policy-engine.js';
import { isSessionValid } from '../core/session.js';
import { AppError } from '../core/errors.js';
import { getPolicy, getWalletById } from '../core/wallet-store.js';
import { createPendingProviderOperation, dailySpendStats, finalizeProviderOperation, preflightBalanceCheck } from '../core/tx-service.js';
import { getOperationByIdempotencyKey, reserveIdempotencyKey } from '../util/idempotency.js';
import { requirePositiveNumber, requirePositiveInt } from '../util/validate.js';
import { getMasterPassword } from '../util/agent-input.js';
import { decryptSecretAsBuffer } from '../core/crypto.js';
import { logAudit } from '../core/audit-service.js';
import { getPolymarketAdapter } from '../core/polymarket/factory.js';
type PredictOrderResult = { tx_id: string; provider_order_id: string | undefined; provider_status: string; order?: unknown };

export async function polySearchCommand(q: string, limit: number): Promise<{ markets: unknown }> {
  assertInitialized();
  if (!q) throw new AppError('ERR_INVALID_PARAMS', '--query is required');
  const adapter = getPolymarketAdapter();
  const result = await adapter.searchMarkets({ query: q, limit });
  logAudit({ action: 'predict.markets', request: { q, limit }, decision: 'ok', result });
  return { markets: result.data };
}

export async function polyBuyCommand(
  walletId: string,
  opts: { market: string; outcome: string; size: string; price: string; idempotencyKey: string; dryRun?: boolean }
): Promise<PredictOrderResult | (PredictOrderResult & { dry_run: true })> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'This command requires an unlocked session. Run `aw unlock`.');
  const side = opts.outcome.toLowerCase();
  if (side !== 'yes' && side !== 'no') throw new AppError('ERR_INVALID_PARAMS', '--outcome must be yes|no');
  const size = requirePositiveNumber(opts.size, 'size');
  const price = requirePositiveNumber(opts.price, 'price');
  const amount = Math.round(size * price * 1e6) / 1e6;

  // Dry-run: validate policy only, no DB writes or external calls
  if (opts.dryRun) {
    const policy = getPolicy(walletId);
    const stats = dailySpendStats(walletId, 'USDC');
    const decision = evaluatePolicy({ policy, token: 'USDC', amount, stats });
    if (decision.status !== 'allowed') {
      throw new AppError(decision.code, decision.message, decision.details);
    }
    return { tx_id: '', provider_order_id: undefined, provider_status: 'dry_run', dry_run: true } as PredictOrderResult & { dry_run: true };
  }

  // ATOMIC: idempotency + policy check + pending INSERT under IMMEDIATE lock.
  const policy = getPolicy(walletId);
  const db = getDb();
  const atomicResult = db.transaction(() => {
    reserveIdempotencyKey(opts.idempotencyKey, 'predict_buy');
    const existing = getOperationByIdempotencyKey(opts.idempotencyKey);
    if (existing) {
      if (existing.status !== 'failed' && existing.status !== 'pending') {
        let meta: Record<string, unknown> = {};
        try { meta = JSON.parse(existing.meta_json ?? '{}'); } catch { /* corrupt metadata */ }
        return {
          type: 'replay' as const,
          tx_id: existing.tx_id,
          provider_order_id: existing.provider_order_id ?? undefined,
          provider_status: existing.status ?? 'submitted',
          order: meta,
        };
      }
      db.prepare('DELETE FROM operations WHERE tx_id=?').run(existing.tx_id);
      db.prepare('DELETE FROM idempotency_keys WHERE key=?').run(opts.idempotencyKey);
      reserveIdempotencyKey(opts.idempotencyKey, 'predict_buy');
    }
    const stats = dailySpendStats(walletId, 'USDC');
    const decision = evaluatePolicy({ policy, token: 'USDC', amount, stats });
    if (decision.status !== 'allowed') {
      logAudit({
        wallet_id: walletId,
        action: 'predict.buy',
        request: { walletId, ...opts },
        decision: 'denied',
        error_code: decision.code
      });
      throw new AppError(decision.code, decision.message, decision.details);
    }
    return {
      type: 'new' as const,
      txId: createPendingProviderOperation({
        wallet_id: walletId,
        kind: 'predict_buy',
        token: 'USDC',
        amount: String(amount),
        idempotency_key: opts.idempotencyKey,
        meta: { market: opts.market, outcome: side, size, price }
      })
    };
  }).immediate();

  if (atomicResult.type === 'replay') {
    return atomicResult as PredictOrderResult;
  }
  const txId = atomicResult.txId;

  // Preflight: verify USDC.e (bridged) balance — Polymarket uses USDC.e, not native USDC
  await preflightBalanceCheck(walletId, 'USDC.e', amount);

  const wallet = getWalletById(walletId);
  const password = await getMasterPassword('Master password for polymarket signing: ');
  const adapter = getPolymarketAdapter();
  let pkBuf: Buffer | null = null;
  let result: Awaited<ReturnType<typeof adapter.buy>>;
  try {
    pkBuf = decryptSecretAsBuffer(wallet.encrypted_private_key, password);
    result = await adapter.buy({
      market: opts.market,
      outcome: side,
      size,
      price,
      privateKey: pkBuf.toString('utf8')
    });
  } finally {
    pkBuf?.fill(0);
  }

  // Finalize: update pending → submitted + bind idempotency key
  finalizeProviderOperation(txId, {
    status: 'submitted',
    provider_order_id: result.provider_order_id ? String(result.provider_order_id) : undefined,
    idempotency_key: opts.idempotencyKey
  });

  const buyResult = {
    tx_id: txId,
    provider_order_id: result.provider_order_id ?? undefined,
    provider_status: result.provider_status ?? 'submitted',
    order: result.data
  };
  logAudit({
    wallet_id: walletId,
    action: 'predict.buy',
    request: { walletId, ...opts },
    decision: 'sent',
    result: buyResult
  });
  return buyResult;
}

export async function polySellCommand(
  walletId: string,
  opts: { position: string; size: string; idempotencyKey: string; dryRun?: boolean }
): Promise<PredictOrderResult | (PredictOrderResult & { dry_run: true })> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'This command requires an unlocked session. Run `aw unlock`.');
  const size = requirePositiveNumber(opts.size, 'size');

  // Dry-run: validate policy only, no DB writes or external calls
  if (opts.dryRun) {
    const policy = getPolicy(walletId);
    const stats = dailySpendStats(walletId, 'USDC');
    const decision = evaluatePolicy({ policy, token: 'USDC', amount: size, stats, skipSpendLimits: true });
    if (decision.status !== 'allowed') {
      throw new AppError(decision.code, decision.message, decision.details);
    }
    return { tx_id: '', provider_order_id: undefined, provider_status: 'dry_run', dry_run: true } as PredictOrderResult & { dry_run: true };
  }

  // ATOMIC: idempotency + policy check + pending INSERT under IMMEDIATE lock.
  const policy = getPolicy(walletId);
  const db = getDb();
  const atomicResult = db.transaction(() => {
    reserveIdempotencyKey(opts.idempotencyKey, 'predict_sell');
    const existing = getOperationByIdempotencyKey(opts.idempotencyKey);
    if (existing) {
      if (existing.status !== 'failed' && existing.status !== 'pending') {
        let meta: Record<string, unknown> = {};
        try { meta = JSON.parse(existing.meta_json ?? '{}'); } catch { /* corrupt metadata */ }
        return {
          type: 'replay' as const,
          tx_id: existing.tx_id,
          provider_order_id: existing.provider_order_id ?? undefined,
          provider_status: existing.status ?? 'submitted',
          order: meta,
        };
      }
      db.prepare('DELETE FROM operations WHERE tx_id=?').run(existing.tx_id);
      db.prepare('DELETE FROM idempotency_keys WHERE key=?').run(opts.idempotencyKey);
      reserveIdempotencyKey(opts.idempotencyKey, 'predict_sell');
    }
    const stats = dailySpendStats(walletId, 'USDC');
    const decision = evaluatePolicy({ policy, token: 'USDC', amount: size, stats, skipSpendLimits: true });
    if (decision.status !== 'allowed') {
      logAudit({
        wallet_id: walletId,
        action: 'predict.sell',
        request: { walletId, ...opts },
        decision: 'denied',
        error_code: decision.code
      });
      throw new AppError(decision.code, decision.message, decision.details);
    }
    return {
      type: 'new' as const,
      txId: createPendingProviderOperation({
        wallet_id: walletId,
        kind: 'predict_sell',
        token: 'USDC',
        amount: String(size),
        idempotency_key: opts.idempotencyKey,
        meta: { position_id: opts.position, size }
      })
    };
  }).immediate();

  if (atomicResult.type === 'replay') {
    return atomicResult as PredictOrderResult;
  }
  const txId = atomicResult.txId;

  const wallet = getWalletById(walletId);
  const password = await getMasterPassword('Master password for polymarket signing: ');
  const adapter = getPolymarketAdapter();
  let pkBuf: Buffer | null = null;
  let result: Awaited<ReturnType<typeof adapter.sell>>;
  try {
    pkBuf = decryptSecretAsBuffer(wallet.encrypted_private_key, password);
    result = await adapter.sell({
      positionId: opts.position,
      size,
      privateKey: pkBuf.toString('utf8')
    });
  } finally {
    pkBuf?.fill(0);
  }

  finalizeProviderOperation(txId, {
    status: 'submitted',
    provider_order_id: result.provider_order_id ? String(result.provider_order_id) : undefined,
    idempotency_key: opts.idempotencyKey
  });

  const sellResult = {
    tx_id: txId,
    provider_order_id: result.provider_order_id ?? undefined,
    provider_status: result.provider_status ?? 'submitted',
    order: result.data
  };
  logAudit({
    wallet_id: walletId,
    action: 'predict.sell',
    request: { walletId, ...opts },
    decision: 'sent',
    result: sellResult
  });
  return sellResult;
}

export async function polyPositionsCommand(walletId: string): Promise<{ positions: unknown }> {
  assertInitialized();
  // No unlock required — positions are public on-chain data queried by address.
  const wallet = getWalletById(walletId);
  const adapter = getPolymarketAdapter();
  const result = await adapter.positions({ walletAddress: wallet.address });
  logAudit({ wallet_id: walletId, action: 'predict.positions', request: { walletId }, decision: 'ok', result });
  return { positions: result.data };
}

export async function polyOrdersCommand(walletId: string): Promise<{ orders: unknown }> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'This command requires an unlocked session. Run `aw unlock`.');
  const wallet = getWalletById(walletId);
  const password = await getMasterPassword('Master password for polymarket orders: ');
  const adapter = getPolymarketAdapter();
  let pkBuf: Buffer | null = null;
  try {
    pkBuf = decryptSecretAsBuffer(wallet.encrypted_private_key, password);
    const result = await adapter.orders({ privateKey: pkBuf.toString('utf8') });
    logAudit({ wallet_id: walletId, action: 'predict.orders', request: { walletId }, decision: 'ok', result });
    return { orders: result.data };
  } finally {
    pkBuf?.fill(0);
  }
}

export async function polyCancelCommand(walletId: string, orderId: string): Promise<{ cancelled: true } & Record<string, unknown>> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'This command requires an unlocked session. Run `aw unlock`.');
  if (!orderId) throw new AppError('ERR_INVALID_PARAMS', '--order-id is required');
  const wallet = getWalletById(walletId);
  const password = await getMasterPassword('Master password for polymarket cancel: ');
  const adapter = getPolymarketAdapter();
  let pkBuf: Buffer | null = null;
  try {
    pkBuf = decryptSecretAsBuffer(wallet.encrypted_private_key, password);
    const result = await adapter.cancelOrder({ orderId, privateKey: pkBuf.toString('utf8') });
    logAudit({ wallet_id: walletId, action: 'predict.cancel', request: { walletId, orderId }, decision: 'ok', result });
    return { cancelled: true, ...(result.data as Record<string, unknown>) };
  } finally {
    pkBuf?.fill(0);
  }
}

export async function polyApproveCheckCommand(walletId: string): Promise<{ approvals: unknown }> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'This command requires an unlocked session. Run `aw unlock`.');
  const wallet = getWalletById(walletId);
  const password = await getMasterPassword('Master password for polymarket approve check: ');
  const adapter = getPolymarketAdapter();
  let pkBuf: Buffer | null = null;
  try {
    pkBuf = decryptSecretAsBuffer(wallet.encrypted_private_key, password);
    const result = await adapter.approveCheck({ privateKey: pkBuf.toString('utf8') });
    logAudit({ wallet_id: walletId, action: 'predict.approve_check', request: { walletId }, decision: 'ok', result });
    return { approvals: result.data };
  } finally {
    pkBuf?.fill(0);
  }
}

export async function polyApproveSetCommand(walletId: string): Promise<{ approved: true } & Record<string, unknown>> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'This command requires an unlocked session. Run `aw unlock`.');
  const wallet = getWalletById(walletId);
  const password = await getMasterPassword('Master password for polymarket approve set: ');
  const adapter = getPolymarketAdapter();
  let pkBuf: Buffer | null = null;
  try {
    pkBuf = decryptSecretAsBuffer(wallet.encrypted_private_key, password);
    const result = await adapter.approveSet({ privateKey: pkBuf.toString('utf8') });
    logAudit({ wallet_id: walletId, action: 'predict.approve_set', request: { walletId }, decision: 'ok', result });
    return { approved: true, ...(result.data as Record<string, unknown>) };
  } finally {
    pkBuf?.fill(0);
  }
}

export async function polyUpdateBalanceCommand(walletId: string): Promise<{ updated: true } & Record<string, unknown>> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'This command requires an unlocked session. Run `aw unlock`.');
  const wallet = getWalletById(walletId);
  const password = await getMasterPassword('Master password for polymarket update-balance: ');
  const adapter = getPolymarketAdapter();
  let pkBuf: Buffer | null = null;
  try {
    pkBuf = decryptSecretAsBuffer(wallet.encrypted_private_key, password);
    const result = await adapter.updateBalance({ privateKey: pkBuf.toString('utf8') });
    logAudit({ wallet_id: walletId, action: 'predict.update_balance', request: { walletId }, decision: 'ok', result });
    return { updated: true, ...(result.data as Record<string, unknown>) };
  } finally {
    pkBuf?.fill(0);
  }
}

export async function polyCtfSplitCommand(
  walletId: string,
  opts: { condition: string; amount: string }
): Promise<{ split: true } & Record<string, unknown>> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'This command requires an unlocked session. Run `aw unlock`.');
  if (!opts.condition) throw new AppError('ERR_INVALID_PARAMS', '--condition is required');
  const amount = requirePositiveNumber(opts.amount, 'amount');
  const wallet = getWalletById(walletId);
  const password = await getMasterPassword('Master password for CTF split: ');
  const adapter = getPolymarketAdapter();
  let pkBuf: Buffer | null = null;
  try {
    pkBuf = decryptSecretAsBuffer(wallet.encrypted_private_key, password);
    const result = await adapter.ctfSplit({ condition: opts.condition, amount, privateKey: pkBuf.toString('utf8') });
    logAudit({ wallet_id: walletId, action: 'predict.ctf_split', request: { walletId, ...opts }, decision: 'ok', result });
    return { split: true, ...(result.data as Record<string, unknown>) };
  } finally {
    pkBuf?.fill(0);
  }
}

export async function polyCtfMergeCommand(
  walletId: string,
  opts: { condition: string; amount: string }
): Promise<{ merged: true } & Record<string, unknown>> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'This command requires an unlocked session. Run `aw unlock`.');
  if (!opts.condition) throw new AppError('ERR_INVALID_PARAMS', '--condition is required');
  const amount = requirePositiveNumber(opts.amount, 'amount');
  const wallet = getWalletById(walletId);
  const password = await getMasterPassword('Master password for CTF merge: ');
  const adapter = getPolymarketAdapter();
  let pkBuf: Buffer | null = null;
  try {
    pkBuf = decryptSecretAsBuffer(wallet.encrypted_private_key, password);
    const result = await adapter.ctfMerge({ condition: opts.condition, amount, privateKey: pkBuf.toString('utf8') });
    logAudit({ wallet_id: walletId, action: 'predict.ctf_merge', request: { walletId, ...opts }, decision: 'ok', result });
    return { merged: true, ...(result.data as Record<string, unknown>) };
  } finally {
    pkBuf?.fill(0);
  }
}

export async function polyCtfRedeemCommand(
  walletId: string,
  opts: { condition: string }
): Promise<{ redeemed: true } & Record<string, unknown>> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'This command requires an unlocked session. Run `aw unlock`.');
  if (!opts.condition) throw new AppError('ERR_INVALID_PARAMS', '--condition is required');
  const wallet = getWalletById(walletId);
  const password = await getMasterPassword('Master password for CTF redeem: ');
  const adapter = getPolymarketAdapter();
  let pkBuf: Buffer | null = null;
  try {
    pkBuf = decryptSecretAsBuffer(wallet.encrypted_private_key, password);
    const result = await adapter.ctfRedeem({ condition: opts.condition, privateKey: pkBuf.toString('utf8') });
    logAudit({ wallet_id: walletId, action: 'predict.ctf_redeem', request: { walletId, ...opts }, decision: 'ok', result });
    return { redeemed: true, ...(result.data as Record<string, unknown>) };
  } finally {
    pkBuf?.fill(0);
  }
}

export async function polyBridgeDepositCommand(walletId: string): Promise<{ deposit_addresses: unknown }> {
  assertInitialized();
  const wallet = getWalletById(walletId);
  const adapter = getPolymarketAdapter();
  const result = await adapter.bridgeDeposit({ walletAddress: wallet.address });
  logAudit({ wallet_id: walletId, action: 'predict.bridge_deposit', request: { walletId }, decision: 'ok', result });
  return { deposit_addresses: result.data };
}
