import { assertInitialized, getDb } from '../core/db.js';
import { isSessionValid } from '../core/session.js';
import { AppError } from '../core/errors.js';
import { resolveChainKey, getChain, isSolanaChain } from '../core/chains.js';
import { getWalletById, getPolicy, resolveWallet } from '../core/wallet-store.js';
import { evaluatePolicy } from '../core/policy-engine.js';
import { logAudit } from '../core/audit-service.js';
import { decryptSecretAsBuffer } from '../core/crypto.js';
import { getMasterPassword } from '../util/agent-input.js';
import { reserveIdempotencyKey, getOperationByIdempotencyKey } from '../util/idempotency.js';
import { createPendingProviderOperation, finalizeProviderOperation, dailySpendStats, walletBalance } from '../core/tx-service.js';
import { requirePositiveNumber } from '../util/validate.js';
import { getOkxCredentials } from '../core/okx/client.js';
import { chainKeyToOkxChainIndex, resolveTokenAddress } from '../core/okx/token-resolver.js';
import { getBridgeTx, getSupportedBridgeChains, getBridgeQuote, getBridgeStatus } from '../core/okx/bridge.js';
import { executeBridge } from '../core/okx/swap-executor.js';
import { securityCheck } from '../security/guard.js';

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
 * aw bridge chains — list supported cross-chain paths.
 */
export async function bridgeChainsCommand(): Promise<{ chains: Array<{ chainId: string; chainName: string }> }> {
  assertInitialized();

  const credentials = getOkxCredentials();
  const chains = await getSupportedBridgeChains(credentials);

  return { chains };
}

/**
 * aw bridge quote — get a cross-chain bridge quote.
 */
export async function bridgeQuoteCommand(opts: {
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  amount: string;
  wallet: string;
}): Promise<{
  from_token: string;
  to_token: string;
  from_amount: string;
  to_amount: string;
  estimated_gas: string;
  from_chain: string;
  to_chain: string;
}> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'Session required. Run `aw unlock`.');

  const fromChainKey = resolveChainKey(opts.fromChain);
  const toChainKey = resolveChainKey(opts.toChain);
  const fromChain = getChain(fromChainKey);
  const toChain = getChain(toChainKey);
  const solana = isSolanaChain(fromChainKey);

  const wallet = resolveWallet(opts.wallet);
  const walletAddr = getWalletAddress(wallet, solana);
  const fromToken = resolveTokenAddress(fromChainKey, opts.fromToken);
  const toToken = resolveTokenAddress(toChainKey, opts.toToken);
  const amount = requirePositiveNumber(opts.amount, 'amount');
  const amountSmallest = toSmallestUnit(amount, fromToken.decimals);

  const credentials = getOkxCredentials();

  const { routerResult } = await getBridgeQuote({
    fromChainId: chainKeyToOkxChainIndex(fromChainKey),
    toChainId: chainKeyToOkxChainIndex(toChainKey),
    fromTokenAddress: fromToken.address,
    toTokenAddress: toToken.address,
    amount: amountSmallest,
    slippage: '0.5',
    userWalletAddress: walletAddr,
    credentials,
  });

  return {
    from_token: routerResult.fromToken.tokenSymbol,
    to_token: routerResult.toToken.tokenSymbol,
    from_amount: routerResult.fromTokenAmount,
    to_amount: routerResult.toTokenAmount,
    estimated_gas: routerResult.estimateGasFee,
    from_chain: fromChain.name,
    to_chain: toChain.name,
  };
}

/**
 * aw bridge exec — execute a cross-chain bridge.
 */
