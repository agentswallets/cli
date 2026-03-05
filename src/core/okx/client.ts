import crypto from 'node:crypto';
import { AppError } from '../errors.js';
import { OKX_BASE_URL, OKX_REQUEST_TIMEOUT_MS } from './constants.js';
import { EMBEDDED_OKX_API_KEY, EMBEDDED_OKX_SECRET_KEY, EMBEDDED_OKX_PASSPHRASE } from './embedded-keys.js';
import type { OkxCredentials, OkxApiResponse } from './types.js';

/**
 * Resolve OKX API credentials.
 * Priority: env vars > embedded keys (injected at build time).
 */
export function getOkxCredentials(): OkxCredentials {
  const envKey = process.env.OKX_API_KEY;
  const envSecret = process.env.OKX_SECRET_KEY;
  const envPass = process.env.OKX_PASSPHRASE;

  if (envKey && envSecret && envPass) {
    return { apiKey: envKey, secretKey: envSecret, passphrase: envPass };
  }

  if (EMBEDDED_OKX_API_KEY && EMBEDDED_OKX_SECRET_KEY && EMBEDDED_OKX_PASSPHRASE) {
    return { apiKey: EMBEDDED_OKX_API_KEY, secretKey: EMBEDDED_OKX_SECRET_KEY, passphrase: EMBEDDED_OKX_PASSPHRASE };
  }

  throw new AppError(
    'ERR_OKX_AUTH',
    'OKX API credentials not available. Set OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE env vars.'
  );
}

/**
 * HMAC-SHA256 signing per OKX spec.
 * signature = Base64(HMAC-SHA256(timestamp + method + requestPath + body, secretKey))
 */
export function signRequest(
  timestamp: string,
  method: string,
  requestPath: string,
  body: string,
  secretKey: string
): string {
  const prehash = timestamp + method.toUpperCase() + requestPath + body;
  return crypto.createHmac('sha256', secretKey).update(prehash).digest('base64');
}

export type OkxRequestOpts = {
  method: 'GET' | 'POST';
  path: string;
  params?: Record<string, string | undefined>;
  body?: unknown;
  credentials: OkxCredentials;
  timeoutMs?: number;
};

/**
 * Make an authenticated request to OKX API.
 */
export async function okxRequest<T>(opts: OkxRequestOpts): Promise<T> {
  const { method, credentials, timeoutMs = OKX_REQUEST_TIMEOUT_MS } = opts;
  let requestPath = opts.path;

  // For GET requests, append query params
  if (method === 'GET' && opts.params) {
    const qs = Object.entries(opts.params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
      .join('&');
    if (qs) requestPath += '?' + qs;
  }

  const bodyStr = method === 'POST' && opts.body ? JSON.stringify(opts.body) : '';
  const timestamp = new Date().toISOString();
  const signature = signRequest(timestamp, method, requestPath, bodyStr, credentials.secretKey);

  const url = OKX_BASE_URL + requestPath;
  const headers: Record<string, string> = {
    'OK-ACCESS-KEY': credentials.apiKey,
    'OK-ACCESS-SIGN': signature,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': credentials.passphrase,
    'Content-Type': 'application/json',
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: bodyStr || undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new AppError('ERR_OKX_AUTH', `OKX authentication failed (HTTP ${response.status}): ${text}`);
      }
      throw new AppError('ERR_OKX_API_FAILED', `OKX API error (HTTP ${response.status}): ${text}`);
    }

    const json = (await response.json()) as OkxApiResponse<T>;

    if (json.code !== '0') {
      throw new AppError('ERR_OKX_API_FAILED', `OKX API error (code ${json.code}): ${json.msg}`);
    }

    return json.data;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AppError('ERR_OKX_TIMEOUT', `OKX API request timed out after ${timeoutMs}ms`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError('ERR_OKX_API_FAILED', `OKX API request failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}
