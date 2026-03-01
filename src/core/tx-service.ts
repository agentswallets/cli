import { Contract, Wallet, formatEther, formatUnits, parseEther, parseUnits } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import { CHAIN_ID, GAS_ESTIMATE_ERC20_POL, GAS_ESTIMATE_NATIVE_POL, USDC_ADDRESS, USDC_LEGACY_ADDRESS } from './constants.js';
import { getDb } from './db.js';
import { AppError } from './errors.js';
import { getProvider, mapRpcError, verifyChainId } from './rpc.js';
import { getWalletById } from './wallet-store.js';
import { decryptSecretAsBuffer } from './crypto.js';
import { safeSummary } from '../util/redact.js';
import type { OperationRow, PublicOperationRow } from './types.js';

function toPublicOperation(row: OperationRow): PublicOperationRow {
  const { wallet_id, meta_json, ...rest } = row;
  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(meta_json || '{}'); } catch { /* corrupt metadata */ }
  return { ...rest, meta };
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function walletBalance(walletId: string): Promise<{
  name: string;
  address: string;
  chain_id: number;
  balances: { POL: string; USDC: string; 'USDC.e': string };
}> {
  const wallet = getWalletById(walletId);
  await verifyChainId();
  try {
    const provider = getProvider();
    const [polRaw, usdcRaw, usdcBridgedRaw] = await Promise.all([
      provider.getBalance(wallet.address),
      new Contract(USDC_ADDRESS, ['function balanceOf(address) view returns (uint256)'], provider).balanceOf(wallet.address),
      new Contract(USDC_LEGACY_ADDRESS, ['function balanceOf(address) view returns (uint256)'], provider).balanceOf(wallet.address)
    ]);

    return {
      name: wallet.name,
      address: wallet.address,
      chain_id: CHAIN_ID,
      balances: {
        POL: formatEther(polRaw),
        USDC: formatUnits(usdcRaw, 6),
        'USDC.e': formatUnits(usdcBridgedRaw, 6)
      }
    };
  } catch (err) {
    return mapRpcError(err);
  }
}

export async function preflightBalanceCheck(walletId: string, token: 'POL' | 'USDC' | 'USDC.e', amount: number): Promise<void> {
  const bal = await walletBalance(walletId);
  const polBalance = Number(bal.balances.POL);
  if (token === 'POL') {
    const needed = amount + GAS_ESTIMATE_NATIVE_POL;
    if (polBalance < needed) {
      throw new AppError(
        'ERR_INSUFFICIENT_FUNDS',
        `Insufficient POL: need ~${needed.toFixed(4)} (${amount} + ~${GAS_ESTIMATE_NATIVE_POL} gas), have ${polBalance.toFixed(4)}`
      );
    }
  } else {
    const label = token === 'USDC.e' ? 'USDC.e' : 'USDC';
    const tokenBalance = Number(token === 'USDC.e' ? bal.balances['USDC.e'] : bal.balances.USDC);
    if (tokenBalance < amount) {
      throw new AppError(
        'ERR_INSUFFICIENT_FUNDS',
        `Insufficient ${label}: need ${amount}, have ${tokenBalance.toFixed(6)}`
      );
    }
    if (polBalance < GAS_ESTIMATE_ERC20_POL) {
      throw new AppError(
        'ERR_INSUFFICIENT_FUNDS',
        `Insufficient POL for gas: need ~${GAS_ESTIMATE_ERC20_POL}, have ${polBalance.toFixed(4)}`
      );
    }
  }
}

