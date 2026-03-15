// Security module shared types

export type SecurityAction =
  | 'tx.send'
  | 'swap.exec'
  | 'bridge.exec'
  | 'perp.open'
  | 'perp.close'
  | 'perp.cancel'
  | 'poly.buy'
  | 'poly.sell'
  | 'poly.cancel'
  | 'poly.approve_set'
  | 'poly.update_balance'
  | 'poly.ctf_split'
  | 'poly.ctf_merge'
  | 'poly.ctf_redeem'
  | 'wallet.drain'
  | 'wallet.export_key'
  | 'policy.set';

export type RedLineRule =
  | 'DRAIN_ALL'
  | 'EXPORT_KEY'
  | 'LARGE_TRANSFER'
  | 'NEW_ADDRESS'
  | 'ALL_BALANCE_SWAP'
  | 'POLICY_CHANGE'
  | 'BLACKLISTED_ADDRESS';

export type YellowLineRule =
  | 'HIGH_SLIPPAGE'
  | 'UNKNOWN_TOKEN'
  | 'HIGH_LEVERAGE'
  | 'RAPID_TRANSACTIONS'
  | 'NIGHT_TRADING'
  | 'LARGE_CROSS_CHAIN'
  | 'LARGE_PERP_POSITION';

export type SecurityVerdictAction =
  | 'ALLOW'
  | 'BLOCK'
  | 'REQUIRE_CONFIRMATION'
  | 'WARN_AND_LOG'
  | 'LOG_ONLY';

export type SecurityVerdict = {
  action: SecurityVerdictAction;
  rule?: RedLineRule | YellowLineRule;
  message?: string;
};

export type SecurityContext = {
  walletId: string;
  action: SecurityAction;
  amount?: number;
  token?: string;
  toAddress?: string;
  chain?: string;
  slippage?: number;
  leverage?: number;
};

/** Callback to check if an address has been used before by this wallet. */
export type AddressHistoryLookup = (walletId: string, address: string) => boolean;

/** Callback to get token balance for a wallet. */
export type BalanceLookup = (walletId: string, token: string, chain: string) => number;

/** Callback to count recent transactions. */
export type RecentTxCountLookup = (walletId: string, minutesAgo: number) => number;

/** Callback to check if a token is known on a chain. */
export type KnownTokenLookup = (token: string, chain: string) => boolean;
