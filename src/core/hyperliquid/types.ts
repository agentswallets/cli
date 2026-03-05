/** A single open position on Hyperliquid. */
export type HlPosition = {
  coin: string;
  /** Signed size: positive = long, negative = short */
  szi: string;
  leverage: number;
  entryPx: string;
  unrealizedPnl: string;
  liquidationPx: string | null;
  marginUsed: string;
};

/** A single open order. */
export type HlOrder = {
  oid: number;
  coin: string;
  side: 'buy' | 'sell';
  sz: string;
  limitPx: string;
  orderType: string;
  timestamp: number;
};

/** Account-level summary. */
export type HlAccountSummary = {
  accountValue: string;
  totalMarginUsed: string;
  withdrawable: string;
  positions: HlPosition[];
};

/** Per-asset metadata from meta(). */
export type HlAssetMeta = {
  name: string;
  szDecimals: number;
  maxLeverage: number;
};

/** Funding rate snapshot. */
export type HlFundingRate = {
  coin: string;
  fundingRate: string;
  premium: string;
  time: number;
};
