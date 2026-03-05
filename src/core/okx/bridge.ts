import { okxRequest } from './client.js';
import { OKX_REFERRER_ADDRESS, BRIDGE_FEE_PERCENT } from './constants.js';
import type { OkxCredentials, BridgeQuoteRoute, BridgeStatusResponse } from './types.js';
import { AppError } from '../errors.js';

export type BridgeQuoteInput = {
  fromChainId: string;
  toChainId: string;
  fromTokenAddress: string;
  toTokenAddress: string;
  amount: string;
  slippage: string;
  userWalletAddress: string;
  credentials: OkxCredentials;
};

export type BridgeQuoteResult = {
  routerResult: BridgeQuoteRoute;
};

/**
 * Get a cross-chain bridge quote from OKX.
 */
export async function getBridgeQuote(input: BridgeQuoteInput): Promise<BridgeQuoteResult> {
  const params: Record<string, string> = {
    fromChainId: input.fromChainId,
    toChainId: input.toChainId,
    fromTokenAddress: input.fromTokenAddress,
    toTokenAddress: input.toTokenAddress,
    amount: input.amount,
    slippage: input.slippage,
    userWalletAddress: input.userWalletAddress,
    feePercent: BRIDGE_FEE_PERCENT,
    referrerAddress: OKX_REFERRER_ADDRESS,
  };

  const data = await okxRequest<BridgeQuoteRoute[]>({
    method: 'GET',
    path: '/api/v5/dex/cross-chain/quote',
    params,
    credentials: input.credentials,
  });

  if (!data || data.length === 0) {
    throw new AppError('ERR_OKX_QUOTE_FAILED', 'No bridge route found for this token pair.');
  }

  return { routerResult: data[0] };
}

/**
 * Build a cross-chain bridge transaction (returns tx calldata).
 */
export async function getBridgeTx(input: BridgeQuoteInput): Promise<BridgeQuoteResult> {
  const params: Record<string, string> = {
    fromChainId: input.fromChainId,
    toChainId: input.toChainId,
    fromTokenAddress: input.fromTokenAddress,
    toTokenAddress: input.toTokenAddress,
    amount: input.amount,
    slippage: input.slippage,
    userWalletAddress: input.userWalletAddress,
    feePercent: BRIDGE_FEE_PERCENT,
    referrerAddress: OKX_REFERRER_ADDRESS,
  };

  const data = await okxRequest<BridgeQuoteRoute[]>({
    method: 'GET',
    path: '/api/v5/dex/cross-chain/build-tx',
    params,
    credentials: input.credentials,
  });

  if (!data || data.length === 0) {
    throw new AppError('ERR_OKX_QUOTE_FAILED', 'Failed to build bridge transaction.');
  }

  return { routerResult: data[0] };
}

/**
 * Get supported chains for cross-chain bridging.
 */
export async function getSupportedBridgeChains(credentials: OkxCredentials): Promise<Array<{ chainId: string; chainName: string }>> {
  const data = await okxRequest<Array<{ chainId: string; chainName: string }>>({
    method: 'GET',
    path: '/api/v5/dex/cross-chain/supported/chain',
    credentials,
  });

  return data ?? [];
}

/**
 * Check bridge transaction status.
 */
export async function getBridgeStatus(input: {
  hash: string;
  chainId: string;
  credentials: OkxCredentials;
}): Promise<BridgeStatusResponse> {
  const params: Record<string, string> = {
    hash: input.hash,
    chainId: input.chainId,
  };

  const data = await okxRequest<BridgeStatusResponse[]>({
    method: 'GET',
    path: '/api/v5/dex/cross-chain/status',
    params,
    credentials: input.credentials,
  });

  if (!data || data.length === 0) {
    throw new AppError('ERR_OKX_API_FAILED', 'Bridge status not found for this transaction.');
  }

  return data[0];
}