export async function bridgeExecCommand(
  walletId: string,
  opts: {
    fromChain: string;
    toChain: string;
    fromToken: string;
    toToken: string;
    amount: string;
    idempotencyKey: string;
    force?: boolean;
    yes?: boolean;
  }
): Promise<{
  tx_id: string;
  tx_hash: string | null;
  status: string;
  from_token: string;
  to_token: string;
  from_amount: string;
  to_amount: string;
  from_chain: string;
  to_chain: string;
  explorer_url?: string;
}> {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'Session required. Run `aw unlock`.');

  const fromChainKey = resolveChainKey(opts.fromChain);
  const toChainKey = resolveChainKey(opts.toChain);
  const fromChain = getChain(fromChainKey);
  const toChain = getChain(toChainKey);
  const solana = isSolanaChain(fromChainKey);

  const wallet = getWalletById(walletId);
  const walletAddr = getWalletAddress(wallet, solana);
  const fromToken = resolveTokenAddress(fromChainKey, opts.fromToken);
  const toToken = resolveTokenAddress(toChainKey, opts.toToken);
  const amount = requirePositiveNumber(opts.amount, 'amount');
  const amountSmallest = toSmallestUnit(amount, fromToken.decimals);

  // Security check — pre-fetch balance for ALL_BALANCE_SWAP red line
  let tokenBalance = 0;
  try {
    const bal = await walletBalance(walletId, fromChainKey);
    tokenBalance = Number(bal.balances[fromToken.symbol] ?? '0');
  } catch { /* best effort — skip balance check if RPC fails */ }

  await securityCheck(
    { walletId, action: 'bridge.exec', amount, token: fromToken.symbol, chain: fromChain.name },
    { yes: opts.yes, force: opts.force, getBalance: () => tokenBalance }
  );

  // Atomic: idempotency + policy + pending INSERT
  const db = getDb();
  const policy = getPolicy(walletId);
  const atomicResult = db.transaction(() => {
    reserveIdempotencyKey(opts.idempotencyKey, 'bridge');
    const existing = getOperationByIdempotencyKey(opts.idempotencyKey);
    if (existing) {
      return { type: 'replay' as const, op: existing };
    }
    const stats = dailySpendStats(walletId, fromToken.symbol);
    const decision = evaluatePolicy({ policy, token: fromToken.symbol, amount, stats });
    if (decision.status !== 'allowed') {
      logAudit({
        wallet_id: walletId,
        action: 'bridge.exec',
        request: { fromChain: opts.fromChain, toChain: opts.toChain, amount: opts.amount },
        decision: 'denied',
        error_code: decision.code,
        chain_name: fromChain.name,
        chain_id: fromChain.chainId,
      });
      throw new AppError(decision.code, decision.message, decision.details);
    }
    const txId = createPendingProviderOperation({
      wallet_id: walletId,
      kind: 'bridge',
      token: fromToken.symbol,
      amount: opts.amount,
      idempotency_key: opts.idempotencyKey,
      meta: { from_chain: fromChain.name, to_chain: toChain.name, to_token: toToken.symbol },
      chain_name: fromChain.name,
      chain_id: fromChain.chainId,
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
      from_chain: fromChain.name,
      to_chain: toChain.name,
      explorer_url: op.tx_hash ? `${fromChain.explorerTxUrl}${op.tx_hash}` : undefined,
    };
  }

  const txId = atomicResult.txId;
  let pkBuf: Buffer | null = null;
  try {
    const password = await getMasterPassword('Master password for signing: ');
    const credentials = getOkxCredentials();

    // Get bridge tx calldata
    const { routerResult } = await getBridgeTx({
      fromChainId: chainKeyToOkxChainIndex(fromChainKey),
      toChainId: chainKeyToOkxChainIndex(toChainKey),
      fromTokenAddress: fromToken.address,
      toTokenAddress: toToken.address,
      amount: amountSmallest,
      slippage: '0.5',
      userWalletAddress: walletAddr,
      credentials,
    });
    if (solana) {
      if (!wallet.encrypted_solana_key) {
        throw new AppError('ERR_INVALID_PARAMS', 'This wallet does not support Solana. Create a new wallet to use Solana.');
      }
      pkBuf = decryptSecretAsBuffer(wallet.encrypted_solana_key, password);
    } else {
      pkBuf = decryptSecretAsBuffer(wallet.encrypted_private_key, password);
    }

    const result = await executeBridge({
      chainKey: fromChainKey,
      privateKey: pkBuf,
      tx: {
        to: routerResult.tx.to,
        value: routerResult.tx.value || '0',
        data: routerResult.tx.data,
        gasLimit: routerResult.tx.gasLimit,
      },
    });

    finalizeProviderOperation(txId, {
      status: result.status,
      idempotency_key: opts.idempotencyKey,
    });

    db.prepare('UPDATE operations SET tx_hash=?, updated_at=? WHERE tx_id=?')
      .run(result.txHash, new Date().toISOString(), txId);

    logAudit({
      wallet_id: walletId,
      action: 'bridge.exec',
      request: { fromChain: opts.fromChain, toChain: opts.toChain, amount: opts.amount },
      decision: 'sent',
      result: { tx_hash: result.txHash, status: result.status },
      chain_name: fromChain.name,
      chain_id: fromChain.chainId,
    });

    return {
      tx_id: txId,
      tx_hash: result.txHash,
      status: result.status,
      from_token: routerResult.fromToken.tokenSymbol,
      to_token: routerResult.toToken.tokenSymbol,
      from_amount: routerResult.fromTokenAmount,
      to_amount: routerResult.toTokenAmount,
      from_chain: fromChain.name,
      to_chain: toChain.name,
      explorer_url: `${fromChain.explorerTxUrl}${result.txHash}`,
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
 * aw bridge status <tx_hash> — check bridge transaction status.
 */
export async function bridgeStatusCommand(txHash: string, opts: { chain?: string }): Promise<{
  status: string;
  from_tx_hash: string;
  to_tx_hash: string;
}> {
  assertInitialized();

  const chainKey = resolveChainKey(opts.chain);
  const credentials = getOkxCredentials();

  const result = await getBridgeStatus({
    hash: txHash,
    chainId: chainKeyToOkxChainIndex(chainKey),
    credentials,
  });

  return {
    status: result.status,
    from_tx_hash: result.fromTxHash,
    to_tx_hash: result.toTxHash,
  };
}
