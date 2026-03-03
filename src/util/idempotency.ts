import { getDb } from '../core/db.js';
import { AppError } from '../core/errors.js';

/** Pending operations older than this are considered stale (process crashed before completing). */
const STALE_PENDING_MS = 30 * 60_000; // 30 minutes

export type IdempotentOperation = {
  tx_id: string; tx_hash: string | null; provider_order_id: string | null;
  status: string | null; token: string | null; amount: string | null;
  to_address: string | null; meta_json: string | null; created_at: string;
};

export function getOperationByIdempotencyKey(key: string): IdempotentOperation | null {
  const db = getDb();
  const row = db
    .prepare('SELECT tx_id,tx_hash,provider_order_id,status,token,amount,to_address,meta_json,created_at FROM operations WHERE idempotency_key=?')
    .get(key) as IdempotentOperation | undefined;
  return row ?? null;
}

/** Returns true if the operation is pending and older than the stale threshold. */
export function isStalePending(op: IdempotentOperation): boolean {
  if (op.status !== 'pending') return false;
  const ageMs = Date.now() - new Date(op.created_at).getTime();
  return ageMs > STALE_PENDING_MS;
}

const IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9_.\-]{1,256}$/;

export function reserveIdempotencyKey(key: string, scope: string): void {
  if (!key || !key.trim()) {
    throw new AppError('ERR_INVALID_PARAMS', 'idempotency-key must not be empty');
  }
  if (!IDEMPOTENCY_KEY_RE.test(key)) {
    throw new AppError('ERR_INVALID_PARAMS', 'idempotency-key must be 1-256 chars of [a-zA-Z0-9_.-]');
  }
  const db = getDb();
  try {
    db.prepare('INSERT INTO idempotency_keys(key,scope,status,created_at) VALUES(?,?,?,?)').run(
      key,
      scope,
      'reserved',
      new Date().toISOString()
    );
  } catch (err) {
    // UNIQUE constraint violation → key already exists
    if (err instanceof Error && /UNIQUE constraint failed|constraint/i.test(err.message)) {
      const exists = db.prepare('SELECT scope, status, created_at FROM idempotency_keys WHERE key=?').get(key) as { scope: string; status: string; created_at: string } | undefined;
      if (exists && exists.scope !== scope) {
        throw new AppError('ERR_INVALID_PARAMS', `idempotency-key already used in different scope: ${exists.scope}`);
      }
      // Reclaim stale reserved keys older than 48 hours
      if (exists && exists.status === 'reserved') {
        const ageMs = Date.now() - new Date(exists.created_at).getTime();
        if (ageMs > 48 * 3600_000) {
          db.prepare('DELETE FROM idempotency_keys WHERE key=?').run(key);
          db.prepare('INSERT INTO idempotency_keys(key,scope,status,created_at) VALUES(?,?,?,?)').run(
            key, scope, 'reserved', new Date().toISOString()
          );
        }
      }
      return;
    }
    throw err;
  }
}

export function bindIdempotencyKeyRef(key: string, refId: string, status = 'completed'): void {
  const db = getDb();
  db.prepare('UPDATE idempotency_keys SET ref_id=?, status=? WHERE key=?').run(refId, status, key);
}
