export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL UNIQUE,
  encrypted_private_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policies (
  wallet_id TEXT PRIMARY KEY,
  daily_limit REAL,
  per_tx_limit REAL,
  max_tx_per_day INTEGER,
  allowed_tokens_json TEXT NOT NULL,
  allowed_addresses_json TEXT NOT NULL,
  require_approval_above REAL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(wallet_id) REFERENCES wallets(id)
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(wallet_id) REFERENCES wallets(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  wallet_id TEXT,
  action TEXT NOT NULL,
  request_json TEXT NOT NULL,
  decision TEXT NOT NULL,
  result_json TEXT,
  error_code TEXT,
  prev_hash TEXT,
  entry_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  ref_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operations (
  tx_id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  token TEXT,
  amount TEXT,
  to_address TEXT,
  tx_hash TEXT,
  provider_order_id TEXT,
  idempotency_key TEXT UNIQUE,
  meta_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(wallet_id) REFERENCES wallets(id)
);

CREATE INDEX IF NOT EXISTS idx_ops_wallet_token_date ON operations(wallet_id, token, created_at);
CREATE INDEX IF NOT EXISTS idx_ops_wallet_date ON operations(wallet_id, created_at);
`;
