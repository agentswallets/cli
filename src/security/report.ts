import crypto from 'node:crypto';
import { getDb } from '../core/db.js';
import { isSessionValid } from '../core/session.js';

export type SecurityReport = {
  generated_at: string;
  checks: Array<{
    name: string;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
  }>;
};

type Check = SecurityReport['checks'][number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// ---------------------------------------------------------------------------
// Individual check implementations
// ---------------------------------------------------------------------------

function checkDbIntegrity(): Check {
  try {
    const db = getDb();
    const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const messages = rows.map(r => r.integrity_check);
    if (messages.length === 1 && messages[0] === 'ok') {
      return { name: 'db_integrity', status: 'pass', detail: 'PRAGMA integrity_check: ok' };
    }
    return {
      name: 'db_integrity',
      status: 'fail',
      detail: `PRAGMA integrity_check returned ${messages.length} issue(s): ${messages.slice(0, 3).join('; ')}`,
    };
  } catch (err) {
    return { name: 'db_integrity', status: 'fail', detail: `integrity_check error: ${String(err)}` };
  }
}

function checkKeyIntegrity(): Check {
  try {
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) AS n FROM wallets').get() as { n: number }).n;
    if (total === 0) {
      return { name: 'key_integrity', status: 'pass', detail: 'No wallets found' };
    }
    const bad = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM wallets WHERE encrypted_private_key IS NULL OR encrypted_private_key = ''"
        )
        .get() as { n: number }
    ).n;
    if (bad === 0) {
      return {
        name: 'key_integrity',
        status: 'pass',
        detail: `All ${total} wallet(s) have non-empty encrypted_private_key`,
      };
    }
    return {
      name: 'key_integrity',
      status: 'fail',
      detail: `${bad} of ${total} wallet(s) have empty or null encrypted_private_key`,
    };
  } catch (err) {
    return { name: 'key_integrity', status: 'fail', detail: `key_integrity error: ${String(err)}` };
  }
}

function checkPolicyStatus(): Check {
  try {
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) AS n FROM wallets').get() as { n: number }).n;
    if (total === 0) {
      return { name: 'policy_status', status: 'pass', detail: 'No wallets found' };
    }
    const withPolicy = (db.prepare('SELECT COUNT(*) AS n FROM policies').get() as { n: number }).n;
    const without = total - withPolicy;
    if (without === 0) {
      return {
        name: 'policy_status',
        status: 'pass',
        detail: `All ${total} wallet(s) have policies configured`,
      };
    }
    return {
      name: 'policy_status',
      status: 'warn',
      detail: `${withPolicy} of ${total} wallet(s) have policies; ${without} wallet(s) have no policy`,
    };
  } catch (err) {
    return { name: 'policy_status', status: 'fail', detail: `policy_status error: ${String(err)}` };
  }
}

function checkSessionStatus(): Check {
  try {
    const valid = isSessionValid();
    if (valid) {
      return { name: 'session_status', status: 'pass', detail: 'Active session found and valid' };
    }
    return { name: 'session_status', status: 'warn', detail: 'No active session (vault is locked)' };
  } catch (err) {
    return { name: 'session_status', status: 'fail', detail: `session_status error: ${String(err)}` };
  }
}

function checkRedLineEvents(since: string): Check {
  try {
    const db = getDb();
    const count = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_logs WHERE action LIKE 'security.red_line%' AND created_at >= ?"
        )
        .get(since) as { n: number }
    ).n;
    if (count === 0) {
      return { name: 'red_line_events', status: 'pass', detail: 'No red-line events in period' };
    }
    return {
      name: 'red_line_events',
      status: 'fail',
      detail: `${count} red-line event(s) triggered in period`,
    };
  } catch (err) {
    return { name: 'red_line_events', status: 'fail', detail: `red_line_events error: ${String(err)}` };
  }
}

function checkYellowLineEvents(since: string): Check {
  try {
    const db = getDb();
    const count = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_logs WHERE action LIKE 'security.yellow_line%' AND created_at >= ?"
        )
        .get(since) as { n: number }
    ).n;
    if (count === 0) {
      return { name: 'yellow_line_events', status: 'pass', detail: 'No yellow-line events in period' };
    }
    return {
      name: 'yellow_line_events',
      status: 'warn',
      detail: `${count} yellow-line event(s) triggered in period`,
    };
  } catch (err) {
    return {
      name: 'yellow_line_events',
      status: 'fail',
      detail: `yellow_line_events error: ${String(err)}`,
    };
  }
}

