import { describe, expect, it, vi, beforeEach } from 'vitest';

// --- Mocks ---
vi.mock('../src/core/db.js', () => ({
  assertInitialized: vi.fn()
}));

vi.mock('../src/core/session.js', () => ({
  isSessionValid: vi.fn(() => true)
}));

vi.mock('../src/core/errors.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/core/errors.js')>();
  return { ...original };
});

const getWalletByIdMock = vi.fn(() => ({
  id: 'w_test',
  name: 'bot',
  address: '0x1234',
  encrypted_private_key: 'enc',
  created_at: '2025-01-01'
}));

const defaultPolicy = {
  daily_limit: 500,
  per_tx_limit: 100,
  max_tx_per_day: 50,
  allowed_tokens: ['USDC', 'POL'],
  allowed_addresses: [],
  require_approval_above: null
};

const getPolicyMock = vi.fn(() => ({ ...defaultPolicy }));
const upsertPolicyMock = vi.fn();

vi.mock('../src/core/wallet-store.js', () => ({
  getWalletById: (...args: unknown[]) => getWalletByIdMock(...args),
  getPolicy: (...args: unknown[]) => getPolicyMock(...args),
  upsertPolicy: (...args: unknown[]) => upsertPolicyMock(...args)
}));

const logAuditMock = vi.fn();
vi.mock('../src/core/audit-service.js', () => ({
  logAudit: (...args: unknown[]) => logAuditMock(...args)
}));

import { policySetCommand, policyShowCommand } from '../src/commands/policy.js';

describe('policySetCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWalletByIdMock.mockReturnValue({
      id: 'w_test', name: 'bot', address: '0x1234',
      encrypted_private_key: 'enc', created_at: '2025-01-01'
    });
    getPolicyMock.mockReturnValue({ ...defaultPolicy });
  });

  it('sets daily and per-tx limits', () => {
    const result = policySetCommand('w_test', { limitDaily: '1000', limitPerTx: '200' });
    expect(result.name).toBe('bot');
    expect(result.address).toBe('0x1234');
    expect(result.policy.daily_limit).toBe(1000);
    expect(result.policy.per_tx_limit).toBe(200);
  });

  it('preserves existing values when only one limit provided', () => {
    const result = policySetCommand('w_test', { limitDaily: '800' });
    expect(result.policy.daily_limit).toBe(800);
    expect(result.policy.per_tx_limit).toBe(100); // preserved from existing
  });

  it('calls upsertPolicy with merged config', () => {
    policySetCommand('w_test', { limitDaily: '600', limitPerTx: '150' });
    expect(upsertPolicyMock).toHaveBeenCalledWith('w_test', expect.objectContaining({
      daily_limit: 600,
      per_tx_limit: 150,
      max_tx_per_day: 50,
      allowed_tokens: ['USDC', 'POL']
    }));
  });

  it('validates wallet exists before setting policy', () => {
    policySetCommand('w_test', { limitDaily: '500' });
    expect(getWalletByIdMock).toHaveBeenCalledWith('w_test');
  });

  it('throws on wallet not found', () => {
    getWalletByIdMock.mockImplementation(() => {
      throw { code: 'ERR_WALLET_NOT_FOUND', message: 'wallet_id not found' };
    });
    expect(() => policySetCommand('w_nonexistent', { limitDaily: '500' })).toThrow();
  });

  it('logs audit on successful policy set', () => {
    policySetCommand('w_test', { limitDaily: '500' });
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet_id: 'w_test',
        action: 'policy.set',
        decision: 'ok'
      })
    );
  });

  it('rejects non-positive limit values', () => {
    expect(() => policySetCommand('w_test', { limitDaily: '-10' })).toThrow();
    expect(() => policySetCommand('w_test', { limitPerTx: '0' })).toThrow();
  });
});

describe('policyShowCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWalletByIdMock.mockReturnValue({
      id: 'w_test', name: 'bot', address: '0x1234',
      encrypted_private_key: 'enc', created_at: '2025-01-01'
    });
    getPolicyMock.mockReturnValue({ ...defaultPolicy });
  });

  it('returns name, address and policy', () => {
    const result = policyShowCommand('w_test');
    expect(result.name).toBe('bot');
    expect(result.address).toBe('0x1234');
    expect(result.policy).toEqual(defaultPolicy);
  });

  it('validates wallet exists', () => {
    policyShowCommand('w_test');
    expect(getWalletByIdMock).toHaveBeenCalledWith('w_test');
  });

  it('throws on wallet not found', () => {
    getWalletByIdMock.mockImplementation(() => {
      throw { code: 'ERR_WALLET_NOT_FOUND', message: 'not found' };
    });
    expect(() => policyShowCommand('w_nonexistent')).toThrow();
  });
});
