export type AppErrorCode =
  | 'ERR_NOT_INITIALIZED'
  | 'ERR_NEED_UNLOCK'
  | 'ERR_INVALID_PARAMS'
  | 'ERR_WALLET_NOT_FOUND'
  | 'ERR_MARKET_NOT_FOUND'
  | 'ERR_INVALID_AMOUNT'
  | 'ERR_TOKEN_NOT_ALLOWED'
  | 'ERR_ADDRESS_NOT_ALLOWED'
  | 'ERR_DAILY_LIMIT_EXCEEDED'
  | 'ERR_PER_TX_LIMIT_EXCEEDED'
  | 'ERR_APPROVAL_THRESHOLD_EXCEEDED'
  | 'ERR_TX_COUNT_LIMIT_EXCEEDED'
  | 'ERR_INSUFFICIENT_FUNDS'
  | 'ERR_RPC_UNAVAILABLE'
  | 'ERR_TX_FAILED'
  | 'ERR_POLYMARKET_CLI_NOT_FOUND'
  | 'ERR_POLYMARKET_FAILED'
  | 'ERR_POLYMARKET_TIMEOUT'
  | 'ERR_POLYMARKET_AUTH'
  | 'ERR_AUTH_FAILED'
  | 'ERR_INTERNAL';

export type JsonSuccess<T> = { ok: true; data: T; error: null; meta: { request_id: string } };
export type JsonFailure = {
  ok: false;
  data: null;
  error: { code: string; message: string; details?: unknown; recovery_hint?: string };
  meta: { request_id: string };
};
export type JsonEnvelope<T> = JsonSuccess<T> | JsonFailure;

export type WalletRow = {
  id: string;
  name: string;
  address: string;
  encrypted_private_key: string;
  created_at: string;
};

export type PolicyRow = {
  wallet_id: string;
  daily_limit: number | null;
  per_tx_limit: number | null;
  max_tx_per_day: number | null;
  allowed_tokens_json: string;
  allowed_addresses_json: string;
  require_approval_above: number | null;
  updated_at: string;
};

export type PolicyConfig = {
  daily_limit: number | null;
  per_tx_limit: number | null;
  max_tx_per_day: number | null;
  allowed_tokens: string[];
  allowed_addresses: string[];
  require_approval_above: number | null;
};

export type OperationRow = {
  tx_id: string;
  wallet_id: string;
  kind: string;
  status: string;
  token: string | null;
  amount: string | null;
  to_address: string | null;
  tx_hash: string | null;
  provider_order_id: string | null;
  idempotency_key: string | null;
  meta_json: string | null;
  created_at: string;
  updated_at: string;
};

/** OperationRow without internal wallet_id and meta_json — safe for API output. */
export type PublicOperationRow = Omit<OperationRow, 'wallet_id' | 'meta_json'> & { meta: Record<string, unknown> };

export type PolicyDecision =
  | { status: 'allowed' }
  | { status: 'denied'; code: AppErrorCode; message: string; details?: Record<string, unknown> };
