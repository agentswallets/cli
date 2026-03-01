import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getHomeDir, getSessionPath, getSessionTokenPath } from './config.js';
import { SESSION_TTL_MINUTES } from './constants.js';
import { constantTimeEqual, randomToken, sha256 } from './crypto.js';

type SessionRecord = {
  token_hash: string;
  expires_at: string;
};

/** H-4: Restrict token file path to AGENTSWALLETS_HOME only (not arbitrary paths under $HOME). */
function isPathAllowed(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const awHome = getHomeDir();
  return resolved.startsWith(awHome + path.sep);
}

function readTokenFromEnvOrFile(): string | null {
  const direct = process.env.AW_UNLOCK_TOKEN?.trim();
  if (direct) return direct;

  const file = process.env.AW_UNLOCK_TOKEN_FILE?.trim();
  if (file) {
    if (!isPathAllowed(file)) return null;
    // M-2: Eliminate TOCTOU — directly try readFileSync instead of existsSync + readFileSync
    try {
      const fromFile = fs.readFileSync(file, 'utf8').trim();
      if (fromFile) return fromFile;
    } catch { /* file doesn't exist or unreadable */ }
  }

  // Fall back to default session-token file
  try {
    const tokenFile = getSessionTokenPath();
    const fromDefault = fs.readFileSync(tokenFile, 'utf8').trim();
    if (fromDefault) return fromDefault;
  } catch { /* no session token file */ }

  return null;
}

export function createSession(ttlMinutes = SESSION_TTL_MINUTES): { token: string; token_file: string; expires_at: string } {
  const token = randomToken();
  const expires = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  const payload: SessionRecord = { token_hash: sha256(token), expires_at: expires };
  fs.writeFileSync(getSessionPath(), JSON.stringify(payload, null, 2), { mode: 0o600 });
  const tokenFile = getSessionTokenPath();
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  return { token, token_file: tokenFile, expires_at: expires };
}

/**
 * Validates the current session.
 * H-3: Always require token match — session file alone is not sufficient.
 */
export function isSessionValid(): boolean {
  // M-2: Eliminate TOCTOU — directly try read
  let raw: string;
  try {
    raw = fs.readFileSync(getSessionPath(), 'utf8');
  } catch {
    return false;
  }
  let session: SessionRecord;
  try { session = JSON.parse(raw) as SessionRecord; } catch { return false; }
  if (new Date(session.expires_at).getTime() <= Date.now()) return false;

  const token = readTokenFromEnvOrFile();
  if (!token) return false;
  return constantTimeEqual(sha256(token), session.token_hash);
}

/** Sliding window: extend session expiry on successful command (no-op if session invalid). */
export function touchSession(): void {
  let raw: string;
  try {
    raw = fs.readFileSync(getSessionPath(), 'utf8');
  } catch {
    return; // no session file — no-op
  }
  let session: SessionRecord;
  try { session = JSON.parse(raw) as SessionRecord; } catch { return; }
  if (new Date(session.expires_at).getTime() <= Date.now()) return; // already expired

  const token = readTokenFromEnvOrFile();
  if (!token) return;
  if (!constantTimeEqual(sha256(token), session.token_hash)) return;

  // Session valid — extend expiry
  session.expires_at = new Date(Date.now() + SESSION_TTL_MINUTES * 60_000).toISOString();
  fs.writeFileSync(getSessionPath(), JSON.stringify(session, null, 2), { mode: 0o600 });
}

/** L-3/L-4: Clear session + session-token files. */
export function clearSession(): void {
  for (const filePath of [getSessionPath(), getSessionTokenPath()]) {
    try { fs.unlinkSync(filePath); } catch { /* already removed */ }
  }
}
