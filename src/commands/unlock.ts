import { assertInitialized, getDb } from '../core/db.js';
import { verifyMasterPassword } from '../core/crypto.js';
import { AppError } from '../core/errors.js';
import { getSetting } from '../core/settings.js';
import { createSession } from '../core/session.js';
import { getMasterPassword } from '../util/agent-input.js';
import { logAudit } from '../core/audit-service.js';

const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

function getFailedAttempts(): { count: number; lastAttempt: number } {
  const db = getDb();
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key='login_fail_state'").get() as { value: string } | undefined;
    if (!row) return { count: 0, lastAttempt: 0 };
    const state = JSON.parse(row.value) as { count: number; lastAttempt: number };
    // Reset if outside lockout window
    if (Date.now() - state.lastAttempt > LOCKOUT_WINDOW_MS) return { count: 0, lastAttempt: 0 };
    return state;
  } catch {
    return { count: 0, lastAttempt: 0 };
  }
}

function recordFailedAttempt(): void {
  const db = getDb();
  // Atomic read+increment to prevent concurrent brute-force bypassing the counter
  db.transaction(() => {
    const prev = getFailedAttempts();
    const state = { count: prev.count + 1, lastAttempt: Date.now() };
    db.prepare("INSERT INTO settings(key,value) VALUES('login_fail_state',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(state));
  }).immediate();
}

function clearFailedAttempts(): void {
  const db = getDb();
  db.prepare("DELETE FROM settings WHERE key='login_fail_state'").run();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function unlockCommand(): Promise<{ status: string; token_file: string; expires_at: string }> {
  assertInitialized();

  // S6: Rate limit failed login attempts with exponential backoff
  const attempts = getFailedAttempts();
  if (attempts.count >= MAX_ATTEMPTS) {
    const backoffMs = Math.min(1000 * 2 ** (attempts.count - MAX_ATTEMPTS), 30_000);
    await sleep(backoffMs);
  }

  const salt = getSetting('master_password_salt');
  const expected = getSetting('master_password_verifier');
  const kdfRaw = getSetting('master_password_kdf_params');
  if (!salt || !expected) throw new AppError('ERR_NOT_INITIALIZED', 'Missing auth settings, run init again');

  const password = await getMasterPassword('Master password: ');
  if (!verifyMasterPassword(password, salt, expected, kdfRaw)) {
    recordFailedAttempt();
    logAudit({ action: 'unlock', request: {}, decision: 'denied', error_code: 'ERR_NEED_UNLOCK' });
    throw new AppError('ERR_NEED_UNLOCK', 'Invalid password');
  }
  clearFailedAttempts();
  const session = createSession();
  logAudit({ action: 'unlock', request: {}, decision: 'ok' });
  return { status: 'unlocked', token_file: session.token_file, expires_at: session.expires_at };
}
