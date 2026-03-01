import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearSession, createSession, isSessionValid, touchSession } from '../src/core/session.js';

const originalEnv = { ...process.env };

function resetEnv(): void {
  process.env = { ...originalEnv };
}

describe('session edge cases', () => {
  afterEach(() => {
    clearSession();
    resetEnv();
  });

  it('expired session is rejected', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sess-exp-'));
    process.env.AGENTSWALLETS_HOME = home;
    // Create session with 0 minutes TTL (immediately expired)
    createSession(0);
    expect(isSessionValid()).toBe(false);
  });

  it('corrupt session file is rejected', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sess-corrupt-'));
    process.env.AGENTSWALLETS_HOME = home;
    fs.writeFileSync(path.join(home, 'session.json'), 'NOT JSON', { mode: 0o600 });
    expect(isSessionValid()).toBe(false);
  });

  it('missing session file returns false', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sess-miss-'));
    process.env.AGENTSWALLETS_HOME = home;
    expect(isSessionValid()).toBe(false);
  });

  it('clearSession removes session files', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sess-clear-'));
    process.env.AGENTSWALLETS_HOME = home;
    createSession(15);
    expect(fs.existsSync(path.join(home, 'session.json'))).toBe(true);
    expect(fs.existsSync(path.join(home, 'session-token'))).toBe(true);
    clearSession();
    expect(fs.existsSync(path.join(home, 'session.json'))).toBe(false);
    expect(fs.existsSync(path.join(home, 'session-token'))).toBe(false);
  });

  it('touchSession extends session expiry', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sess-touch-'));
    process.env.AGENTSWALLETS_HOME = home;
    createSession(1); // 1-minute session
    expect(isSessionValid()).toBe(true);

    // Read original expiry
    const before = JSON.parse(fs.readFileSync(path.join(home, 'session.json'), 'utf8'));
    const expiryBefore = new Date(before.expires_at).getTime();

    // Touch should extend
    touchSession();

    const after = JSON.parse(fs.readFileSync(path.join(home, 'session.json'), 'utf8'));
    const expiryAfter = new Date(after.expires_at).getTime();

    // New expiry should be later than original (extended by SESSION_TTL_MINUTES)
    expect(expiryAfter).toBeGreaterThan(expiryBefore);
    expect(isSessionValid()).toBe(true);
  });

  it('touchSession is no-op when no session exists', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sess-touch-noop-'));
    process.env.AGENTSWALLETS_HOME = home;
    // Should not throw
    expect(() => touchSession()).not.toThrow();
  });

  it('rejects AW_UNLOCK_TOKEN_FILE outside home dirs', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sess-path-'));
    process.env.AGENTSWALLETS_HOME = home;
    const { token } = createSession(15);

    // Write token to a file outside both AGENTSWALLETS_HOME and user HOME
    const evilDir = fs.mkdtempSync(path.join('/tmp', 'aw-evil-'));
    const evilFile = path.join(evilDir, 'token.txt');
    fs.writeFileSync(evilFile, token);

    // Temporarily set HOME to something different to test path restriction
    const origHome = process.env.HOME;
    process.env.HOME = home;
    process.env.AW_UNLOCK_TOKEN_FILE = evilFile;
    delete process.env.AW_UNLOCK_TOKEN;

    // The session-token default file still exists and should be tried
    // after the evil file is rejected. If default file has matching token, it passes.
    // Test that the evil path itself is rejected by removing the default token file.
    try { fs.unlinkSync(path.join(home, 'session-token')); } catch { /* */ }
    expect(isSessionValid()).toBe(false);

    process.env.HOME = origHome;
    fs.rmSync(evilDir, { recursive: true });
  });
});
