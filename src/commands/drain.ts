import crypto from 'node:crypto';
import { assertInitialized } from '../core/db.js';
import { isSessionValid } from '../core/session.js';
import { AppError } from '../core/errors.js';
import { walletBalance } from '../core/tx-service.js';
import { getWalletById } from '../core/wallet-store.js';
import { STABLECOIN_DUST_THRESHOLD } from '../core/constants.js';
import { type ChainKey, getChain, resolveChainKey } from '../core/chains.js';
import { logAudit } from '../core/audit-service.js';
import { requireChainAddress } from '../util/validate.js';
import { txSendCommand } from './tx.js';
import { securityCheck } from '../security/guard.js';

type DrainTokenResult = {
  token: string;
  amount: string;
  status: 'sent' | 'dust' | 'zero' | 'error' | 'preview';
  tx_id?: string;
  tx_hash?: string;
  explorer_url?: string;
  error?: string;
};

export async function walletDrainCommand(
  walletId: string,
  opts: { to: string; idempotencyKey?: string; dryRun?: boolean; chain?: string; force?: boolean; yes?: boolean }
): Promise<{
  name: string;
  address: string;
  to: string;
  chain: string;
  results: DrainTokenResult[];
  dry_run?: boolean;
}> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'This command requires an unlocked session. Run `aw unlock`.');

  const chainKey = resolveChainKey(opts.chain);
  const chain = getChain(chainKey);
  const to = requireChainAddress(opts.to, chain.chainType);
  const wallet = getWalletById(walletId);
  const baseKey = opts.idempotencyKey ?? crypto.randomUUID();
  const erc20Tokens = chain.tokens.filter(t => t.address !== null);
  const nativeToken = chain.tokens.find(t => t.address === null)!;
  const nativeUnit = 10 ** nativeToken.decimals;

  // Security check (skip in dry-run) — drain is always a red line
  if (!opts.dryRun) {
    await securityCheck(
      { walletId, action: 'wallet.drain', toAddress: to, chain: chain.name },
      { yes: opts.yes, force: opts.force }
    );
  }

  const results: DrainTokenResult[] = [];

  // Step 1: Get initial balances
  const bal = await walletBalance(walletId, chainKey);

  // ── dry-run branch: preview only, no transfers / DB writes / audit ──
  if (opts.dryRun) {
    let erc20PreviewCount = 0;
    for (const token of erc20Tokens) {
      const amount = parseFloat(bal.balances[token.symbol]);
      if (amount === 0) {
        results.push({ token: token.symbol, amount: '0', status: 'zero' });
      } else if (amount < STABLECOIN_DUST_THRESHOLD) {
        results.push({ token: token.symbol, amount: String(amount), status: 'dust' });
      } else {
        results.push({ token: token.symbol, amount: String(amount), status: 'preview' });
        erc20PreviewCount++;
      }
    }

    // Estimate native token remaining after ERC20 gas
    const nativeBalance = parseFloat(bal.balances[nativeToken.symbol]);
    const estimatedGas = erc20PreviewCount * chain.gasEstimateErc20 + chain.gasEstimateNative;
    if (nativeBalance === 0) {
      results.push({ token: nativeToken.symbol, amount: '0', status: 'zero' });
    } else if (nativeBalance <= estimatedGas) {
      results.push({ token: nativeToken.symbol, amount: String(nativeBalance), status: 'dust' });
    } else {
      const toSend = nativeBalance - estimatedGas;
      const rounded = Math.floor(toSend * nativeUnit) / nativeUnit;
      results.push({ token: nativeToken.symbol, amount: String(rounded), status: 'preview' });
    }

    return { name: wallet.name, address: wallet.address, to, chain: chain.name, results, dry_run: true };
  }

  // ── live execution ──

  // Step 2: Transfer ERC20 tokens first (need native token for gas)
  for (const token of erc20Tokens) {
    const amount = parseFloat(bal.balances[token.symbol]);
    if (amount === 0) {
      results.push({ token: token.symbol, amount: '0', status: 'zero' });
      continue;
    }
    if (amount < STABLECOIN_DUST_THRESHOLD) {
      results.push({ token: token.symbol, amount: String(amount), status: 'dust' });
      continue;
    }
    try {
      const res = await txSendCommand(walletId, {
        to,
        amount: String(amount),
        token: token.symbol,
        idempotencyKey: `${baseKey}-${token.symbol}`,
        chain: chainKey,
      });
      results.push({ token: token.symbol, amount: String(amount), status: 'sent', tx_id: res.tx_id, tx_hash: res.tx_hash ?? undefined, explorer_url: res.explorer_url });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ token: token.symbol, amount: String(amount), status: 'error', error: msg });
    }
  }

  // Step 3: Re-check native balance (gas consumed by ERC20 transfers)
  const balAfter = await walletBalance(walletId, chainKey);
  const nativeBalance = parseFloat(balAfter.balances[nativeToken.symbol]);

  if (nativeBalance === 0) {
    results.push({ token: nativeToken.symbol, amount: '0', status: 'zero' });
  } else if (nativeBalance <= chain.gasEstimateNative) {
    results.push({ token: nativeToken.symbol, amount: String(nativeBalance), status: 'dust' });
  } else {
    const toSend = nativeBalance - chain.gasEstimateNative;
    // Round down to avoid floating-point over-send
    const rounded = Math.floor(toSend * nativeUnit) / nativeUnit;
    try {
      const res = await txSendCommand(walletId, {
        to,
        amount: String(rounded),
        token: nativeToken.symbol,
        idempotencyKey: `${baseKey}-${nativeToken.symbol}`,
        chain: chainKey,
      });
      results.push({ token: nativeToken.symbol, amount: String(rounded), status: 'sent', tx_id: res.tx_id, tx_hash: res.tx_hash ?? undefined, explorer_url: res.explorer_url });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ token: nativeToken.symbol, amount: String(rounded), status: 'error', error: msg });
    }
  }

  // Step 4: Summary audit log
  logAudit({
    wallet_id: walletId,
    action: 'wallet.drain',
    request: { to, idempotencyKey: baseKey, chain: chainKey },
    decision: 'ok',
    result: { results },
    chain_name: chain.name,
    chain_id: chain.chainId
  });

  return {
    name: wallet.name,
    address: wallet.address,
    to,
    chain: chain.name,
    results
  };
}
