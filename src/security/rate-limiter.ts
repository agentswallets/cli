import { getDb } from '../core/db.js';
import { getSetting } from '../core/settings.js';
import { AppError } from '../core/errors.js';

/** Default rate limits. Configurable via settings. */
const DEFAULT_PER_MINUTE = 5;
const DEFAULT_PER_HOUR = 30;
const DEFAULT_GLOBAL_PER_MINUTE = 15;
const DEFAULT_GLOBAL_PER_HOUR = 100;

function getLimit(key: string, defaultVal: number): number {
  const raw = getSetting(`security.rate_limit.${key}`);
  if (raw) {
    const val = Number(raw);
    if (!isNaN(val) && val > 0) return val;
  }
  return defaultVal;
}

function countOps(walletId: string, sinceIso: string): number {
  const db = getDb();
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM operations WHERE wallet_id=? AND created_at>=?'
  ).get(walletId, sinceIso) as { cnt: number };
  return row.cnt;
}

function countAllOps(sinceIso: string): number {
  const db = getDb();
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM operations WHERE created_at>=?'
  ).get(sinceIso) as { cnt: number };
  return row.cnt;
}

/**
 * Check rate limits for a wallet. Throws ERR_RATE_LIMITED if exceeded.
 * Uses the existing operations table with idx_ops_wallet_date index.
 */
export function checkRateLimit(walletId: string): void {
  const perMinute = getLimit('per_minute', DEFAULT_PER_MINUTE);
  const perHour = getLimit('per_hour', DEFAULT_PER_HOUR);

  const now = Date.now();
  const oneMinAgo = new Date(now - 60_000).toISOString();
  const oneHourAgo = new Date(now - 3_600_000).toISOString();

  const lastMinute = countOps(walletId, oneMinAgo);
  if (lastMinute >= perMinute) {
    throw new AppError('ERR_RATE_LIMITED',
      `Rate limit exceeded: ${lastMinute} transactions in the last minute (limit: ${perMinute}/min).`,
      { window: '1min', count: lastMinute, limit: perMinute }
    );
  }

  const lastHour = countOps(walletId, oneHourAgo);
  if (lastHour >= perHour) {
    throw new AppError('ERR_RATE_LIMITED',
      `Rate limit exceeded: ${lastHour} transactions in the last hour (limit: ${perHour}/hour).`,
      { window: '1hour', count: lastHour, limit: perHour }
    );
  }

  const globalPerMinute = getLimit('global_per_minute', DEFAULT_GLOBAL_PER_MINUTE);
  const globalPerHour = getLimit('global_per_hour', DEFAULT_GLOBAL_PER_HOUR);

  const globalLastMinute = countAllOps(oneMinAgo);
  if (globalLastMinute >= globalPerMinute) {
    throw new AppError('ERR_RATE_LIMITED',
      `Global rate limit exceeded: ${globalLastMinute} transactions in the last minute (limit: ${globalPerMinute}/min).`,
      { window: '1min_global', count: globalLastMinute, limit: globalPerMinute }
    );
  }

  const globalLastHour = countAllOps(oneHourAgo);
  if (globalLastHour >= globalPerHour) {
    throw new AppError('ERR_RATE_LIMITED',
      `Global rate limit exceeded: ${globalLastHour} transactions in the last hour (limit: ${globalPerHour}/hour).`,
      { window: '1hour_global', count: globalLastHour, limit: globalPerHour }
    );
  }
}
