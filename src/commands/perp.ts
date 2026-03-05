import { assertInitialized, getDb } from '../core/db.js';
import { isSessionValid } from '../core/session.js';
import { AppError } from '../core/errors.js';
import { getWalletById } from '../core/wallet-store.js';
import { getPolicy } from '../core/wallet-store.js';
import { evaluatePolicy } from '../core/policy-engine.js';
import { logAudit } from '../core/audit-service.js';
import { decryptSecretAsBuffer } from '../core/crypto.js';
import { getMasterPassword } from '../util/agent-input.js';
import { reserveIdempotencyKey, getOperationByIdempotencyKey } from '../util/idempotency.js';
import { createPendingProviderOperation, finalizeProviderOperation, dailySpendStats } from '../core/tx-service.js';
import { requirePositiveNumber } from '../util/validate.js';
import { getPerps, getPrices, getFundingRates, resolveAssetIndex } from '../core/hyperliquid/market.js';
import { getAccountSummary, getOpenOrders, getUserFills } from '../core/hyperliquid/account.js';
import { openPosition, closePosition, cancelOrder } from '../core/hyperliquid/trading.js';
import { createExchangeClient } from '../core/hyperliquid/client.js';
import { ensureBuilderFeeApproved } from '../core/hyperliquid/builder-fee.js';

// ── Read-only commands ──

/**
 * aw perp assets — list tradable perpetual assets.
 */
export async function perpAssetsCommand(): Promise<{ assets: Array<{ name: string; szDecimals: number; maxLeverage: number }> }> {
  assertInitialized();
  const { assets } = await getPerps();
  return { assets };
}

/**
 * aw perp prices — get current mid prices.
 */
export async function perpPricesCommand(opts: { asset?: string }): Promise<{ prices: Record<string, string> }> {
  assertInitialized();
  const allPrices = await getPrices();
  if (opts.asset) {
    const upper = opts.asset.toUpperCase();
    const price = allPrices[upper];
    if (!price) {
      throw new AppError('ERR_HL_INVALID_ASSET', `No price found for asset: ${opts.asset}`);
    }
    return { prices: { [upper]: price } };
  }
  return { prices: allPrices };
}

/**
 * aw perp funding — get funding rates for an asset.
 */
export async function perpFundingCommand(opts: { asset: string }): Promise<{ coin: string; rates: Array<{ fundingRate: string; premium: string; time: number }> }> {
  assertInitialized();
  const rates = await getFundingRates(opts.asset.toUpperCase());
  return { coin: opts.asset.toUpperCase(), rates };
}

/**
 * aw perp account — account overview (margin, positions, PnL).
 */
export async function perpAccountCommand(walletId: string): Promise<{
  accountValue: string;
  totalMarginUsed: string;
  withdrawable: string;
  positions: Array<{
    coin: string; szi: string; leverage: number; entryPx: string;
    unrealizedPnl: string; liquidationPx: string | null; marginUsed: string;
  }>;
}> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'Session required. Run `aw unlock`.');
  const wallet = getWalletById(walletId);
  return getAccountSummary(wallet.address);
}

/**
 * aw perp positions — current positions.
 */
export async function perpPositionsCommand(walletId: string): Promise<{
  positions: Array<{
    coin: string; szi: string; leverage: number; entryPx: string;
    unrealizedPnl: string; liquidationPx: string | null; marginUsed: string;
  }>;
}> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'Session required. Run `aw unlock`.');
  const wallet = getWalletById(walletId);
  const summary = await getAccountSummary(wallet.address);
  return { positions: summary.positions };
}

/**
 * aw perp orders — open orders.
 */
export async function perpOrdersCommand(walletId: string): Promise<{
  orders: Array<{ oid: number; coin: string; side: string; sz: string; limitPx: string; orderType: string; timestamp: number }>;
}> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'Session required. Run `aw unlock`.');
  const wallet = getWalletById(walletId);
  const orders = await getOpenOrders(wallet.address);
  return { orders };
}

// ── Write commands ──

/**
 * aw perp open — open a perpetual position.
 */