export async function executeSend(input: {
  wallet_id: string;
  to: string;
  token: 'POL' | 'USDC' | 'USDC.e';
  amount: string;
  idempotency_key: string;
  password: string;
  txId?: string; // If provided, pending record already created by atomic policy check
}): Promise<{ tx_id: string; tx_hash: string; status: string; token: string; amount: string; to: string }> {
  await verifyChainId();
  const db = getDb();
  const walletRow = getWalletById(input.wallet_id);
  const txId = input.txId || `tx_${uuidv4().replace(/-/g, '').slice(0, 20)}`;

  // Preflight: check balance before decrypting keys
  await preflightBalanceCheck(input.wallet_id, input.token, Number(input.amount));

  // H-8: Insert pending record before broadcasting (skip if already created atomically)
  if (!input.txId) {
    const now = nowIso();
    db.prepare(
      `INSERT INTO operations(tx_id,wallet_id,kind,status,token,amount,to_address,tx_hash,provider_order_id,idempotency_key,meta_json,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(txId, input.wallet_id, 'send', 'pending', input.token, input.amount, input.to, null, null, input.idempotency_key, JSON.stringify({}), now, now);
  }

  let pkBuf: Buffer | null = null;
  try {
    pkBuf = decryptSecretAsBuffer(walletRow.encrypted_private_key, input.password);
    // SECURITY NOTE: toString('utf8') creates an immutable JS string in V8 heap that cannot
    // be zeroed. This is a Node.js runtime limitation. The Buffer is zeroed in finally{}.
    // Mitigation: short-lived scope, no persistence, signer discarded after tx broadcast.
    const signer = new Wallet(pkBuf.toString('utf8'), getProvider());
    let txHash = '';

    if (input.token === 'POL') {
      const tx = await signer.sendTransaction({ to: input.to, value: parseEther(input.amount) });
      txHash = tx.hash;
    } else {
      const contractAddr = input.token === 'USDC.e' ? USDC_LEGACY_ADDRESS : USDC_ADDRESS;
      const contract = new Contract(contractAddr, ['function transfer(address to, uint256 amount) returns (bool)'], signer);
      const tx = await contract.transfer(input.to, parseUnits(input.amount, 6));
      txHash = tx.hash;
    }

    // H-8: Update to broadcasted + bind idempotency atomically
    db.transaction(() => {
      db.prepare('UPDATE operations SET status=?, tx_hash=?, updated_at=? WHERE tx_id=?')
        .run('broadcasted', txHash, nowIso(), txId);
      db.prepare('UPDATE idempotency_keys SET ref_id=?, status=? WHERE key=?')
        .run(txId, 'completed', input.idempotency_key);
    })();

    // Wait for on-chain confirmation (timeout 45s — Polygon ~2s blocks)
    let finalStatus = 'broadcasted';
    try {
      const provider = getProvider();
      const receipt = await provider.waitForTransaction(txHash, 1, 45_000);
      if (receipt) {
        finalStatus = receipt.status === 1 ? 'confirmed' : 'failed';
        db.prepare('UPDATE operations SET status=?, updated_at=? WHERE tx_id=?')
          .run(finalStatus, nowIso(), txId);
      }
    } catch {
      // Timeout or network error — keep broadcasted, don't block
    }

    return { tx_id: txId, tx_hash: txHash, status: finalStatus, token: input.token, amount: input.amount, to: input.to };
  } catch (err) {
    // H-8: Mark as failed on error
    try {
      db.prepare('UPDATE operations SET status=?, updated_at=? WHERE tx_id=?')
        .run('failed', nowIso(), txId);
    } catch { /* best effort */ }

    const raw = err instanceof Error ? err.message : String(err);
    const msg = safeSummary(raw);
    if (/insufficient funds/i.test(raw)) {
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
}): string {
  const db = getDb();
  const now = nowIso();
  const txId = `tx_${uuidv4().replace(/-/g, '').slice(0, 20)}`;
  db.prepare(
    `INSERT INTO operations(tx_id,wallet_id,kind,status,token,amount,to_address,tx_hash,provider_order_id,idempotency_key,meta_json,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(txId, input.wallet_id, input.kind, 'pending', input.token, input.amount, input.to_address ?? null, null, null, input.idempotency_key, JSON.stringify(input.meta ?? {}), now, now);
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
