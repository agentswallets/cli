import crypto from 'node:crypto';
import { assertInitialized } from '../core/db.js';
import { isSessionValid } from '../core/session.js';
import { AppError } from '../core/errors.js';
import { walletBalance } from '../core/tx-service.js';
import { getWalletById } from '../core/wallet-store.js';
import { GAS_ESTIMATE_NATIVE_POL, GAS_ESTIMATE_ERC20_POL, STABLECOIN_DUST_THRESHOLD } from '../core/constants.js';
import { logAudit } from '../core/audit-service.js';
import { requireAddress } from '../util/validate.js';
import { txSendCommand } from './tx.js';

type DrainTokenResult = {
  token: string;
  amount: string;
  status: 'sent' | 'dust' | 'zero' | 'error' | 'preview';
  tx_id?: string;
  tx_hash?: string;
  error?: string;
};

export async function walletDrainCommand(
  walletId: string,
  opts: { to: string; idempotencyKey?: string; dryRun?: boolean }
): Promise<{
  name: string;
  address: string;
  to: string;
  results: DrainTokenResult[];
  dry_run?: boolean;
}> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'This command requires an unlocked session. Run `aw unlock`.');

  const to = requireAddress(opts.to);
  const wallet = getWalletById(walletId);
  const baseKey = opts.idempotencyKey ?? crypto.randomUUID();

  const results: DrainTokenResult[] = [];

  // Step 1: Get initial balances
  const bal = await walletBalance(walletId);

  // ── dry-run branch: preview only, no transfers / DB writes / audit ──
  if (opts.dryRun) {
    let erc20PreviewCount = 0;
    for (const token of ['USDC', 'USDC.e'] as const) {
      const amount = parseFloat(bal.balances[token]);
      if (amount === 0) {
        results.push({ token, amount: '0', status: 'zero' });
      } else if (amount < STABLECOIN_DUST_THRESHOLD) {
        results.push({ token, amount: String(amount), status: 'dust' });
      } else {
        results.push({ token, amount: String(amount), status: 'preview' });
        erc20PreviewCount++;
      }
    }

    // Estimate POL remaining after ERC20 gas
    const polBalance = parseFloat(bal.balances.POL);
    const estimatedGas = erc20PreviewCount * GAS_ESTIMATE_ERC20_POL + GAS_ESTIMATE_NATIVE_POL;
    if (polBalance === 0) {
      results.push({ token: 'POL', amount: '0', status: 'zero' });
    } else if (polBalance <= estimatedGas) {
      results.push({ token: 'POL', amount: String(polBalance), status: 'dust' });
    } else {
      const polToSend = polBalance - estimatedGas;
      const polAmount = Math.floor(polToSend * 1e18) / 1e18;
      results.push({ token: 'POL', amount: String(polAmount), status: 'preview' });
    }

    return { name: wallet.name, address: wallet.address, to, results, dry_run: true };
  }

  // ── live execution ──

  // Step 2: Transfer ERC20 tokens first (need POL for gas)
  for (const token of ['USDC', 'USDC.e'] as const) {
    const amount = parseFloat(bal.balances[token]);
    if (amount === 0) {
      results.push({ token, amount: '0', status: 'zero' });
      continue;
    }
    if (amount < STABLECOIN_DUST_THRESHOLD) {
      results.push({ token, amount: String(amount), status: 'dust' });
      continue;
    }
    try {
      const res = await txSendCommand(walletId, {
        to,
        amount: String(amount),
        token,
        idempotencyKey: `${baseKey}-${token}`
      });
      results.push({ token, amount: String(amount), status: 'sent', tx_id: res.tx_id, tx_hash: res.tx_hash ?? undefined });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ token, amount: String(amount), status: 'error', error: msg });
    }
  }

  // Step 3: Re-check POL balance (gas consumed by ERC20 transfers)
  const balAfter = await walletBalance(walletId);
  const polBalance = parseFloat(balAfter.balances.POL);

  if (polBalance === 0) {
    results.push({ token: 'POL', amount: '0', status: 'zero' });
  } else if (polBalance <= GAS_ESTIMATE_NATIVE_POL) {
    results.push({ token: 'POL', amount: String(polBalance), status: 'dust' });
  } else {
    const polToSend = polBalance - GAS_ESTIMATE_NATIVE_POL;
    // Round down to avoid floating-point over-send
    const polAmount = Math.floor(polToSend * 1e18) / 1e18;
    try {
      const res = await txSendCommand(walletId, {
        to,
        amount: String(polAmount),
        token: 'POL',
        idempotencyKey: `${baseKey}-POL`
      });
      results.push({ token: 'POL', amount: String(polAmount), status: 'sent', tx_id: res.tx_id, tx_hash: res.tx_hash ?? undefined });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ token: 'POL', amount: String(polAmount), status: 'error', error: msg });
    }
  }

  // Step 4: Summary audit log
  logAudit({
    wallet_id: walletId,
    action: 'wallet.drain',
    request: { to, idempotencyKey: baseKey },
    decision: 'ok',
    result: { results }
  });

  return {
    name: wallet.name,
    address: wallet.address,
    to,
    results
  };
}