export async function perpOpenCommand(
  walletId: string,
  opts: {
    asset: string;
    side: string;
    size: string;
    leverage?: string;
    idempotencyKey: string;
    dryRun?: boolean;
  }
): Promise<{
  tx_id: string;
  status: string;
  asset: string;
  side: string;
  size: string;
  leverage: number;
  oid?: number;
  avgPx?: string;
  totalSz?: string;
  dry_run?: boolean;
}> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'Session required. Run `aw unlock`.');

  const wallet = getWalletById(walletId);
  const size = requirePositiveNumber(opts.size, 'size');
  const leverage = opts.leverage ? requirePositiveNumber(opts.leverage, 'leverage') : 1;

  if (!['long', 'short', 'buy', 'sell'].includes(opts.side)) {
    throw new AppError('ERR_INVALID_PARAMS', 'side must be one of: long, short, buy, sell');
  }
  const isBuy = opts.side === 'long' || opts.side === 'buy';

  // Resolve asset index (validates the asset exists)
  const assetIndex = await resolveAssetIndex(opts.asset);

  // Get current price for notional calculation
  const prices = await getPrices();
  const coinUpper = opts.asset.toUpperCase();
  const currentPrice = prices[coinUpper];
  if (!currentPrice) {
    throw new AppError('ERR_HL_INVALID_ASSET', `No price found for asset: ${opts.asset}`);
  }
  const notional = size * parseFloat(currentPrice);

  if (opts.dryRun) {
    return {
      tx_id: 'dry_run',
      status: 'dry_run',
      asset: coinUpper,
      side: opts.side,
      size: opts.size,
      leverage,
      dry_run: true,
    };
  }

  // Atomic: idempotency + policy + pending INSERT
  const db = getDb();
  const policy = getPolicy(walletId);
  const atomicResult = db.transaction(() => {
    reserveIdempotencyKey(opts.idempotencyKey, 'perp.open');
    const existing = getOperationByIdempotencyKey(opts.idempotencyKey);
    if (existing) {
      return { type: 'replay' as const, op: existing };
    }
    const stats = dailySpendStats(walletId, 'USDC');
    const decision = evaluatePolicy({
      policy,
      token: 'USDC',
      amount: notional,
      stats,
    });
    if (decision.status !== 'allowed') {
      logAudit({
        wallet_id: walletId,
        action: 'perp.open',
        request: { asset: coinUpper, side: opts.side, size: opts.size, leverage, notional },
        decision: 'denied',
        error_code: decision.code,
      });
      throw new AppError(decision.code, decision.message, decision.details);
    }
    const txId = createPendingProviderOperation({
      wallet_id: walletId,
      kind: 'perp.open',
      token: 'USDC',
      amount: String(notional),
      idempotency_key: opts.idempotencyKey,
      meta: { asset: coinUpper, side: opts.side, leverage },
      chain_name: 'Hyperliquid',
      chain_id: 42161, // Arbitrum-based
    });
    return { type: 'new' as const, txId };
  }).immediate();

  if (atomicResult.type === 'replay') {
    const op = atomicResult.op;
    if (op.status === 'failed' || op.status === 'pending') {
      throw new AppError('ERR_INVALID_PARAMS',
        `Previous operation with this idempotency key ${op.status === 'failed' ? 'failed' : 'did not complete'}. Use a new idempotency key to retry.`);
    }
    return {
      tx_id: op.tx_id,
      status: op.status ?? 'unknown',
      asset: coinUpper,
      side: opts.side,
      size: opts.size,
      leverage,
    };
  }

  const txId = atomicResult.txId;
  let pkBuf: Buffer | null = null;
  try {
    const password = await getMasterPassword('Master password for signing: ');
    pkBuf = decryptSecretAsBuffer(wallet.encrypted_private_key, password);
    const pkHex = '0x' + pkBuf.toString('hex');

    const { exchange } = createExchangeClient(pkHex);

    // Ensure builder fee is approved
    await ensureBuilderFeeApproved(exchange, wallet.address);

    // Open position
    const result = await openPosition({
      exchange,
      assetIndex,
      isBuy,
      size: opts.size,
      price: currentPrice,
      leverage,
    });

    // Finalize
    finalizeProviderOperation(txId, {
      status: 'confirmed',
      idempotency_key: opts.idempotencyKey,
    });

    logAudit({
      wallet_id: walletId,
      action: 'perp.open',
      request: { asset: coinUpper, side: opts.side, size: opts.size, leverage, notional },
      decision: 'sent',
      result: { oid: result.oid, avgPx: result.avgPx, totalSz: result.totalSz },
    });

    return {
      tx_id: txId,
      status: 'confirmed',
      asset: coinUpper,
      side: opts.side,
      size: result.totalSz ?? opts.size,
      leverage,
      oid: result.oid,
      avgPx: result.avgPx,
      totalSz: result.totalSz,
    };
  } catch (err) {
    try {
      db.prepare('UPDATE operations SET status=?, updated_at=? WHERE tx_id=?')
        .run('failed', new Date().toISOString(), txId);
    } catch { /* best effort */ }
    throw err;
  } finally {
    pkBuf?.fill(0);
  }
}

