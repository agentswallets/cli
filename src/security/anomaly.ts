import { getDb } from '../core/db.js';

export type Anomaly = {
  type: string;
  severity: 'low' | 'medium' | 'high';
  detail: string;
};

type OperationRow = {
  tx_id: string;
  wallet_id: string;
  kind: string;
  token: string | null;
  chain_name: string | null;
  amount: string | null;
  to_address: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  tx_hash: string | null;
  idempotency_key: string | null;
};

export function detectAnomalies(walletId: string, days = 7): Anomaly[] {
  const db = getDb();
  const anomalies: Anomaly[] = [];

  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - days);
  const periodStartIso = periodStart.toISOString();

  const ops = db
    .prepare(
      `SELECT tx_id, wallet_id, kind, token, chain_name, amount, to_address,
              status, created_at, updated_at, tx_hash, idempotency_key
       FROM operations
       WHERE wallet_id = ? AND created_at >= ?
       ORDER BY created_at ASC`
    )
    .all(walletId, periodStartIso) as OperationRow[];

  if (ops.length === 0) {
    return [];
  }

  // ------------------------------------------------------------------
  // 1. Volume spike — today's tx count > 3x daily average over the period
  // ------------------------------------------------------------------
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();

  const todayCount = ops.filter(op => op.created_at >= todayStartIso).length;

  // Build a map of date-string → count for all days in the period
  const countsByDay = new Map<string, number>();
  for (const op of ops) {
    const day = op.created_at.slice(0, 10); // "YYYY-MM-DD"
    countsByDay.set(day, (countsByDay.get(day) ?? 0) + 1);
  }

  const totalDaysWithActivity = countsByDay.size;
  const totalOps = ops.length;

  // Average excludes today to avoid comparing today against itself
  const todayDateStr = todayStart.toISOString().slice(0, 10);
  const daysExcludingToday = totalDaysWithActivity - (countsByDay.has(todayDateStr) ? 1 : 0);
  const opsExcludingToday = totalOps - todayCount;

  if (daysExcludingToday > 0) {
    const dailyAvg = opsExcludingToday / daysExcludingToday;
    if (dailyAvg > 0 && todayCount > dailyAvg * 3) {
      anomalies.push({
        type: 'volume_spike',
        severity: 'high',
        detail: `Today's transaction count (${todayCount}) exceeds 3x the daily average (${dailyAvg.toFixed(1)}) over the last ${days} days.`,
      });
    }
  }

  // ------------------------------------------------------------------
  // 2. New address burst — >5 unique new to_addresses in last 24h
  // ------------------------------------------------------------------
  const last24hStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const olderOps = ops.filter(op => op.created_at < last24hStart);
  const knownAddresses = new Set(olderOps.map(op => op.to_address).filter(Boolean) as string[]);

  const recentOps = ops.filter(op => op.created_at >= last24hStart);
  const newAddresses = new Set<string>();
  for (const op of recentOps) {
    if (op.to_address && !knownAddresses.has(op.to_address)) {
      newAddresses.add(op.to_address);
    }
  }

  if (newAddresses.size > 5) {
    anomalies.push({
      type: 'new_address_burst',
      severity: 'medium',
      detail: `${newAddresses.size} unique new destination addresses appeared in the last 24 hours (threshold: 5).`,
    });
  }

  // ------------------------------------------------------------------
  // 3. Consecutive failures — >3 consecutive failed operations
  // ------------------------------------------------------------------
  let consecutiveFails = 0;
  let maxConsecutiveFails = 0;
  for (const op of ops) {
    if (op.status === 'failed') {
      consecutiveFails++;
      if (consecutiveFails > maxConsecutiveFails) {
        maxConsecutiveFails = consecutiveFails;
      }
    } else {
      consecutiveFails = 0;
    }
  }

  if (maxConsecutiveFails > 3) {
    anomalies.push({
      type: 'consecutive_failures',
      severity: 'high',
      detail: `${maxConsecutiveFails} consecutive failed operations detected within the last ${days} days.`,
    });
  }

  // ------------------------------------------------------------------
  // 4. Night large transactions — 00:00–06:00 local time with amount > 500
  // ------------------------------------------------------------------
  const nightLargeTxs = ops.filter(op => {
    if (!op.amount) return false;
    const amt = parseFloat(op.amount);
    if (isNaN(amt) || amt <= 500) return false;
    const localHour = new Date(op.created_at).getHours();
    return localHour >= 0 && localHour < 6;
  });

  if (nightLargeTxs.length > 0) {
    anomalies.push({
      type: 'night_large_transactions',
      severity: 'medium',
      detail: `${nightLargeTxs.length} large transaction(s) (amount > 500) occurred between 00:00 and 06:00 local time within the last ${days} days.`,
    });
  }

  // ------------------------------------------------------------------
  // 5. Drain pattern — any operation with kind='drain' in the period
  // ------------------------------------------------------------------
  const drainOps = ops.filter(op => op.kind === 'drain');
  if (drainOps.length > 0) {
    anomalies.push({
      type: 'drain_pattern',
      severity: 'high',
      detail: `${drainOps.length} drain operation(s) detected within the last ${days} days.`,
    });
  }

  return anomalies;
}
