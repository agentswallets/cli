import { assertInitialized } from '../core/db.js';
import { isSessionValid } from '../core/session.js';
import { AppError } from '../core/errors.js';
import { listAuditLogs, type AuditLogRow } from '../core/audit-service.js';
import { getWalletById } from '../core/wallet-store.js';

export function auditListCommand(
  walletId: string,
  opts: { action?: string; limit: number }
): { name: string; address: string; logs: AuditLogRow[]; hint?: string } {
  assertInitialized();
  if (!isSessionValid()) throw new AppError('ERR_NEED_UNLOCK', 'This command requires an unlocked session. Run `aw unlock`.');
  const wallet = getWalletById(walletId);
  const logs = listAuditLogs({
    wallet_id: walletId,
    action: opts.action,
    limit: opts.limit
  });
  return logs.length === 0
    ? { name: wallet.name, address: wallet.address, logs, hint: 'No audit logs found for this wallet.' }
    : { name: wallet.name, address: wallet.address, logs };
}
