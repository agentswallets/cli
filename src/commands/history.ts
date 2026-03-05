import { assertInitialized } from '../core/db.js';
import { resolveChainKey, getChain, isSolanaChain } from '../core/chains.js';
import { resolveWallet } from '../core/wallet-store.js';
import { getOkxCredentials } from '../core/okx/client.js';
import { chainKeyToOkxChainIndex } from '../core/okx/token-resolver.js';
import { getOkxHistory } from '../core/okx/history.js';
import { AppError } from '../core/errors.js';
import type { HistoryTx } from '../core/okx/types.js';

/**
 * aw history list — get on-chain transaction history via OKX API.
 */
export async function historyListCommand(opts: {
  wallet: string;
  chain?: string;
  limit?: string;
}): Promise<{ wallet: string; address: string; chain: string; transactions: HistoryTx[] }> {
  assertInitialized();

  const wallet = resolveWallet(opts.wallet);
  const chainKey = resolveChainKey(opts.chain);
  const chain = getChain(chainKey);
  const solana = isSolanaChain(chainKey);

  let address: string;
  if (solana) {
    if (!wallet.solana_address) {
      throw new AppError('ERR_INVALID_PARAMS', 'This wallet does not support Solana. Create a new wallet to use Solana.');
    }
    address = wallet.solana_address;
  } else {
    address = wallet.address;
  }

  const credentials = getOkxCredentials();

  const transactions = await getOkxHistory({
    address,
    chainId: chainKeyToOkxChainIndex(chainKey),
    limit: opts.limit || '50',
    credentials,
  });

  return {
    wallet: wallet.name,
    address,
    chain: chain.name,
    transactions,
  };
}
