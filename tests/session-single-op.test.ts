import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearSession, createSession, getSessionMode, isSessionValid, touchSession } from '../src/core/session.js';

const originalEnv = { ...process.env };

function resetEnv(): void {
  process.env = { ...originalEnv };
}

describe('single-op session mode', () => {
  afterEach(() => {
    clearSession();
    resetEnv();
  });

  it('single-op session is cleared after write operation', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-single-write-'));
    process.env.AGENTSWALLETS_HOME = home;

    createSession(15, 'single-op');
    expect(isSessionValid()).toBe(true);
    expect(getSessionMode()).toBe('single-op');

    // Simulate a write operation
    touchSession(true);

    // Session should be cleared
    expect(isSessionValid()).toBe(false);
    expect(fs.existsSync(path.join(home, 'session.json'))).toBe(false);
    expect(fs.existsSync(path.join(home, 'session-token'))).toBe(false);
  });

  it('single-op session survives read operations', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-single-read-'));
    process.env.AGENTSWALLETS_HOME = home;

    createSession(15, 'single-op');
    expect(isSessionValid()).toBe(true);

    // Read original expiry
    const before = JSON.parse(fs.readFileSync(path.join(home, 'session.json'), 'utf8'));
    const expiryBefore = new Date(before.expires_at).getTime();

    // Simulate a read operation
    touchSession(false);

    // Session should still be valid
    expect(isSessionValid()).toBe(true);

    // Expiry should NOT be extended (no sliding window for single-op)
    const after = JSON.parse(fs.readFileSync(path.join(home, 'session.json'), 'utf8'));
    const expiryAfter = new Date(after.expires_at).getTime();
    expect(expiryAfter).toBe(expiryBefore);
  });

  it('standard session behavior is unchanged', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-standard-write-'));
    process.env.AGENTSWALLETS_HOME = home;

    createSession(1, 'standard');
    expect(isSessionValid()).toBe(true);
    expect(getSessionMode()).toBe('standard');

    // Read original expiry
    const before = JSON.parse(fs.readFileSync(path.join(home, 'session.json'), 'utf8'));
    const expiryBefore = new Date(before.expires_at).getTime();

    // Simulate a write operation — standard mode should just extend
    touchSession(true);

    // Session should still be valid and expiry extended
    expect(isSessionValid()).toBe(true);
    const after = JSON.parse(fs.readFileSync(path.join(home, 'session.json'), 'utf8'));
    const expiryAfter = new Date(after.expires_at).getTime();
    expect(expiryAfter).toBeGreaterThan(expiryBefore);
  });

  it('createSession returns mode field', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-single-mode-'));
    process.env.AGENTSWALLETS_HOME = home;

    const singleSession = createSession(15, 'single-op');
    expect(singleSession.mode).toBe('single-op');
    clearSession();

    const standardSession = createSession(15, 'standard');
    expect(standardSession.mode).toBe('standard');
    clearSession();

    // Default is standard
    const defaultSession = createSession(15);
    expect(defaultSession.mode).toBe('standard');
  });

  it('getSessionMode returns standard for legacy sessions without mode field', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-single-legacy-'));
    process.env.AGENTSWALLETS_HOME = home;

    // Write a legacy session record (no mode field)
    createSession(15);
    const raw = JSON.parse(fs.readFileSync(path.join(home, 'session.json'), 'utf8'));
    delete raw.mode;
    fs.writeFileSync(path.join(home, 'session.json'), JSON.stringify(raw), { mode: 0o600 });

    expect(getSessionMode()).toBe('standard');
    // Should still work with touchSession (standard behavior)
    touchSession(true);
    expect(isSessionValid()).toBe(true);
  });
});
