import { Contract, Wallet, formatEther, formatUnits, parseEther, parseUnits } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import { type ChainKey, getChain, getDefaultChainKey, isSolanaChain, resolveToken } from './chains.js';
import { getDb } from './db.js';
import { AppError } from './errors.js';
import { getProvider, mapRpcError, verifyChainId } from './rpc.js';
import { getWalletById } from './wallet-store.js';
import { decryptSecretAsBuffer } from './crypto.js';
import { safeSummary } from '../util/redact.js';
import { validateSigningIntent } from '../security/signing-validator.js';
import type { OperationRow, PublicOperationRow } from './types.js';
import { getEvmAdapter } from './evm-adapter.js';
import { getSolanaAdapter } from './solana-adapter.js';

function toPublicOperation(row: OperationRow): PublicOperationRow {
  const { wallet_id, meta_json, ...rest } = row;
  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(meta_json || '{}'); } catch { /* corrupt metadata */ }
  return { ...rest, meta };
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function walletBalance(walletId: string, chainKey?: ChainKey): Promise<{
  name: string;
  address: string;
  chain: string;
  balances: Record<string, string>;
}> {
  const key = chainKey ?? getDefaultChainKey();
  const chain = getChain(key);
  const wallet = getWalletById(walletId);

  if (isSolanaChain(key)) {
    if (!wallet.solana_address) {
      throw new AppError('ERR_INVALID_PARAMS', 'This wallet does not support Solana. Create a new wallet to use Solana.');
    }
    try {
      const adapter = getSolanaAdapter();
      const balances = await adapter.getBalances(wallet.solana_address);
      return { name: wallet.name, address: wallet.solana_address, chain: chain.name, balances };
    } catch (err) {
      if (err instanceof AppError) throw err;
      const raw = err instanceof Error ? err.message : String(err);
      throw new AppError('ERR_RPC_UNAVAILABLE', safeSummary(raw));
    }
  }

  // EVM path
  await verifyChainId(key);
  try {
    const adapter = getEvmAdapter(key);
    const balances = await adapter.getBalances(wallet.address);
    return { name: wallet.name, address: wallet.address, chain: chain.name, balances };
  } catch (err) {
    if (err instanceof AppError) throw err;
    return mapRpcError(err);
  }
}

export async function preflightBalanceCheck(walletId: string, token: string, amount: number, chainKey?: ChainKey): Promise<void> {
  const key = chainKey ?? getDefaultChainKey();
  const chain = getChain(key);
  const tokenInfo = resolveToken(chain, token);
  const bal = await walletBalance(walletId, key);
  const nativeToken = chain.tokens.find(t => t.address === null)!;
  const nativeBalance = Number(bal.balances[nativeToken.symbol]);

  if (tokenInfo.address === null) {
    // Native token send
    const needed = amount + chain.gasEstimateNative;
    if (nativeBalance < needed) {
      throw new AppError(
        'ERR_INSUFFICIENT_FUNDS',
        `Insufficient ${tokenInfo.symbol}: need ~${needed.toFixed(4)} (${amount} + ~${chain.gasEstimateNative} gas), have ${nativeBalance.toFixed(4)}`
      );
    }
  } else {
    // ERC20 send
    const tokenBalance = Number(bal.balances[tokenInfo.symbol]);
    if (tokenBalance < amount) {
      throw new AppError(
        'ERR_INSUFFICIENT_FUNDS',
        `Insufficient ${tokenInfo.symbol}: need ${amount}, have ${tokenBalance.toFixed(6)}`
      );
    }
    if (nativeBalance < chain.gasEstimateErc20) {
      throw new AppError(
        'ERR_INSUFFICIENT_FUNDS',
        `Insufficient ${nativeToken.symbol} for gas: need ~${chain.gasEstimateErc20}, have ${nativeBalance.toFixed(4)}`
      );
    }
  }
}

