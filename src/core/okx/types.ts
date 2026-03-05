// ── OKX API common ──

export type OkxCredentials = {
  apiKey: string;
  secretKey: string;
  passphrase: string;
};

export type OkxApiResponse<T> = {
  code: string;
  msg: string;
  data: T;
};

// ── Swap ──

export type SwapQuoteParams = {
  chainId: string;
  fromTokenAddress: string;
  toTokenAddress: string;
  amount: string;
  slippage: string;
  userWalletAddress: string;
  feePercent?: string;
  referrerAddress?: string;
};

export type SwapQuoteTx = {
  from: string;
  to: string;
  value: string;
  data: string;
  gasLimit: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
};

export type SwapQuoteRoute = {
  fromToken: { tokenContractAddress: string; tokenSymbol: string; decimal: string };
  toToken: { tokenContractAddress: string; tokenSymbol: string; decimal: string };
  fromTokenAmount: string;
  toTokenAmount: string;
  estimateGasFee: string;
  tx: SwapQuoteTx;
};

export type SwapApproveParams = {
  chainId: string;
  tokenContractAddress: string;
  approveAmount: string;
};

export type SwapApproveTx = {
  from: string;
  to: string;
  value: string;
  data: string;
  gasLimit: string;
};

// ── Bridge ──

export type BridgeQuoteParams = {
  fromChainId: string;
  toChainId: string;
  fromTokenAddress: string;
  toTokenAddress: string;
  amount: string;
  slippage: string;
  userWalletAddress: string;
  feePercent?: string;
  referrerAddress?: string;
};

export type BridgeQuoteTx = {
  from: string;
  to: string;
  value: string;
  data: string;
  gasLimit: string;
  gasPrice?: string;
};

export type BridgeQuoteRoute = {
  fromToken: { tokenContractAddress: string; tokenSymbol: string; decimal: string; chainId: string };
  toToken: { tokenContractAddress: string; tokenSymbol: string; decimal: string; chainId: string };
  fromTokenAmount: string;
  toTokenAmount: string;
  estimateGasFee: string;
  tx: BridgeQuoteTx;
};

export type BridgeStatusResponse = {
  status: string;
  fromTxHash: string;
  toTxHash: string;
};

// ── Market ──

export type MarketPriceParams = {
  chainId: string;
  tokenContractAddress: string;
};

export type MarketPrice = {
  price: string;
  time: string;
  volume24h?: string;
  change24h?: string;
};

export type MarketCandleParams = {
  chainId: string;
  tokenContractAddress: string;
  bar: string;
  limit?: string;
  after?: string;
};

export type MarketCandle = {
  time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};

export type MarketTradeParams = {
  chainId: string;
  tokenContractAddress: string;
  limit?: string;
};

export type MarketTrade = {
  txHash: string;
  time: string;
  side: string;
  amount: string;
  price: string;
};

// ── Token ──

export type TokenSearchParams = {
  chainId: string;
  keyword: string;
};

export type TokenSearchResult = {
  tokenContractAddress: string;
  tokenSymbol: string;
  tokenName: string;
  decimal: string;
  chainId: string;
};

export type TokenInfoResult = {
  tokenContractAddress: string;
  tokenSymbol: string;
  tokenName: string;
  decimal: string;
  totalSupply: string;
  holders: string;
  chainId: string;
  logoUrl?: string;
};

export type TokenTrendingResult = {
  tokenContractAddress: string;
  tokenSymbol: string;
  tokenName: string;
  price: string;
  change24h: string;
  volume24h: string;
  chainId: string;
};

export type TokenHolderResult = {
  holderAddress: string;
  amount: string;
  percentage: string;
};

// ── Balance ──

export type BalanceResult = {
  tokenContractAddress: string;
  tokenSymbol: string;
  balance: string;
  balanceUsd: string;
  chainId: string;
};

// ── History ──

export type HistoryTx = {
  txHash: string;
  time: string;
  from: string;
  to: string;
  tokenContractAddress: string;
  tokenSymbol: string;
  amount: string;
  status: string;
  chainId: string;
};
