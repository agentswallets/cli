import { describe, expect, it, vi, beforeEach } from 'vitest';

// --- Mocks ---
const setSettingMock = vi.fn();
vi.mock('../src/core/settings.js', () => ({
  setSetting: (...args: unknown[]) => setSettingMock(...args)
}));

const ensureDataDirMock = vi.fn();
const initDbSchemaMock = vi.fn();
const isInitializedMock = vi.fn(() => false);
const closeDbMock = vi.fn();
const transactionFn = vi.fn((fn: () => void) => {
  const wrapper = () => fn();
  return wrapper;
});

vi.mock('../src/core/db.js', () => ({
  ensureDataDir: (...args: unknown[]) => ensureDataDirMock(...args),
  initDbSchema: (...args: unknown[]) => initDbSchemaMock(...args),
  isInitialized: () => isInitializedMock(),
  closeDb: (...args: unknown[]) => closeDbMock(...args),
  getDb: vi.fn(() => ({ transaction: transactionFn }))
}));

const passwordVerifierMock = vi.fn(() => ({ salt: 'test_salt', verifier: 'test_verifier' }));
vi.mock('../src/core/crypto.js', () => ({
  passwordVerifier: (...args: unknown[]) => passwordVerifierMock(...args),
  currentScryptParams: vi.fn(() => ({ N: 16384, r: 8, p: 1, keylen: 32 }))
}));

const getNewMasterPasswordMock = vi.fn(async () => 'StrongPass123');
const isNonInteractiveMock = vi.fn(() => true);
const confirmActionMock = vi.fn(async () => false);
vi.mock('../src/util/agent-input.js', () => ({
  getNewMasterPassword: (...args: unknown[]) => getNewMasterPasswordMock(...args),
  isNonInteractive: () => isNonInteractiveMock(),
  confirmAction: (...args: unknown[]) => confirmActionMock(...args)
}));

vi.mock('../src/core/keychain.js', () => ({
  keychainAvailable: vi.fn(() => false),
  keychainSet: vi.fn()
}));

vi.mock('../src/core/config.js', () => ({
  getHomeDir: vi.fn(() => '/tmp/aw-test')
}));

vi.mock('../src/core/constants.js', () => ({
  CHAIN_ID: 137,
  CHAIN_NAME: 'Polygon'
}));

vi.mock('../src/core/audit-service.js', () => ({
  logAudit: vi.fn()
}));

import { initCommand } from '../src/commands/init.js';

describe('initCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isInitializedMock.mockReturnValue(false);
  });

  it('initializes successfully and returns data_dir + chain_id', async () => {
    const result = await initCommand();
    expect(result.data_dir).toBe('/tmp/aw-test');
    expect(result.chain).toBe('Polygon');
    expect(result.chain_id).toBe(137);
  });

  it('calls ensureDataDir and initDbSchema', async () => {
    await initCommand();
    expect(ensureDataDirMock).toHaveBeenCalledOnce();
    expect(initDbSchemaMock).toHaveBeenCalledOnce();
  });

  it('prompts for new master password', async () => {
    await initCommand();
    expect(getNewMasterPasswordMock).toHaveBeenCalledOnce();
  });

  it('stores password salt, verifier, kdf_params, chain_id, and initialized_at in transaction', async () => {
    await initCommand();
    expect(transactionFn).toHaveBeenCalledOnce();
    expect(setSettingMock).toHaveBeenCalledWith('master_password_salt', 'test_salt');
    expect(setSettingMock).toHaveBeenCalledWith('master_password_verifier', 'test_verifier');
    expect(setSettingMock).toHaveBeenCalledWith('master_password_kdf_params', expect.any(String));
    expect(setSettingMock).toHaveBeenCalledWith('chain_id', '137');
    expect(setSettingMock).toHaveBeenCalledWith('initialized_at', expect.any(String));
  });

  it('throws ERR_INVALID_PARAMS if already initialized', async () => {
    isInitializedMock.mockReturnValue(true);
    await expect(initCommand()).rejects.toMatchObject({
      code: 'ERR_INVALID_PARAMS',
      message: expect.stringContaining('Already initialized')
    });
  });

  it('closes DB after init', async () => {
    await initCommand();
    expect(closeDbMock).toHaveBeenCalledOnce();
  });
});
