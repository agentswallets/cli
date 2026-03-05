import { assertInitialized, getDb } from '../core/db.js';
import { isSessionValid } from '../core/session.js';
import { AppError } from '../core/errors.js';
import { resolveChainKey, getChain, isSolanaChain } from '../core/chains.js';
import { getWalletById } from '../core/wallet-store.js';
import { getPolicy } from '../core/wallet-store.js';
import { evaluatePolicy } from '../core/policy-engine.js';
import { logAudit } from '../core/audit-service.js';
import { decryptSecretAsBuffer } from '../core/crypto.js';
import { getMasterPassword } from '../util/agent-input.js';
import { resolveWallet } from '../core/wallet-store.js';
import { reserveIdempotencyKey, getOperationByIdempotencyKey } from '../util/idempotency.js';
import { createPendingProviderOperation, finalizeProviderOperation, dailySpendStats } from '../core/tx-service.js';
import { requirePositiveNumber } from '../util/validate.js';
import { getOkxCredentials } from '../core/okx/client.js';
import { chainKeyToOkxChainIndex, resolveTokenAddress } from '../core/okx/token-resolver.js';
import { getSwapQuote, getSwapApproval, getSupportedSwapChains } from '../core/okx/swap.js';
import { executeSwap } from '../core/okx/swap-executor.js';
import { NATIVE_TOKEN_ADDRESS } from '../core/okx/constants.js';

/** Convert human-readable amount to smallest unit string. */
function toSmallestUnit(amount: number, decimals: number): string {
  // toFixed avoids scientific notation (e.g., 1e-18 → "0.000000000000000001")
  const str = amount.toFixed(decimals);
  const [intPart, fracPart = ''] = str.split('.');
  const paddedFrac = fracPart.padEnd(decimals, '0').slice(0, decimals);
  const raw = intPart + paddedFrac;
  return BigInt(raw).toString();
}

/** Get the wallet address for the given chain. */
function getWalletAddress(wallet: { address: string; solana_address: string | null }, solana: boolean): string {
  if (solana) {
    if (!wallet.solana_address) {
      throw new AppError('ERR_INVALID_PARAMS', 'This wallet does not support Solana. Create a new wallet to use Solana.');
    }
    return wallet.solana_address;
  }
  return wallet.address;
}

/**
 * aw swap chains — list supported chains for DEX swap.
 */
export async function swapChainsCommand(opts: { chain?: string }): Promise<{ chains: Array<{ chainId: string; chainName: string }> }> {
  assertInitialized();

  const credentials = getOkxCredentials();
  const chains = await getSupportedSwapChains(credentials);

  return { chains };
}

/**
 * aw swap quote — get a swap quote without executing.
 */
export async function swapQuoteCommand(opts: {
  chain?: string;
  from: string;
  to: string;
  amount: string;
  slippage?: string;
  wallet: string;
}): Promise<{
  from_token: string;
  to_token: string;
  from_amount: string;
  to_amount: string;
  estimated_gas: string;
  chain: string;
}> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'Session required. Run `aw unlock`.');

  const chainKey = resolveChainKey(opts.chain);
  const chain = getChain(chainKey);
  const solana = isSolanaChain(chainKey);

  const wallet = resolveWallet(opts.wallet);
  const walletAddr = getWalletAddress(wallet, solana);
  const fromToken = resolveTokenAddress(chainKey, opts.from);
  const toToken = resolveTokenAddress(chainKey, opts.to);
  const amount = requirePositiveNumber(opts.amount, 'amount');
  const amountSmallest = toSmallestUnit(amount, fromToken.decimals);
  const slippage = opts.slippage || '0.5';

  const credentials = getOkxCredentials();

  const { routerResult } = await getSwapQuote({
    chainId: chainKeyToOkxChainIndex(chainKey),
    fromTokenAddress: fromToken.address,
    toTokenAddress: toToken.address,
    amount: amountSmallest,
    slippage,
    userWalletAddress: walletAddr,
    credentials,
  });

  return {
    from_token: routerResult.fromToken.tokenSymbol,
    to_token: routerResult.toToken.tokenSymbol,
    from_amount: routerResult.fromTokenAmount,
    to_amount: routerResult.toTokenAmount,
    estimated_gas: routerResult.estimateGasFee,
    chain: chain.name,
  };
}

/**
 * aw swap exec — execute a token swap.
 */