function checkTransactionStats(opts: { walletId?: string; since: string }): Check {
  try {
    const db = getDb();

    let totalRow: { n: number };
    let failedRow: { n: number };
    let chainRows: Array<{ chain_name: string | null; n: number }>;

    if (opts.walletId) {
      totalRow = db
        .prepare('SELECT COUNT(*) AS n FROM operations WHERE wallet_id=? AND created_at >= ?')
        .get(opts.walletId, opts.since) as { n: number };
      failedRow = db
        .prepare(
          "SELECT COUNT(*) AS n FROM operations WHERE wallet_id=? AND created_at >= ? AND status='failed'"
        )
        .get(opts.walletId, opts.since) as { n: number };
      chainRows = db
        .prepare(
          'SELECT chain_name, COUNT(*) AS n FROM operations WHERE wallet_id=? AND created_at >= ? GROUP BY chain_name'
        )
        .all(opts.walletId, opts.since) as Array<{ chain_name: string | null; n: number }>;
    } else {
      totalRow = db
        .prepare('SELECT COUNT(*) AS n FROM operations WHERE created_at >= ?')
        .get(opts.since) as { n: number };
      failedRow = db
        .prepare("SELECT COUNT(*) AS n FROM operations WHERE created_at >= ? AND status='failed'")
        .get(opts.since) as { n: number };
      chainRows = db
        .prepare(
          'SELECT chain_name, COUNT(*) AS n FROM operations WHERE created_at >= ? GROUP BY chain_name'
        )
        .all(opts.since) as Array<{ chain_name: string | null; n: number }>;
    }

    const total = totalRow.n;
    const failed = failedRow.n;
    const byChain = chainRows
      .map(r => `${r.chain_name ?? 'unknown'}:${r.n}`)
      .join(', ');

    const status: 'pass' | 'warn' =
      total > 0 && failed / total > 0.1 ? 'warn' : 'pass';

    const detail =
      total === 0
        ? 'No transactions in period'
        : `${total} total, ${failed} failed${byChain ? `; by chain: ${byChain}` : ''}`;

    return { name: 'transaction_stats', status, detail };
  } catch (err) {
    return { name: 'transaction_stats', status: 'fail', detail: `transaction_stats error: ${String(err)}` };
  }
}

function checkAddressAnalysis(opts: { walletId?: string; since: string }): Check {
  try {
    const db = getDb();
    let row: { n: number };

    if (opts.walletId) {
      row = db
        .prepare(
          'SELECT COUNT(DISTINCT to_address) AS n FROM operations WHERE wallet_id=? AND created_at >= ? AND to_address IS NOT NULL'
        )
        .get(opts.walletId, opts.since) as { n: number };
    } else {
      row = db
        .prepare(
          'SELECT COUNT(DISTINCT to_address) AS n FROM operations WHERE created_at >= ? AND to_address IS NOT NULL'
        )
        .get(opts.since) as { n: number };
    }

    return {
      name: 'address_analysis',
      status: 'pass',
      detail: `${row.n} unique destination address(es) in period`,
    };
  } catch (err) {
    return { name: 'address_analysis', status: 'fail', detail: `address_analysis error: ${String(err)}` };
  }
}

function checkKeyExportRecords(opts: { walletId?: string; since: string }): Check {
  try {
    const db = getDb();
    let row: { n: number };

    if (opts.walletId) {
      row = db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_logs WHERE action='wallet.export_key' AND wallet_id=? AND created_at >= ?"
        )
        .get(opts.walletId, opts.since) as { n: number };
    } else {
      row = db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_logs WHERE action='wallet.export_key' AND created_at >= ?"
        )
        .get(opts.since) as { n: number };
    }

    const count = row.n;
    if (count === 0) {
      return { name: 'key_export_records', status: 'pass', detail: 'No key export events in period' };
    }
    return {
      name: 'key_export_records',
      status: 'warn',
      detail: `${count} key export event(s) in period`,
    };
  } catch (err) {
    return { name: 'key_export_records', status: 'fail', detail: `key_export_records error: ${String(err)}` };
  }
}

function checkPasswordErrors(since: string): Check {
  try {
    const db = getDb();
    const row = db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_logs WHERE action LIKE '%password%' AND decision != 'ok' AND created_at >= ?"
      )
      .get(since) as { n: number };
    const count = row.n;
    if (count === 0) {
      return { name: 'password_errors', status: 'pass', detail: 'No password error events in period' };
    }
    return {
      name: 'password_errors',
      status: count >= 5 ? 'fail' : 'warn',
      detail: `${count} failed password attempt(s) in period`,
    };
  } catch (err) {
    return { name: 'password_errors', status: 'fail', detail: `password_errors error: ${String(err)}` };
  }
}

