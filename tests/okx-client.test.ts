import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/core/schema.js';

let memDb: Database.Database;

vi.mock('../src/core/db.js', () => ({
  getDb: () => memDb,
  ensureDataDir: () => {},
  initDbSchema: () => memDb.exec(SCHEMA_SQL),
  assertInitialized: () => {},
  isInitialized: () => true
}));

vi.mock('../src/core/session.js', () => ({
  isSessionValid: () => true,
  clearSession: () => {},
  touchSession: () => {}
}));

beforeEach(() => {
  memDb = new Database(':memory:');
  memDb.pragma('journal_mode = WAL');
  memDb.pragma('foreign_keys = ON');
  memDb.exec(SCHEMA_SQL);
  vi.clearAllMocks();
});

afterEach(() => {
  memDb.close();
});

describe('signRequest', () => {
  it('should produce correct HMAC-SHA256 signature', async () => {
    const { signRequest } = await import('../src/core/okx/client.js');
    const timestamp = '2024-01-01T00:00:00.000Z';
    const method = 'GET';
    const requestPath = '/api/v5/dex/aggregator/swap?chainId=1';
    const body = '';
    const secretKey = 'test-secret-key';

    const signature = signRequest(timestamp, method, requestPath, body, secretKey);

    // Signature should be a base64 string
    expect(signature).toBeTruthy();
    expect(Buffer.from(signature, 'base64').length).toBe(32); // SHA-256 = 32 bytes

    // Same inputs should produce same output (deterministic)
    const signature2 = signRequest(timestamp, method, requestPath, body, secretKey);
    expect(signature).toBe(signature2);

    // Different inputs should produce different output
    const signature3 = signRequest(timestamp, method, requestPath, body, 'different-secret');
    expect(signature).not.toBe(signature3);
  });

  it('should include body in POST signature', async () => {
    const { signRequest } = await import('../src/core/okx/client.js');
    const timestamp = '2024-01-01T00:00:00.000Z';
    const secretKey = 'test-secret-key';

    const sigNoBody = signRequest(timestamp, 'POST', '/api/v5/test', '', secretKey);
    const sigWithBody = signRequest(timestamp, 'POST', '/api/v5/test', '{"key":"value"}', secretKey);

    expect(sigNoBody).not.toBe(sigWithBody);
  });
});

describe('getOkxCredentials', () => {
  it('should use env vars when available', async () => {
    process.env.OKX_API_KEY = 'env-key';
    process.env.OKX_SECRET_KEY = 'env-secret';
    process.env.OKX_PASSPHRASE = 'env-pass';

    const { getOkxCredentials } = await import('../src/core/okx/client.js');
    const creds = getOkxCredentials();

    expect(creds.apiKey).toBe('env-key');
    expect(creds.secretKey).toBe('env-secret');
    expect(creds.passphrase).toBe('env-pass');

    delete process.env.OKX_API_KEY;
    delete process.env.OKX_SECRET_KEY;
    delete process.env.OKX_PASSPHRASE;
  });

  it('should throw ERR_OKX_AUTH when no credentials available and embedded keys are empty', async () => {
    delete process.env.OKX_API_KEY;
    delete process.env.OKX_SECRET_KEY;
    delete process.env.OKX_PASSPHRASE;

    const { getOkxCredentials } = await import('../src/core/okx/client.js');
    const { AppError } = await import('../src/core/errors.js');

    expect(() => getOkxCredentials()).toThrow(AppError);
    try {
      getOkxCredentials();
    } catch (e: unknown) {
      expect((e as { code: string }).code).toBe('ERR_OKX_AUTH');
    }
  });
});

describe('okxRequest', () => {
  it('should throw ERR_OKX_TIMEOUT on abort', async () => {
    const { okxRequest } = await import('../src/core/okx/client.js');
    const { AppError } = await import('../src/core/errors.js');

    // Use an unreachable URL with very short timeout
    try {
      await okxRequest({
        method: 'GET',
        path: '/api/v5/dex/aggregator/supported/chain',
        credentials: { apiKey: 'k', secretKey: 's', passphrase: 'p' },
        timeoutMs: 1, // 1ms timeout → should abort
      });
      expect.fail('Should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(AppError);
      // Could be timeout or connection error
      expect(['ERR_OKX_TIMEOUT', 'ERR_OKX_API_FAILED']).toContain((e as { code: string }).code);
    }
  });
});