export async function swapExecCommand(
  walletId: string,
  opts: {
    chain?: string;
    from: string;
    to: string;
    amount: string;
    slippage?: string;
    idempotencyKey: string;
    dryRun?: boolean;
  }
): Promise<{
  tx_id: string;
  tx_hash: string | null;
  status: string;
  from_token: string;
  to_token: string;
  from_amount: string;
  to_amount: string;
  chain: string;
  explorer_url?: string;
  dry_run?: boolean;
}> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'Session required. Run `aw unlock`.');

  const chainKey = resolveChainKey(opts.chain);
  const chain = getChain(chainKey);
  const solana = isSolanaChain(chainKey);

  const wallet = getWalletById(walletId);
  const walletAddr = getWalletAddress(wallet, solana);
  const fromToken = resolveTokenAddress(chainKey, opts.from);
  const toToken = resolveTokenAddress(chainKey, opts.to);
  const amount = requirePositiveNumber(opts.amount, 'amount');
  const amountSmallest = toSmallestUnit(amount, fromToken.decimals);
  const slippage = opts.slippage || '0.5';

  if (opts.dryRun) {
    return {
      tx_id: 'dry_run',
      tx_hash: null,
      status: 'dry_run',
      from_token: fromToken.symbol,
      to_token: toToken.symbol,
      from_amount: opts.amount,
      to_amount: '(quote required)',
      chain: chain.name,
      dry_run: true,
    };
  }

  // Atomic: idempotency + policy + pending INSERT
  const db = getDb();
  const policy = getPolicy(walletId);
  const atomicResult = db.transaction(() => {
    reserveIdempotencyKey(opts.idempotencyKey, 'swap');
    const existing = getOperationByIdempotencyKey(opts.idempotencyKey);
    if (existing) {
      return { type: 'replay' as const, op: existing };
    }
    const stats = dailySpendStats(walletId, fromToken.symbol);
    const decision = evaluatePolicy({
      policy,
      token: fromToken.symbol,
      amount,
      stats,
      // Skip toAddress check — destination is OKX DEX router, not user-specified
    });
    if (decision.status !== 'allowed') {
      logAudit({
        wallet_id: walletId,
        action: 'swap.exec',
        request: { from: opts.from, to: opts.to, amount: opts.amount, chain: chainKey },
        decision: 'denied',
        error_code: decision.code,
        chain_name: chain.name,
        chain_id: chain.chainId,
      });
      throw new AppError(decision.code, decision.message, decision.details);
    }
    const txId = createPendingProviderOperation({
      wallet_id: walletId,
      kind: 'swap',
      token: fromToken.symbol,
      amount: opts.amount,
      idempotency_key: opts.idempotencyKey,
      meta: { from_token: fromToken.symbol, to_token: toToken.symbol },
      chain_name: chain.name,
      chain_id: chain.chainId,
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
      tx_hash: op.tx_hash,
      status: op.status ?? 'unknown',
      from_token: fromToken.symbol,
      to_token: toToken.symbol,
      from_amount: op.amount ?? opts.amount,
      to_amount: '',
      chain: chain.name,
      explorer_url: op.tx_hash ? `${chain.explorerTxUrl}${op.tx_hash}` : undefined,
    };
  }

  const txId = atomicResult.txId;
  let pkBuf: Buffer | null = null;
  try {
    const password = await getMasterPassword('Master password for signing: ');
    const credentials = getOkxCredentials();

    // Get swap quote with tx calldata
    const { routerResult, needsApproval } = await getSwapQuote({
      chainId: chainKeyToOkxChainIndex(chainKey),
      fromTokenAddress: fromToken.address,
      toTokenAddress: toToken.address,
      amount: amountSmallest,
      slippage,
      userWalletAddress: walletAddr,
      credentials,
    });

    // Get approve tx if needed (ERC-20 from-token, EVM only — Solana doesn't need approval)
    let approveTx;
    if (!solana && needsApproval && fromToken.address.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase()) {
      try {
        approveTx = await getSwapApproval({
          chainId: chainKeyToOkxChainIndex(chainKey),
          tokenContractAddress: fromToken.address,
          approveAmount: amountSmallest,
          credentials,
        });
      } catch {
        // Approval may not be needed if allowance is sufficient
      }
    }

    // Decrypt private key, sign and broadcast
    if (solana) {
      if (!wallet.encrypted_solana_key) {
        throw new AppError('ERR_INVALID_PARAMS', 'This wallet does not support Solana. Create a new wallet to use Solana.');
      }
      pkBuf = decryptSecretAsBuffer(wallet.encrypted_solana_key, password);
    } else {
      pkBuf = decryptSecretAsBuffer(wallet.encrypted_private_key, password);
    }

    const result = await executeSwap({
      chainKey,
      privateKey: pkBuf,
      swapTx: routerResult.tx,
      approveTx,
    });

    // Finalize operation
    finalizeProviderOperation(txId, {
      status: result.status,
      idempotency_key: opts.idempotencyKey,
    });

    // Update tx_hash
    db.prepare('UPDATE operations SET tx_hash=?, updated_at=? WHERE tx_id=?')
      .run(result.txHash, new Date().toISOString(), txId);

    logAudit({
      wallet_id: walletId,
      action: 'swap.exec',
      request: { from: opts.from, to: opts.to, amount: opts.amount, chain: chainKey },
      decision: 'sent',
      result: { tx_hash: result.txHash, status: result.status },
      chain_name: chain.name,
      chain_id: chain.chainId,
    });

    return {
      tx_id: txId,
      tx_hash: result.txHash,
      status: result.status,
      from_token: routerResult.fromToken.tokenSymbol,
      to_token: routerResult.toToken.tokenSymbol,
      from_amount: routerResult.fromTokenAmount,
      to_amount: routerResult.toTokenAmount,
      chain: chain.name,
      explorer_url: `${chain.explorerTxUrl}${result.txHash}`,
    };
  } catch (err) {
    // Mark as failed
    try {
      db.prepare('UPDATE operations SET status=?, updated_at=? WHERE tx_id=?')
        .run('failed', new Date().toISOString(), txId);
    } catch { /* best effort */ }
    throw err;
  } finally {
    pkBuf?.fill(0);
  }
}
