import { getDb } from '../core/db.js';

export type BlacklistEntry = {
  address: string;
  chain: string | null;
  reason: string | null;
  added_at: string;
};

export function addToBlacklist(address: string, chain?: string, reason?: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO security_blacklist(address, chain, reason, added_at)
     VALUES(?, ?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET chain=excluded.chain, reason=excluded.reason, added_at=excluded.added_at`
  ).run(address.toLowerCase(), chain ?? null, reason ?? null, now);
}

export function removeFromBlacklist(address: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM security_blacklist WHERE address=?').run(address.toLowerCase());
  return result.changes > 0;
}

export function listBlacklist(): BlacklistEntry[] {
  const db = getDb();
  return db.prepare('SELECT address, chain, reason, added_at FROM security_blacklist ORDER BY added_at DESC').all() as BlacklistEntry[];
}

export function isBlacklisted(address: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM security_blacklist WHERE address=?').get(address.toLowerCase());
  return row !== undefined;
}
