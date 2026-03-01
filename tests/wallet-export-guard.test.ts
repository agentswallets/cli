import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { redactSecrets } from '../src/util/redact.js';

// Mock dependencies before importing the command
vi.mock('../src/core/db.js', () => ({ assertInitialized: vi.fn(), getDb: vi.fn() }));
vi.mock('../src/core/settings.js', () => ({
  getSetting: vi.fn((key: string) => {
    if (key === 'master_password_salt') return 'salt';
    if (key === 'master_password_verifier') return 'verifier';
    return null;
  })
}));

const verifyMasterPasswordMock = vi.fn(() => true);
vi.mock('../src/core/crypto.js', () => ({
  verifyMasterPassword: (...args: unknown[]) => verifyMasterPasswordMock(...args),
  decryptSecretAsBuffer: vi.fn(() => Buffer.from('0x' + 'ab'.repeat(32)))
}));
vi.mock('../src/core/wallet-store.js', () => ({
  getWalletById: vi.fn(() => ({
    id: 'w_test',
    name: 'test',
    address: '0x1234',
    encrypted_private_key: 'enc',
    created_at: '2025-01-01'
  }))
}));

const logAuditMock = vi.fn();
vi.mock('../src/core/audit-service.js', () => ({ logAudit: (...args: unknown[]) => logAuditMock(...args) }));
vi.mock('../src/util/agent-input.js', () => ({
  confirmAction: vi.fn(async () => true),
  getMasterPassword: vi.fn(async () => 'password123')
}));

import { walletExportKeyCommand } from '../src/commands/wallet.js';

describe('wallet export-key guard', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.AW_ALLOW_EXPORT;
    verifyMasterPasswordMock.mockClear();
    verifyMasterPasswordMock.mockReturnValue(true);
    logAuditMock.mockClear();
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  // --- User-specified test 1: export succeeds with correct password ---
  it('succeeds with correct password and logs audit ok', async () => {
    process.env.AW_ALLOW_EXPORT = '1';
    verifyMasterPasswordMock.mockReturnValue(true);

    const result = await walletExportKeyCommand('w_test', true, true);
    expect(result.name).toBe('test');
    expect(result.address).toBe('0x1234');
    expect(result.private_key).toBeDefined();
    expect(result.warning).toContain('Do not log');

    // Audit: success logged
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'wallet.export_key', decision: 'ok' })
    );
  });

  // --- User-specified test 2: wrong password → ERR_AUTH_FAILED, no key ---
  it('fails with wrong password, returns ERR_AUTH_FAILED, no private key', async () => {
    process.env.AW_ALLOW_EXPORT = '1';
    verifyMasterPasswordMock.mockReturnValue(false);

    const err: any = await walletExportKeyCommand('w_test', true, true).catch((e) => e);
    expect(err.code).toBe('ERR_AUTH_FAILED');
    expect(err.message).toContain('Invalid master password');
    // No private key returned anywhere
    expect(JSON.stringify(err)).not.toMatch(/0x[a-fA-F0-9]{64}/);

    // Audit: failure logged with error code
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'wallet.export_key',
        decision: 'denied',
        error_code: 'ERR_AUTH_FAILED'
      })
    );
  });

  // --- User-specified test 3: blocked without AW_ALLOW_EXPORT even with correct password ---
  it('blocked without AW_ALLOW_EXPORT=1 even with correct password', async () => {
    delete process.env.AW_ALLOW_EXPORT;
    verifyMasterPasswordMock.mockReturnValue(true);

    await expect(walletExportKeyCommand('w_test', true, true)).rejects.toMatchObject({
      code: 'ERR_INVALID_PARAMS',
      message: expect.stringContaining('AW_ALLOW_EXPORT=1')
    });
    // verifyMasterPassword should never be reached
    expect(verifyMasterPasswordMock).not.toHaveBeenCalled();
  });

  // --- Existing regressions kept ---
  it('throws with AW_ALLOW_EXPORT=1 but without --danger-export flag', async () => {
    process.env.AW_ALLOW_EXPORT = '1';
    await expect(walletExportKeyCommand('w_test', true, false)).rejects.toMatchObject({
      code: 'ERR_INVALID_PARAMS',
      message: expect.stringContaining('--danger-export')
    });
  });

  it('audit log does not contain plaintext private key via redactSecrets', async () => {
    process.env.AW_ALLOW_EXPORT = '1';
    const result = await walletExportKeyCommand('w_test', true, true);
    const serialized = JSON.stringify(result);
    const redacted = redactSecrets(serialized);
    expect(redacted).not.toMatch(/0x[a-fA-F0-9]{64}/);
    expect(redacted).toContain('[REDACTED]');
  });
});
