import crypto, { timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';

export function constantTimeEqual(a: string, b: string): boolean {
  // HMAC both values with a random key to ensure equal-length comparison
  // and eliminate timing leaks from length differences.
  const key = crypto.randomBytes(32);
  const hmacA = crypto.createHmac('sha256', key).update(a).digest();
  const hmacB = crypto.createHmac('sha256', key).update(b).digest();
  return timingSafeEqual(hmacA, hmacB);
}

// Stronger scrypt defaults; tunable for constrained devices via env.
const SCRYPT_N = Math.max(Number(process.env.AW_SCRYPT_N || 65536), 16384);
const SCRYPT_R = Math.max(Number(process.env.AW_SCRYPT_R || 8), 8);
const SCRYPT_P = Math.max(Number(process.env.AW_SCRYPT_P || 1), 1);

type CipherPayload = {
  version: 1;
  kdf: 'scrypt';
  kdf_params?: { N: number; r: number; p: number; keylen: number };
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

export type ScryptParams = { N: number; r: number; p: number; keylen: number };
export const LEGACY_SCRYPT_PARAMS: ScryptParams = { N: 16384, r: 8, p: 1, keylen: 32 };

export function currentScryptParams(): ScryptParams {
  return { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, keylen: 32 };
}

function sanitizeKdfParams(params?: CipherPayload['kdf_params']): { N: number; r: number; p: number; keylen: number } {
  if (!params) return currentScryptParams();
  const N = Math.min(Math.max(Number(params.N) || SCRYPT_N, 16384), 1_048_576);
  const r = Math.min(Math.max(Number(params.r) || SCRYPT_R, 8), 16);
  const p = Math.min(Math.max(Number(params.p) || SCRYPT_P, 1), 4);
  return { N, r, p, keylen: 32 };
}

function deriveKey(
  password: string,
  salt: Buffer,
  params?: CipherPayload['kdf_params']
): Buffer {
  const p = sanitizeKdfParams(params);
  return crypto.scryptSync(password, salt, p.keylen, {
    N: p.N,
    r: p.r,
    p: p.p,
    maxmem: Number(process.env.AW_SCRYPT_MAXMEM || 256 * 1024 * 1024)
  });
}

export function encryptSecret(plaintext: string, password: string): string {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload: CipherPayload = {
    version: 1,
    kdf: 'scrypt',
    kdf_params: { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, keylen: 32 },
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64')
  };
  key.fill(0);
  return JSON.stringify(payload);
}

export function decryptSecretAsBuffer(payloadRaw: string, password: string): Buffer {
  let payload: CipherPayload;
  try { payload = JSON.parse(payloadRaw) as CipherPayload; } catch { throw new AppError('ERR_INTERNAL', 'Corrupt encrypted payload'); }
  const salt = Buffer.from(payload.salt, 'base64');
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
  const candidates: ScryptParams[] = payload.kdf_params
    ? [payload.kdf_params]
    : [currentScryptParams(), LEGACY_SCRYPT_PARAMS];

  let lastErr: unknown;
  for (const params of candidates) {
    const key = deriveKey(password, salt, params);
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      key.fill(0);
      return decrypted;
    } catch (err) {
      lastErr = err;
      key.fill(0);
    }
  }
  // GCM auth tag failure almost certainly means wrong password
  if (lastErr instanceof Error && /unable to authenticate|auth/i.test(lastErr.message)) {
    throw new AppError('ERR_NEED_UNLOCK', 'Invalid master password');
  }
  throw new AppError('ERR_INTERNAL', 'Decryption failed');
}

/** @deprecated Use decryptSecretAsBuffer instead — JS strings cannot be zeroed from memory. */
function decryptSecret(payloadRaw: string, password: string): string {
  const buf = decryptSecretAsBuffer(payloadRaw, password);
  const str = buf.toString('utf8');
  buf.fill(0);
  return str;
}

export function passwordVerifier(password: string, saltB64?: string): { salt: string; verifier: string } {
  const salt = saltB64 ? Buffer.from(saltB64, 'base64') : crypto.randomBytes(16);
  const key = deriveKey(password, salt);
  const verifier = crypto.createHash('sha256').update(key).digest('base64');
  key.fill(0);
  return { salt: salt.toString('base64'), verifier };
}

export function passwordVerifierWithParams(
  password: string,
  saltB64: string,
  params: ScryptParams
): { verifier: string } {
  const salt = Buffer.from(saltB64, 'base64');
  const key = deriveKey(password, salt, params);
  const verifier = crypto.createHash('sha256').update(key).digest('base64');
  key.fill(0);
  return { verifier };
}

/**
 * C3: Shared master password verification — checks against stored verifier
 * using current and legacy KDF params.
 */
export function verifyMasterPassword(
  password: string,
  saltB64: string,
  expectedVerifier: string,
  kdfRaw?: string | null
): boolean {
  let kdfParsed: ScryptParams;
  try {
    kdfParsed = kdfRaw ? JSON.parse(kdfRaw) as ScryptParams : currentScryptParams();
  } catch {
    return false;
  }
  const candidates = [kdfParsed, LEGACY_SCRYPT_PARAMS];
  return candidates.some(
    (p) => constantTimeEqual(passwordVerifierWithParams(password, saltB64, p).verifier, expectedVerifier)
  );
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