/**
 * aw perp close — close a perpetual position.
 */
export async function perpCloseCommand(
  walletId: string,
  opts: {
    asset: string;
    size?: string;
    idempotencyKey: string;
    dryRun?: boolean;
  }
): Promise<{
  tx_id: string;
  status: string;
  asset: string;
  size: string;
  oid?: number;
  avgPx?: string;
  totalSz?: string;
  dry_run?: boolean;
}> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'Session required. Run `aw unlock`.');

  const wallet = getWalletById(walletId);
  const coinUpper = opts.asset.toUpperCase();

  // Get current position to determine close size and direction
  const summary = await getAccountSummary(wallet.address);
  const pos = summary.positions.find((p) => p.coin === coinUpper);
  if (!pos) {
    throw new AppError('ERR_INVALID_PARAMS', `No open position for ${coinUpper}.`);
  }

  const posSize = Math.abs(parseFloat(pos.szi));
  const closeSize = opts.size ? requirePositiveNumber(opts.size, 'size') : posSize;
  const closeSizeStr = opts.size ?? String(posSize);
  // To close a long position, we sell (isBuy=false). To close a short, we buy (isBuy=true).
  const isLong = parseFloat(pos.szi) > 0;
  const isBuy = !isLong;

  const assetIndex = await resolveAssetIndex(opts.asset);

  const prices = await getPrices();
  const currentPrice = prices[coinUpper];
  if (!currentPrice) {
    throw new AppError('ERR_HL_INVALID_ASSET', `No price found for asset: ${opts.asset}`);
  }

  if (opts.dryRun) {
    return {
      tx_id: 'dry_run',
      status: 'dry_run',
      asset: coinUpper,
      size: closeSizeStr,
      dry_run: true,
    };
  }

  // Atomic: idempotency + policy + pending INSERT
  const db = getDb();
  const policy = getPolicy(walletId);
  const atomicResult = db.transaction(() => {
    reserveIdempotencyKey(opts.idempotencyKey, 'perp.close');
    const existing = getOperationByIdempotencyKey(opts.idempotencyKey);
    if (existing) {
      return { type: 'replay' as const, op: existing };
    }
    const stats = dailySpendStats(walletId, 'USDC');
    // Closing is recovering funds — skip spend limits
    const decision = evaluatePolicy({
      policy,
      token: 'USDC',
      amount: 0,
      stats,
      skipSpendLimits: true,
    });
    if (decision.status !== 'allowed') {
      logAudit({
        wallet_id: walletId,
        action: 'perp.close',
        request: { asset: coinUpper, size: closeSizeStr },
        decision: 'denied',
        error_code: decision.code,
      });
      throw new AppError(decision.code, decision.message, decision.details);
    }
    const txId = createPendingProviderOperation({
      wallet_id: walletId,
      kind: 'perp.close',
      token: 'USDC',
      amount: closeSizeStr,
      idempotency_key: opts.idempotencyKey,
      meta: { asset: coinUpper },
      chain_name: 'Hyperliquid',
      chain_id: 42161,
    });
    return { type: 'new' as const, txId };
  }).immediate();

  if (atomicResult.type === 'replay') {
    const op = atomicResult.op;
    if (op.status === 'failed' || op.status === 'pending') {
      throw new AppError('ERR_INVALID_PARAMS',
        `Previous operation with this idempotency key ${op.status === 'failed' ? 'failed' : 'did not complete'}. Use a new idempotency key to retry.`);
    }
    return {
      tx_id: op.tx_id,
      status: op.status ?? 'unknown',
      asset: coinUpper,
      size: closeSizeStr,
    };
  }

  const txId = atomicResult.txId;
  let pkBuf: Buffer | null = null;
  try {
    const password = await getMasterPassword('Master password for signing: ');
    pkBuf = decryptSecretAsBuffer(wallet.encrypted_private_key, password);
    const pkHex = '0x' + pkBuf.toString('hex');

    const { exchange } = createExchangeClient(pkHex);
    await ensureBuilderFeeApproved(exchange, wallet.address);

    const result = await closePosition({
      exchange,
      assetIndex,
      isBuy,
      size: closeSizeStr,
      price: currentPrice,
    });

    finalizeProviderOperation(txId, {
      status: 'confirmed',
      idempotency_key: opts.idempotencyKey,
    });

    logAudit({
      wallet_id: walletId,
      action: 'perp.close',
      request: { asset: coinUpper, size: closeSizeStr },
      decision: 'sent',
      result: { oid: result.oid, avgPx: result.avgPx, totalSz: result.totalSz },
    });

    return {
      tx_id: txId,
      status: 'confirmed',
      asset: coinUpper,
      size: result.totalSz ?? closeSizeStr,
      oid: result.oid,
      avgPx: result.avgPx,
      totalSz: result.totalSz,
    };
  } catch (err) {
    try {
      db.prepare('UPDATE operations SET status=?, updated_at=? WHERE tx_id=?')
        .run('failed', new Date().toISOString(), txId);
    } catch { /* best effort */ }
    throw err;
  } finally {
    pkBuf?.fill(0);
  }
}

