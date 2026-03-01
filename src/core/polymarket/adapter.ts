export type SearchMarketsInput = {
  query: string;
  limit: number;
};

export type BuyInput = {
  market: string;
  outcome: 'yes' | 'no';
  size: number;
  price: number;
  privateKey: string;
};

export type SellInput = {
  positionId: string;
  size: number;
  privateKey: string;
};

export type PositionsInput = {
  walletAddress: string;
};

export type OrdersInput = {
  privateKey: string;
};

export type CancelOrderInput = {
  orderId: string;
  privateKey: string;
};

export type ApproveCheckInput = {
  privateKey: string;
};

export type ApproveSetInput = {
  privateKey: string;
};

export type UpdateBalanceInput = {
  privateKey: string;
};

export type CtfSplitInput = {
  condition: string;
  amount: number;
  privateKey: string;
};

export type CtfMergeInput = {
  condition: string;
  amount: number;
  privateKey: string;
};

export type CtfRedeemInput = {
  condition: string;
  privateKey: string;
};

export type BridgeDepositInput = {
  walletAddress: string;
};

export type AdapterResult<T = unknown> = {
  provider_order_id?: string;
  provider_status?: string;
  raw?: unknown;
  data: T;
};

export interface PolymarketAdapter {
  searchMarkets(input: SearchMarketsInput): Promise<AdapterResult>;
  buy(input: BuyInput): Promise<AdapterResult>;
  sell(input: SellInput): Promise<AdapterResult>;
  positions(input: PositionsInput): Promise<AdapterResult>;
  orders(input: OrdersInput): Promise<AdapterResult>;
  cancelOrder(input: CancelOrderInput): Promise<AdapterResult>;
  approveCheck(input: ApproveCheckInput): Promise<AdapterResult>;
  approveSet(input: ApproveSetInput): Promise<AdapterResult>;
  updateBalance(input: UpdateBalanceInput): Promise<AdapterResult>;
  ctfSplit(input: CtfSplitInput): Promise<AdapterResult>;
  ctfMerge(input: CtfMergeInput): Promise<AdapterResult>;
  ctfRedeem(input: CtfRedeemInput): Promise<AdapterResult>;
  bridgeDeposit(input: BridgeDepositInput): Promise<AdapterResult>;
}
