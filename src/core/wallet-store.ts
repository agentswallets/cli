import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db.js';
import { DEFAULT_POLICY } from './constants.js';
import { AppError } from './errors.js';
import type { PolicyConfig, PolicyRow, WalletRow } from './types.js';

function nowIso(): string {
  return new Date().toISOString();
}

export function insertWallet(name: string, address: string, encryptedPrivateKey: string): WalletRow {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM wallets WHERE name=?').get(name);
  if (existing) {
    throw new AppError('ERR_INVALID_PARAMS', `wallet name already exists: ${name}`);
  }
  const row: WalletRow = {
    id: uuidv4(),
    name,
    address,
    encrypted_private_key: encryptedPrivateKey,
    created_at: nowIso()
  };
  // Atomic: insert wallet + default policy in one transaction
  db.transaction(() => {
    db.prepare(
      'INSERT INTO wallets(id,name,address,encrypted_private_key,created_at) VALUES(@id,@name,@address,@encrypted_private_key,@created_at)'
    ).run(row);
    db.prepare(
      `INSERT INTO policies(wallet_id,daily_limit,per_tx_limit,max_tx_per_day,allowed_tokens_json,allowed_addresses_json,require_approval_above,updated_at)
       VALUES(?,?,?,?,?,?,?,?)`
    ).run(
      row.id,
      DEFAULT_POLICY.daily_limit,
      DEFAULT_POLICY.per_tx_limit,
      DEFAULT_POLICY.max_tx_per_day,
      JSON.stringify(DEFAULT_POLICY.allowed_tokens),
      JSON.stringify(DEFAULT_POLICY.allowed_addresses),
      DEFAULT_POLICY.require_approval_above,
      row.created_at
    );
  })();
  return row;
}

export function getWalletById(walletId: string): WalletRow {
  const db = getDb();
  const row = db.prepare('SELECT * FROM wallets WHERE id=?').get(walletId) as WalletRow | undefined;
  if (!row) throw new AppError('ERR_WALLET_NOT_FOUND', `wallet not found: ${walletId}`);
  return row;
}

export function getWalletByName(name: string): WalletRow {
  const db = getDb();
  const row = db.prepare('SELECT * FROM wallets WHERE name=?').get(name) as WalletRow | undefined;
  if (!row) throw new AppError('ERR_WALLET_NOT_FOUND', `wallet not found: ${name}`);
  return row;
}

export function getWalletByAddress(address: string): WalletRow {
  const db = getDb();
  const row = db.prepare('SELECT * FROM wallets WHERE address=? COLLATE NOCASE').get(address) as WalletRow | undefined;
  if (!row) throw new AppError('ERR_WALLET_NOT_FOUND', `wallet not found: ${address}`);
  return row;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve a wallet by name, address, or UUID. */
export function resolveWallet(identifier: string): WalletRow {
  if (identifier.startsWith('0x')) {
    if (identifier.length !== 42) {
      throw new AppError('ERR_INVALID_PARAMS', 'Invalid wallet address (must be 42 characters starting with 0x)');
    }
    return getWalletByAddress(identifier);
  }
  if (UUID_RE.test(identifier)) {
    return getWalletById(identifier);
  }
  return getWalletByName(identifier);
}

export function listWallets(): Array<Pick<WalletRow, 'name' | 'address' | 'created_at'>> {
  const db = getDb();
  return db
    .prepare('SELECT name,address,created_at FROM wallets ORDER BY created_at DESC')
    .all() as Array<Pick<WalletRow, 'name' | 'address' | 'created_at'>>;
}

/** Internal: returns full wallet rows (including id) for batch operations. */
export function listWalletsInternal(): Array<Pick<WalletRow, 'id' | 'name' | 'address' | 'created_at'>> {
  const db = getDb();
  return db
    .prepare('SELECT id,name,address,created_at FROM wallets ORDER BY created_at DESC')
    .all() as Array<Pick<WalletRow, 'id' | 'name' | 'address' | 'created_at'>>;
}

export function upsertPolicy(walletId: string, policy: PolicyConfig): void {
  const db = getDb();
  const payload = {
    wallet_id: walletId,
    daily_limit: policy.daily_limit,
    per_tx_limit: policy.per_tx_limit,
    max_tx_per_day: policy.max_tx_per_day,
    allowed_tokens_json: JSON.stringify(policy.allowed_tokens),
    allowed_addresses_json: JSON.stringify(policy.allowed_addresses.map((x) => x.toLowerCase())),
    require_approval_above: policy.require_approval_above,
    updated_at: nowIso()
  };

  db.prepare(
    `INSERT INTO policies(wallet_id,daily_limit,per_tx_limit,max_tx_per_day,allowed_tokens_json,allowed_addresses_json,require_approval_above,updated_at)
     VALUES(@wallet_id,@daily_limit,@per_tx_limit,@max_tx_per_day,@allowed_tokens_json,@allowed_addresses_json,@require_approval_above,@updated_at)
     ON CONFLICT(wallet_id) DO UPDATE SET
      daily_limit=excluded.daily_limit,
      per_tx_limit=excluded.per_tx_limit,
      max_tx_per_day=excluded.max_tx_per_day,
      allowed_tokens_json=excluded.allowed_tokens_json,
      allowed_addresses_json=excluded.allowed_addresses_json,
      require_approval_above=excluded.require_approval_above,
      updated_at=excluded.updated_at`
  ).run(payload);
}

export function getPolicy(walletId: string): PolicyConfig {
  const db = getDb();
  const row = db.prepare('SELECT * FROM policies WHERE wallet_id=?').get(walletId) as PolicyRow | undefined;
  if (!row) {
    // Fail-safe: return default restrictive policy, not permissive all-null
    return {
      daily_limit: DEFAULT_POLICY.daily_limit,
      per_tx_limit: DEFAULT_POLICY.per_tx_limit,
      max_tx_per_day: DEFAULT_POLICY.max_tx_per_day,
      allowed_tokens: [...DEFAULT_POLICY.allowed_tokens],
      allowed_addresses: [...DEFAULT_POLICY.allowed_addresses],
      require_approval_above: DEFAULT_POLICY.require_approval_above
    };
  }
  let allowedTokens: string[];
  let allowedAddresses: string[];
  try { allowedTokens = JSON.parse(row.allowed_tokens_json || '[]') as string[]; } catch { allowedTokens = []; }
  try { allowedAddresses = JSON.parse(row.allowed_addresses_json || '[]') as string[]; } catch { allowedAddresses = []; }
  return {
    daily_limit: row.daily_limit,
    per_tx_limit: row.per_tx_limit,
    max_tx_per_day: row.max_tx_per_day,
    allowed_tokens: allowedTokens,
    allowed_addresses: allowedAddresses,
    require_approval_above: row.require_approval_above
  };
}