/**
 * aw perp cancel — cancel an open order.
 */
export async function perpCancelCommand(
  walletId: string,
  opts: {
    asset: string;
    orderId: string;
    idempotencyKey: string;
  }
): Promise<{ tx_id: string; status: string; asset: string; orderId: number }> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'Session required. Run `aw unlock`.');

  const wallet = getWalletById(walletId);
  const coinUpper = opts.asset.toUpperCase();
  const oid = parseInt(opts.orderId, 10);
  if (isNaN(oid)) throw new AppError('ERR_INVALID_PARAMS', 'order-id must be a number');

  const assetIndex = await resolveAssetIndex(opts.asset);

  const db = getDb();
  const atomicResult = db.transaction(() => {
    reserveIdempotencyKey(opts.idempotencyKey, 'perp.cancel');
    const existing = getOperationByIdempotencyKey(opts.idempotencyKey);
    if (existing) {
      return { type: 'replay' as const, op: existing };
    }
    const txId = createPendingProviderOperation({
      wallet_id: walletId,
      kind: 'perp.cancel',
      token: 'USDC',
      amount: '0',
      idempotency_key: opts.idempotencyKey,
      meta: { asset: coinUpper, oid },
      chain_name: 'Hyperliquid',
      chain_id: 42161,
    });
    return { type: 'new' as const, txId };
  }).immediate();

  if (atomicResult.type === 'replay') {
    const op = atomicResult.op;
    if (op.status === 'failed' || op.status === 'pending') {
      throw new AppError('ERR_INVALID_PARAMS',
        `Previous operation with this idempotency key ${op.status === 'failed' ? 'failed' : 'did not complete'}. Use a new idempotency key to retry.`);
    }
    return {
      tx_id: op.tx_id,
      status: op.status ?? 'unknown',
      asset: coinUpper,
      orderId: oid,
    };
  }

  const txId = atomicResult.txId;
  let pkBuf: Buffer | null = null;
  try {
    const password = await getMasterPassword('Master password for signing: ');
    pkBuf = decryptSecretAsBuffer(wallet.encrypted_private_key, password);
    const pkHex = '0x' + pkBuf.toString('hex');

    const { exchange } = createExchangeClient(pkHex);

    await cancelOrder({ exchange, assetIndex, oid });

    finalizeProviderOperation(txId, {
      status: 'confirmed',
      idempotency_key: opts.idempotencyKey,
    });

    logAudit({
      wallet_id: walletId,
      action: 'perp.cancel',
      request: { asset: coinUpper, oid },
      decision: 'sent',
      result: { cancelled: true },
    });

    return {
      tx_id: txId,
      status: 'confirmed',
      asset: coinUpper,
      orderId: oid,
    };
  } catch (err) {
    try {
      db.prepare('UPDATE operations SET status=?, updated_at=? WHERE tx_id=?')
        .run('failed', new Date().toISOString(), txId);
    } catch { /* best effort */ }
    throw err;
  } finally {
    pkBuf?.fill(0);
  }
}
