import { Wallet } from 'ethers';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import type { ChainKey } from '../chains.js';
import { isSolanaChain } from '../chains.js';
import { getProvider, verifyChainId } from '../rpc.js';
import { getEvmAdapter } from '../evm-adapter.js';
import { getSolanaConnection } from '../solana-provider.js';
import { AppError } from '../errors.js';
import type { SwapQuoteTx, SwapApproveTx } from './types.js';

export type SignAndBroadcastResult = {
  txHash: string;
  status: string;
};

/**
 * Sign and broadcast an EVM raw transaction (used for both swap and bridge).
 * Uses our existing RPC provider infrastructure.
 */
export async function signAndBroadcastTx(input: {
  chainKey: ChainKey;
  privateKey: Buffer;
  tx: { to: string; value: string; data: string; gasLimit?: string };
}): Promise<SignAndBroadcastResult> {
  await verifyChainId(input.chainKey);
  const provider = getProvider(input.chainKey);
  const signer = new Wallet(input.privateKey.toString('utf8'), provider);

  try {
    const txResponse = await signer.sendTransaction({
      to: input.tx.to,
      value: BigInt(input.tx.value || '0'),
      data: input.tx.data,
      gasLimit: input.tx.gasLimit ? BigInt(input.tx.gasLimit) : undefined,
    });

    return { txHash: txResponse.hash, status: 'broadcasted' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/insufficient funds/i.test(msg)) {
      throw new AppError('ERR_INSUFFICIENT_FUNDS', msg);
    }
    throw new AppError('ERR_SWAP_FAILED', `Transaction broadcast failed: ${msg}`);
  }
}

/**
 * Sign and broadcast a Solana transaction returned by OKX.
 * OKX returns a base64-encoded serialized VersionedTransaction.
 */
export async function signAndBroadcastSolanaTx(input: {
  privateKey: Buffer;
  txData: string;
}): Promise<SignAndBroadcastResult> {
  const connection = getSolanaConnection();
  const keypair = Keypair.fromSecretKey(Buffer.from(input.privateKey.toString('utf8'), 'hex'));

  try {
    // Deserialize the versioned transaction from OKX
    const txBuffer = Buffer.from(input.txData, 'base64');
    const transaction = VersionedTransaction.deserialize(txBuffer);

    // Sign with our keypair
    transaction.sign([keypair]);

    // Send raw transaction
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    // Wait for confirmation
    const latestBlockhash = await connection.getLatestBlockhash();
    const confirmation = await connection.confirmTransaction(
      { signature, ...latestBlockhash },
      'confirmed'
    );

    const status = confirmation.value.err ? 'failed' : 'confirmed';
    return { txHash: signature, status };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/insufficient/i.test(msg)) {
      throw new AppError('ERR_INSUFFICIENT_FUNDS', msg);
    }
    throw new AppError('ERR_SWAP_FAILED', `Solana transaction failed: ${msg}`);
  }
}

/**
 * Execute a swap: EVM or Solana path.
 */
export async function executeSwap(input: {
  chainKey: ChainKey;
  privateKey: Buffer;
  swapTx: SwapQuoteTx;
  approveTx?: SwapApproveTx;
}): Promise<SignAndBroadcastResult> {
  // ── Solana path ──
  if (isSolanaChain(input.chainKey)) {
    // OKX returns the full serialized transaction in tx.data for Solana
    return signAndBroadcastSolanaTx({
      privateKey: input.privateKey,
      txData: input.swapTx.data,
    });
  }

  // ── EVM path ──
  const adapter = getEvmAdapter(input.chainKey);

  // Step 1: ERC-20 approve if needed
  if (input.approveTx) {
    const approveResult = await signAndBroadcastTx({
      chainKey: input.chainKey,
      privateKey: input.privateKey,
      tx: {
        to: input.approveTx.to,
        value: input.approveTx.value || '0',
        data: input.approveTx.data,
        gasLimit: input.approveTx.gasLimit,
      },
    });

    // Wait for approve tx confirmation
    const confirmation = await adapter.waitForConfirmation(approveResult.txHash, 60_000);
    if (confirmation.status === 'failed') {
      throw new AppError('ERR_SWAP_FAILED', `ERC-20 approval transaction failed: ${approveResult.txHash}`);
    }
  }

  // Step 2: Execute swap
  const swapResult = await signAndBroadcastTx({
    chainKey: input.chainKey,
    privateKey: input.privateKey,
    tx: {
      to: input.swapTx.to,
      value: input.swapTx.value || '0',
      data: input.swapTx.data,
      gasLimit: input.swapTx.gasLimit,
    },
  });

  // Wait for swap tx confirmation
  const confirmation = await adapter.waitForConfirmation(swapResult.txHash, 60_000);

  return { txHash: swapResult.txHash, status: confirmation.status };
}

/**
 * Execute a bridge: EVM or Solana source chain.
 */
export async function executeBridge(input: {
  chainKey: ChainKey;
  privateKey: Buffer;
  tx: { to: string; value: string; data: string; gasLimit?: string };
}): Promise<SignAndBroadcastResult> {
  // ── Solana source ──
  if (isSolanaChain(input.chainKey)) {
    return signAndBroadcastSolanaTx({
      privateKey: input.privateKey,
      txData: input.tx.data,
    });
  }

  // ── EVM source ──
  const broadcastResult = await signAndBroadcastTx({
    chainKey: input.chainKey,
    privateKey: input.privateKey,
    tx: input.tx,
  });

  const adapter = getEvmAdapter(input.chainKey);
  const confirmation = await adapter.waitForConfirmation(broadcastResult.txHash, 60_000);

  return { txHash: broadcastResult.txHash, status: confirmation.status };
}
