import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db.js';
import { redactSecrets } from '../util/redact.js';

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

const MAX_AUDIT_JSON = 65536; // 64KB cap — prevents DoS from deeply nested payloads
function capJson(json: string): string {
  return json.length > MAX_AUDIT_JSON ? json.slice(0, MAX_AUDIT_JSON) + '...[truncated]' : json;
}

export function logAudit(input: {
  wallet_id?: string;
  action: string;
  request: unknown;
  decision: string;
  result?: unknown;
  error_code?: string;
}): void {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  const requestJson = capJson(redactSecrets(JSON.stringify(input.request ?? {})));
  const resultJson = input.result ? capJson(redactSecrets(JSON.stringify(input.result))) : null;

  // S5/C1: Wrap SELECT prev_hash + INSERT in a transaction to prevent race conditions
  db.transaction(() => {
    const last = db.prepare('SELECT entry_hash FROM audit_logs ORDER BY rowid DESC LIMIT 1').get() as { entry_hash: string | null } | undefined;
    const prevHash = last?.entry_hash ?? '0'.repeat(64);

    const entryHash = sha256(`${prevHash}${id}${input.action}${requestJson}${input.decision}${now}`);

    db.prepare(
      `INSERT INTO audit_logs(id,wallet_id,action,request_json,decision,result_json,error_code,prev_hash,entry_hash,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      input.wallet_id ?? null,
      input.action,
      requestJson,
      input.decision,
      resultJson,
      input.error_code ?? null,
      prevHash,
      entryHash,
      now
    );
  })();
}

export type AuditLogRow = {
  id: string;
  wallet_id: string | null;
  action: string;
  request_json: string;
  decision: string;
  result_json: string | null;
  error_code: string | null;
  prev_hash: string | null;
  entry_hash: string | null;
  created_at: string;
};

export function listAuditLogs(input: {
  wallet_id: string;
  action?: string;
  limit: number;
}): AuditLogRow[] {
  const db = getDb();
  if (input.action) {
    return db
      .prepare(
        `SELECT id,wallet_id,action,request_json,decision,result_json,error_code,prev_hash,entry_hash,created_at
         FROM audit_logs WHERE wallet_id=? AND action=? ORDER BY created_at DESC LIMIT ?`
      )
      .all(input.wallet_id, input.action, input.limit) as AuditLogRow[];
  }
  return db
    .prepare(
      `SELECT id,wallet_id,action,request_json,decision,result_json,error_code,prev_hash,entry_hash,created_at
       FROM audit_logs WHERE wallet_id=? ORDER BY created_at DESC LIMIT ?`
    )
    .all(input.wallet_id, input.limit) as AuditLogRow[];
}
