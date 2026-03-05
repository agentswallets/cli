import { okxRequest } from './client.js';
import { OKX_REFERRER_ADDRESS, SWAP_FEE_PERCENT } from './constants.js';
import type { OkxCredentials, SwapQuoteRoute, SwapApproveTx, SwapApproveParams } from './types.js';
import { AppError } from '../errors.js';

export type SwapQuoteInput = {
  chainId: string;
  fromTokenAddress: string;
  toTokenAddress: string;
  amount: string;
  slippage: string;
  userWalletAddress: string;
  credentials: OkxCredentials;
};

export type SwapQuoteResult = {
  routerResult: SwapQuoteRoute;
  needsApproval: boolean;
};

/**
 * Get a swap quote from OKX DEX aggregator.
 * Returns tx calldata ready for local signing.
 */
export async function getSwapQuote(input: SwapQuoteInput): Promise<SwapQuoteResult> {
  const params: Record<string, string> = {
    chainId: input.chainId,
    fromTokenAddress: input.fromTokenAddress,
    toTokenAddress: input.toTokenAddress,
    amount: input.amount,
    slippage: input.slippage,
    userWalletAddress: input.userWalletAddress,
    feePercent: SWAP_FEE_PERCENT,
    referrerAddress: OKX_REFERRER_ADDRESS,
  };

  const data = await okxRequest<SwapQuoteRoute[]>({
    method: 'GET',
    path: '/api/v5/dex/aggregator/swap',
    params,
    credentials: input.credentials,
  });

  if (!data || data.length === 0) {
    throw new AppError('ERR_OKX_QUOTE_FAILED', 'No swap route found for this token pair.');
  }

  const route = data[0];

  // Check if approval is needed (non-native from-token with allowance check)
  const needsApproval = input.fromTokenAddress.toLowerCase() !== '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

  return { routerResult: route, needsApproval };
}

/**
 * Get ERC-20 approval transaction data from OKX.
 */
export async function getSwapApproval(input: {
  chainId: string;
  tokenContractAddress: string;
  approveAmount: string;
  credentials: OkxCredentials;
}): Promise<SwapApproveTx> {
  const params: Record<string, string> = {
    chainId: input.chainId,
    tokenContractAddress: input.tokenContractAddress,
    approveAmount: input.approveAmount,
  };

  const data = await okxRequest<SwapApproveTx[]>({
    method: 'GET',
    path: '/api/v5/dex/aggregator/approve-transaction',
    params,
    credentials: input.credentials,
  });

  if (!data || data.length === 0) {
    throw new AppError('ERR_OKX_API_FAILED', 'Failed to get approval transaction data.');
  }

  return data[0];
}

/**
 * Get supported chains for DEX swap.
 */
export async function getSupportedSwapChains(credentials: OkxCredentials): Promise<Array<{ chainId: string; chainName: string }>> {
  const data = await okxRequest<Array<{ chainId: string; chainName: string }>>({
    method: 'GET',
    path: '/api/v5/dex/aggregator/supported/chain',
    credentials,
  });

  return data ?? [];
}
