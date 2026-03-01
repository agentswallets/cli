import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearSession, createSession, isSessionValid } from '../src/core/session.js';

const originalEnv = { ...process.env };

function resetEnv(): void {
  process.env = { ...originalEnv };
}

describe('session token validation', () => {
  afterEach(() => {
    clearSession();
    resetEnv();
  });

  it('accepts correct AW_UNLOCK_TOKEN and rejects wrong token', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-session-'));
    process.env.AGENTSWALLETS_HOME = home;
    const { token } = createSession(15);

    expect(isSessionValid()).toBe(true);

    process.env.AW_UNLOCK_TOKEN = 'wrong-token';
    expect(isSessionValid()).toBe(false);

    process.env.AW_UNLOCK_TOKEN = token;
    expect(isSessionValid()).toBe(true);
  });

  it('supports AW_UNLOCK_TOKEN_FILE', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-session-file-'));
    process.env.AGENTSWALLETS_HOME = home;
    const { token } = createSession(15);
    const tokenFile = path.join(home, 'token.txt');
    fs.writeFileSync(tokenFile, token, 'utf8');

    process.env.AW_UNLOCK_TOKEN_FILE = tokenFile;
    expect(isSessionValid()).toBe(true);
  });
});

