import { describe, expect, it, vi, beforeEach } from 'vitest';

// --- Mocks ---
vi.mock('../src/core/db.js', () => ({
  assertInitialized: vi.fn(),
  getDb: vi.fn(() => ({
    prepare: vi.fn((sql: string) => {
      // getFailedAttempts — no failed attempts by default
      if (/SELECT value FROM settings WHERE key='login_fail_state'/.test(sql)) {
        return { get: vi.fn(() => undefined) };
      }
      // recordFailedAttempt / clearFailedAttempts
      return { run: vi.fn(), get: vi.fn() };
    }),
    transaction: (fn: () => unknown) => {
      const wrapper = () => fn();
      wrapper.immediate = () => fn();
      wrapper.exclusive = () => fn();
      wrapper.deferred = () => fn();
      return wrapper;
    }
  }))
}));

const getSettingMock = vi.fn((key: string) => {
  if (key === 'master_password_salt') return 'test_salt_b64';
  if (key === 'master_password_verifier') return 'test_verifier_b64';
  if (key === 'master_password_kdf_params') return JSON.stringify({ N: 16384, r: 8, p: 1, keylen: 32 });
  return null;
});
vi.mock('../src/core/settings.js', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args)
}));

const verifyMasterPasswordMock = vi.fn(() => true);
vi.mock('../src/core/crypto.js', () => ({
  verifyMasterPassword: (...args: unknown[]) => verifyMasterPasswordMock(...args)
}));

const createSessionMock = vi.fn(() => ({
  token: 'tok_abc',
  token_file: '/tmp/aw-test/session-token',
  expires_at: '2025-12-31T23:59:59.000Z'
}));
vi.mock('../src/core/session.js', () => ({
  createSession: (...args: unknown[]) => createSessionMock(...args)
}));

const getMasterPasswordMock = vi.fn(async () => 'StrongPass123');
vi.mock('../src/util/agent-input.js', () => ({
  getMasterPassword: (...args: unknown[]) => getMasterPasswordMock(...args)
}));

const logAuditMock = vi.fn();
vi.mock('../src/core/audit-service.js', () => ({
  logAudit: (...args: unknown[]) => logAuditMock(...args)
}));

import { unlockCommand } from '../src/commands/unlock.js';

describe('unlockCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyMasterPasswordMock.mockReturnValue(true);
    getSettingMock.mockImplementation((key: string) => {
      if (key === 'master_password_salt') return 'test_salt_b64';
      if (key === 'master_password_verifier') return 'test_verifier_b64';
      if (key === 'master_password_kdf_params') return JSON.stringify({ N: 16384, r: 8, p: 1, keylen: 32 });
      return null;
    });
  });

  it('unlocks successfully with correct password', async () => {
    const result = await unlockCommand();
    expect(result.status).toBe('unlocked');
    expect(result.token_file).toBeDefined();
    expect(result.expires_at).toBeDefined();
  });

  it('calls getMasterPassword for password input', async () => {
    await unlockCommand();
    expect(getMasterPasswordMock).toHaveBeenCalledWith('Master password: ');
  });

  it('creates session on successful unlock', async () => {
    await unlockCommand();
    expect(createSessionMock).toHaveBeenCalledOnce();
  });

  it('throws ERR_NEED_UNLOCK on wrong password', async () => {
    verifyMasterPasswordMock.mockReturnValue(false);
    await expect(unlockCommand()).rejects.toMatchObject({
      code: 'ERR_NEED_UNLOCK',
      message: expect.stringContaining('Invalid password')
    });
  });

  it('logs audit denied on wrong password', async () => {
    verifyMasterPasswordMock.mockReturnValue(false);
    await unlockCommand().catch(() => {});
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'unlock',
        decision: 'denied',
        error_code: 'ERR_NEED_UNLOCK'
      })
    );
  });

  it('throws ERR_NOT_INITIALIZED if salt or verifier missing', async () => {
    getSettingMock.mockReturnValue(null);
    await expect(unlockCommand()).rejects.toMatchObject({
      code: 'ERR_NOT_INITIALIZED',
      message: expect.stringContaining('Missing auth settings')
    });
  });

  it('does not create session on failed password', async () => {
    verifyMasterPasswordMock.mockReturnValue(false);
    await unlockCommand().catch(() => {});
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});