export async function executeSend(input: {
  wallet_id: string;
  to: string;
  token: string;
  amount: string;
  idempotency_key: string;
  password: string;
  txId?: string;
  chain?: ChainKey;
}): Promise<{ tx_id: string; tx_hash: string; status: string; token: string; amount: string; to: string; chain: string; explorer_url: string }> {
  const chainKey = input.chain ?? getDefaultChainKey();
  const chain = getChain(chainKey);
  const tokenInfo = resolveToken(chain, input.token);
  const solana = isSolanaChain(chainKey);
  if (!solana) await verifyChainId(chainKey);
  const db = getDb();
  const walletRow = getWalletById(input.wallet_id);
  const txId = input.txId || `tx_${uuidv4().replace(/-/g, '').slice(0, 20)}`;

  if (solana && (!walletRow.solana_address || !walletRow.encrypted_solana_key)) {
    throw new AppError('ERR_INVALID_PARAMS', 'This wallet does not support Solana. Create a new wallet to use Solana.');
  }

  // Preflight: check balance before decrypting keys
  await preflightBalanceCheck(input.wallet_id, input.token, Number(input.amount), chainKey);

  // H-8: Insert pending record before broadcasting (skip if already created atomically)
  if (!input.txId) {
    const now = nowIso();
    db.prepare(
      `INSERT INTO operations(tx_id,wallet_id,kind,status,token,amount,to_address,tx_hash,provider_order_id,idempotency_key,meta_json,chain_name,chain_id,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(txId, input.wallet_id, 'send', 'pending', input.token, input.amount, input.to, null, null, input.idempotency_key, JSON.stringify({}), chain.name, chain.chainId, now, now);
  }

  let pkBuf: Buffer | null = null;
  try {
    if (solana) {
      // Solana path — decrypt solana key
      pkBuf = decryptSecretAsBuffer(walletRow.encrypted_solana_key!, input.password);
      const adapter = getSolanaAdapter();
      const result = await adapter.send({
        privateKey: pkBuf,
        to: input.to,
        token: input.token,
        amount: input.amount,
      });

      // Solana sends are confirmed inline via sendAndConfirmTransaction
      db.transaction(() => {
        db.prepare('UPDATE operations SET status=?, tx_hash=?, updated_at=? WHERE tx_id=?')
          .run(result.status, result.txHash, nowIso(), txId);
        db.prepare('UPDATE idempotency_keys SET ref_id=?, status=? WHERE key=?')
          .run(txId, 'completed', input.idempotency_key);
      })();

      return { tx_id: txId, tx_hash: result.txHash, status: result.status, token: input.token, amount: input.amount, to: input.to, chain: chain.name, explorer_url: `${chain.explorerTxUrl}${result.txHash}` };
    }

    // EVM path — validate signing intent before decrypting keys
    validateSigningIntent({
      userTo: input.to,
      userChainId: chain.chainId,
      txTo: input.to,
      txChainId: chain.chainId,
    });

    pkBuf = decryptSecretAsBuffer(walletRow.encrypted_private_key, input.password);
    const adapter = getEvmAdapter(chainKey);
    const result = await adapter.send({
      privateKey: pkBuf,
      to: input.to,
      token: input.token,
      amount: input.amount,
    });

    // H-8: Update to broadcasted + bind idempotency atomically
    db.transaction(() => {
      db.prepare('UPDATE operations SET status=?, tx_hash=?, updated_at=? WHERE tx_id=?')
        .run('broadcasted', result.txHash, nowIso(), txId);
      db.prepare('UPDATE idempotency_keys SET ref_id=?, status=? WHERE key=?')
        .run(txId, 'completed', input.idempotency_key);
    })();

    // Wait for on-chain confirmation
    const confirmation = await adapter.waitForConfirmation(result.txHash, 45_000);
    if (confirmation.status !== 'broadcasted') {
      db.prepare('UPDATE operations SET status=?, updated_at=? WHERE tx_id=?')
        .run(confirmation.status, nowIso(), txId);
    }

    return { tx_id: txId, tx_hash: result.txHash, status: confirmation.status, token: input.token, amount: input.amount, to: input.to, chain: chain.name, explorer_url: `${chain.explorerTxUrl}${result.txHash}` };
  } catch (err) {
    // H-8: Mark as failed on error
    try {
      db.prepare('UPDATE operations SET status=?, updated_at=? WHERE tx_id=?')
        .run('failed', nowIso(), txId);
    } catch { /* best effort */ }

    if (err instanceof AppError) throw err;
    const raw = err instanceof Error ? err.message : String(err);
    const msg = safeSummary(raw);
    if (/insufficient funds|Attempt to debit/i.test(raw)) {
      throw new AppError('ERR_INSUFFICIENT_FUNDS', msg);
    }
    if (/execution reverted|replacement transaction underpriced|nonce|intrinsic gas too low/i.test(raw)) {
      throw new AppError('ERR_TX_FAILED', msg);
    }
    return mapRpcError(err);
  } finally {
    pkBuf?.fill(0);
  }
}

export function txHistory(walletId: string, limit: number): {
  name: string;
  address: string;
  operations: PublicOperationRow[];
} {
  const wallet = getWalletById(walletId);
  const db = getDb();
  const operations = db
    .prepare('SELECT * FROM operations WHERE wallet_id=? ORDER BY created_at DESC LIMIT ?')
    .all(walletId, limit) as OperationRow[];
  return { name: wallet.name, address: wallet.address, operations: operations.map(toPublicOperation) };
}

export function txStatus(txId: string): PublicOperationRow {
  const db = getDb();
  const row = db.prepare('SELECT * FROM operations WHERE tx_id=?').get(txId) as OperationRow | undefined;
  if (!row) throw new AppError('ERR_INVALID_PARAMS', `tx_id not found: ${txId}`);
  return toPublicOperation(row);
}

/** Insert a pending provider operation BEFORE calling external API (crash-safe). */
export function createPendingProviderOperation(input: {
  wallet_id: string;
  kind: string;
  token: string;
  amount: string;
  to_address?: string;
  idempotency_key: string;
  meta?: unknown;
  chain_name?: string;
  chain_id?: number;
}): string {
  const db = getDb();
  const now = nowIso();
  const txId = `tx_${uuidv4().replace(/-/g, '').slice(0, 20)}`;
  db.prepare(
    `INSERT INTO operations(tx_id,wallet_id,kind,status,token,amount,to_address,tx_hash,provider_order_id,idempotency_key,meta_json,chain_name,chain_id,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(txId, input.wallet_id, input.kind, 'pending', input.token, input.amount, input.to_address ?? null, null, null, input.idempotency_key, JSON.stringify(input.meta ?? {}), input.chain_name ?? null, input.chain_id ?? null, now, now);
  return txId;
}

/** Update a provider operation after external API returns (or fails). */
export function finalizeProviderOperation(txId: string, input: {
  status: string;
  provider_order_id?: string;
  idempotency_key: string;
}): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('UPDATE operations SET status=?, provider_order_id=?, updated_at=? WHERE tx_id=?')
      .run(input.status, input.provider_order_id ?? null, nowIso(), txId);
    db.prepare('UPDATE idempotency_keys SET ref_id=?, status=? WHERE key=?')
      .run(txId, 'completed', input.idempotency_key);
  })();
}

