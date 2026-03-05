import { okxRequest } from './client.js';
import type { OkxCredentials, HistoryTx } from './types.js';

/**
 * Get on-chain transaction history via OKX API.
 */
export async function getOkxHistory(input: {
  address: string;
  chainId?: string;
  limit?: string;
  credentials: OkxCredentials;
}): Promise<HistoryTx[]> {
  const params: Record<string, string | undefined> = {
    address: input.address,
    chainId: input.chainId,
    limit: input.limit,
  };

  const data = await okxRequest<HistoryTx[]>({
    method: 'GET',
    path: '/api/v5/dex/post-transaction/transactions-by-address',
    params,
    credentials: input.credentials,
  });

  return data ?? [];
}