function checkAuditChainIntegrity(opts: { walletId?: string; since: string }): Check {
  try {
    const db = getDb();

    type AuditRow = {
      id: string;
      action: string;
      request_json: string;
      decision: string;
      created_at: string;
      prev_hash: string | null;
      entry_hash: string | null;
    };

    let rows: AuditRow[];
    if (opts.walletId) {
      rows = db
        .prepare(
          `SELECT id, action, request_json, decision, created_at, prev_hash, entry_hash
           FROM audit_logs WHERE wallet_id=? AND created_at >= ? ORDER BY rowid ASC`
        )
        .all(opts.walletId, opts.since) as AuditRow[];
    } else {
      rows = db
        .prepare(
          `SELECT id, action, request_json, decision, created_at, prev_hash, entry_hash
           FROM audit_logs WHERE created_at >= ? ORDER BY rowid ASC`
        )
        .all(opts.since) as AuditRow[];
    }

    if (rows.length === 0) {
      return { name: 'audit_chain_integrity', status: 'pass', detail: 'No audit log entries in period' };
    }

    // Entries that pre-date hash-chain migration have null entry_hash — skip them gracefully.
    const hashable = rows.filter(r => r.entry_hash !== null);
    if (hashable.length === 0) {
      return {
        name: 'audit_chain_integrity',
        status: 'pass',
        detail: `${rows.length} entry(ies) in period; all pre-date hash-chain migration`,
      };
    }

    let broken = 0;
    for (let i = 0; i < hashable.length; i++) {
      const row = hashable[i];

      // Recompute expected entry_hash
      const prevHash = row.prev_hash ?? '0'.repeat(64);
      const expected = sha256(
        `${prevHash}${row.id}${row.action}${row.request_json}${row.decision}${row.created_at}`
      );

      if (expected !== row.entry_hash) {
        broken++;
        continue;
      }

      // Verify linkage: this row's prev_hash must equal the previous hashable row's entry_hash
      if (i > 0) {
        const prev = hashable[i - 1];
        if (prev.entry_hash !== null && row.prev_hash !== prev.entry_hash) {
          broken++;
        }
      }
    }

    if (broken === 0) {
      return {
        name: 'audit_chain_integrity',
        status: 'pass',
        detail: `Hash chain verified for ${hashable.length} entry(ies)`,
      };
    }
    return {
      name: 'audit_chain_integrity',
      status: 'fail',
      detail: `${broken} broken link(s) detected in audit hash chain (${hashable.length} entries checked)`,
    };
  } catch (err) {
    return {
      name: 'audit_chain_integrity',
      status: 'fail',
      detail: `audit_chain_integrity error: ${String(err)}`,
    };
  }
}

function checkRateLimitEvents(since: string): Check {
  try {
    const db = getDb();
    const row = db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_logs WHERE action='security.rate_limit_hit' AND created_at >= ?"
      )
      .get(since) as { n: number };
    const count = row.n;
    if (count === 0) {
      return { name: 'rate_limit_events', status: 'pass', detail: 'No rate-limit events in period' };
    }
    return {
      name: 'rate_limit_events',
      status: count >= 10 ? 'fail' : 'warn',
      detail: `${count} rate-limit hit(s) in period`,
    };
  } catch (err) {
    return { name: 'rate_limit_events', status: 'fail', detail: `rate_limit_events error: ${String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateSecurityReport(opts?: { walletId?: string; days?: number }): SecurityReport {
  const days = opts?.days ?? 7;
  const walletId = opts?.walletId;
  const since = sinceIso(days);

  const checks: Check[] = [
    checkDbIntegrity(),
    checkKeyIntegrity(),
    checkPolicyStatus(),
    checkSessionStatus(),
    checkRedLineEvents(since),
    checkYellowLineEvents(since),
    checkTransactionStats({ walletId, since }),
    checkAddressAnalysis({ walletId, since }),
    checkKeyExportRecords({ walletId, since }),
    checkPasswordErrors(since),
    checkAuditChainIntegrity({ walletId, since }),
    checkRateLimitEvents(since),
  ];

  return {
    generated_at: new Date().toISOString(),
    checks,
  };
}