export function dailySpendStats(walletId: string, token: string): { todaySpent: number; todayTxCount: number } {
  const db = getDb();
  // UTC midnight boundary — consistent with ISO 8601 dates stored in the DB
  const dayStart = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';

  const activeStatuses = ['pending', 'broadcasted', 'confirmed', 'submitted', 'filled'];
  const statusPlaceholders = activeStatuses.map(() => '?').join(',');

  // Per-token spend: daily_limit applies independently per token
  const upperToken = token.toUpperCase();
  const tokenVariants = [upperToken];
  const tokenPlaceholders = tokenVariants.map(() => '?').join(',');
  const spendRow = db
    .prepare(
      `SELECT COALESCE(SUM(CAST(amount AS REAL)),0) AS total FROM operations
       WHERE wallet_id=? AND token IN (${tokenPlaceholders}) AND created_at>=? AND status IN (${statusPlaceholders})`
    )
    .get(walletId, ...tokenVariants, dayStart, ...activeStatuses) as { total: number };

  // Global tx count: max_tx_per_day is a rate limit across all tokens
  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM operations
       WHERE wallet_id=? AND created_at>=? AND status IN (${statusPlaceholders})`
    )
    .get(walletId, dayStart, ...activeStatuses) as { cnt: number };

  return { todaySpent: spendRow.total, todayTxCount: countRow.cnt };
}
