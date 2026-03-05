import { okxRequest } from './client.js';
import type { OkxCredentials, BalanceResult } from './types.js';

/**
 * Get aggregated token balances across chains via OKX API.
 */
export async function getOkxBalances(input: {
  address: string;
  chainIds?: string[];
  credentials: OkxCredentials;
}): Promise<BalanceResult[]> {
  const params: Record<string, string | undefined> = {
    address: input.address,
    chainIds: input.chainIds?.join(','),
  };

  const data = await okxRequest<BalanceResult[]>({
    method: 'GET',
    path: '/api/v5/dex/balance/token-balances-by-address',
    params,
    credentials: input.credentials,
  });

  return data ?? [];
}
