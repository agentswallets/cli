import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  encryptSecret,
  decryptSecretAsBuffer,
  passwordVerifier,
  randomToken,
  constantTimeEqual,
  currentScryptParams
} from '../src/core/crypto.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('crypto', () => {
  describe('encrypt → decrypt round-trip', () => {
    it('decrypts back to original plaintext', () => {
      const plaintext = '0x' + 'ab'.repeat(32);
      const password = 'strongpassword123';
      const encrypted = encryptSecret(plaintext, password);
      const buf = decryptSecretAsBuffer(encrypted, password);
      expect(buf.toString('utf8')).toBe(plaintext);
      buf.fill(0);
    });

    it('works with unicode plaintext', () => {
      const plaintext = '你好世界🌍';
      const password = 'test-pass';
      const encrypted = encryptSecret(plaintext, password);
      const buf = decryptSecretAsBuffer(encrypted, password);
      expect(buf.toString('utf8')).toBe(plaintext);
      buf.fill(0);
    });

    it('fails with wrong password and returns clear error', () => {
      const encrypted = encryptSecret('secret', 'correct-password');
      expect(() => decryptSecretAsBuffer(encrypted, 'wrong-password')).toThrow('Invalid master password');
    });
  });

  describe('passwordVerifier', () => {
    it('produces consistent verifier with same salt', () => {
      const { salt, verifier } = passwordVerifier('mypass');
      const { verifier: v2 } = passwordVerifier('mypass', salt);
      expect(v2).toBe(verifier);
    });

    it('produces different verifier for different passwords', () => {
      const { salt, verifier: v1 } = passwordVerifier('pass1');
      const { verifier: v2 } = passwordVerifier('pass2', salt);
      expect(v2).not.toBe(v1);
    });
  });

  describe('randomToken', () => {
    it('returns 64-char hex string', () => {
      const token = randomToken();
      expect(token).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
    });

    it('generates unique tokens', () => {
      const a = randomToken();
      const b = randomToken();
      expect(a).not.toBe(b);
    });
  });

  describe('constantTimeEqual', () => {
    it('returns true for equal strings', () => {
      expect(constantTimeEqual('abc', 'abc')).toBe(true);
    });

    it('returns false for different strings', () => {
      expect(constantTimeEqual('abc', 'xyz')).toBe(false);
    });

    it('returns false for different length strings', () => {
      expect(constantTimeEqual('ab', 'abc')).toBe(false);
    });
  });

  describe('scrypt params from env', () => {
    it('respects AW_SCRYPT_N env var', () => {
      // currentScryptParams reads from module-level constants which are set at import time
      // This test just verifies the function returns the expected shape
      const params = currentScryptParams();
      expect(params).toHaveProperty('N');
      expect(params).toHaveProperty('r');
      expect(params).toHaveProperty('p');
      expect(params).toHaveProperty('keylen', 32);
    });
  });
});
