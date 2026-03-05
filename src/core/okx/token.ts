import { okxRequest } from './client.js';
import type { OkxCredentials, TokenSearchResult, TokenInfoResult, TokenTrendingResult, TokenHolderResult } from './types.js';

/**
 * Search tokens by keyword.
 */
export async function searchTokens(input: {
  chainId: string;
  keyword: string;
  credentials: OkxCredentials;
}): Promise<TokenSearchResult[]> {
  const data = await okxRequest<TokenSearchResult[]>({
    method: 'GET',
    path: '/api/v5/dex/token/search',
    params: {
      chainId: input.chainId,
      keyword: input.keyword,
    },
    credentials: input.credentials,
  });

  return data ?? [];
}

/**
 * Get token details by contract address.
 */
export async function getTokenInfo(input: {
  chainId: string;
  tokenContractAddress: string;
  credentials: OkxCredentials;
}): Promise<TokenInfoResult | null> {
  const data = await okxRequest<TokenInfoResult[]>({
    method: 'GET',
    path: '/api/v5/dex/token/token-detail',
    params: {
      chainId: input.chainId,
      tokenContractAddress: input.tokenContractAddress,
    },
    credentials: input.credentials,
  });

  return data?.[0] ?? null;
}

/**
 * Get trending tokens on a chain.
 */
export async function getTrendingTokens(input: {
  chainId: string;
  credentials: OkxCredentials;
}): Promise<TokenTrendingResult[]> {
  const data = await okxRequest<TokenTrendingResult[]>({
    method: 'GET',
    path: '/api/v5/dex/token/trending',
    params: {
      chainId: input.chainId,
    },
    credentials: input.credentials,
  });

  return data ?? [];
}

/**
 * Get top token holders by contract address.
 */
export async function getTokenHolders(input: {
  chainId: string;
  tokenContractAddress: string;
  credentials: OkxCredentials;
}): Promise<TokenHolderResult[]> {
  const data = await okxRequest<TokenHolderResult[]>({
    method: 'GET',
    path: '/api/v5/dex/token/token-holders',
    params: {
      chainId: input.chainId,
      tokenContractAddress: input.tokenContractAddress,
    },
    credentials: input.credentials,
  });

  return data ?? [];
}
