import { FetchRequest, JsonRpcProvider } from 'ethers';
import { CHAIN_ID, DEFAULT_RPC_URL } from './constants.js';
import { AppError } from './errors.js';
import { safeSummary } from '../util/redact.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
let rpcTimeoutMs = 30_000;

/** Set RPC timeout in milliseconds. Must be called before any RPC operation. */
export function setRpcTimeout(ms: number): void {
  rpcTimeoutMs = ms;
}

function parseRpcUrls(): string[] {
  const raw = process.env.AW_RPC_URL || DEFAULT_RPC_URL;
  return raw
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
    .map((url) => {
      // M-3: Reject non-localhost http:// URLs
      if (/^http:\/\//i.test(url)) {
        const hostname = new URL(url).hostname;
        if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') {
          throw new AppError('ERR_RPC_UNAVAILABLE', `Insecure RPC URL rejected (use HTTPS): ${url}`);
        }
      }
      return url;
    });
}

let providers: JsonRpcProvider[] | null = null;
let currentIdx = 0;
let chainIdVerified = false;

function makeProvider(url: string): JsonRpcProvider {
  const req = new FetchRequest(url);
  req.timeout = rpcTimeoutMs;
  return new JsonRpcProvider(req);
}

function initProviders(): JsonRpcProvider[] {
  if (!providers) {
    providers = parseRpcUrls().map((url) => makeProvider(url));
    if (providers.length === 0) {
      providers = [makeProvider(DEFAULT_RPC_URL)];
    }
    currentIdx = 0;
  }
  return providers;
}

export function getProvider(): JsonRpcProvider {
  const list = initProviders();
  return list[currentIdx % list.length];
}

function nextProvider(): JsonRpcProvider {
  const list = initProviders();
  if (list.length > 1) {
    currentIdx = (currentIdx + 1) % list.length;
  }
  return list[currentIdx];
}

export async function verifyChainId(): Promise<void> {
  if (chainIdVerified) return;
  const provider = getProvider();
  try {
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    if (chainId !== CHAIN_ID) {
      throw new AppError('ERR_RPC_UNAVAILABLE', `RPC chain ID mismatch: expected ${CHAIN_ID} (Polygon), got ${chainId}. Check AW_RPC_URL.`);
    }
    chainIdVerified = true;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('ERR_RPC_UNAVAILABLE', `Failed to verify chain ID: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function isRetryableError(msg: string): boolean {
  return /timeout|network|ECONN|ENOTFOUND|503|429|ETIMEDOUT|socket hang up|server error/i.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
  const list = initProviders();
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn(getProvider());
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!isRetryableError(msg)) throw err;
      if (list.length > 1) nextProvider();
      if (attempt < MAX_RETRIES - 1) {
        await sleep(BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }
  return mapRpcError(lastErr);
}

export function mapRpcError(err: unknown): never {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = safeSummary(raw);
  if (/insufficient funds/i.test(raw)) {
    throw new AppError('ERR_INSUFFICIENT_FUNDS', msg);
  }
  if (/timeout|network|ECONN|ENOTFOUND|503|429/i.test(raw)) {
    throw new AppError('ERR_RPC_UNAVAILABLE', msg);
  }
  throw new AppError('ERR_INTERNAL', msg);
}

/** Destroy all provider connections so Node.js can exit cleanly. */
export function destroyProviders(): void {
  if (providers) {
    for (const p of providers) {
      try { p.destroy(); } catch { /* best effort */ }
    }
    providers = null;
    currentIdx = 0;
    chainIdVerified = false;
  }
}

/** Reset provider state (for testing only). */
export function __resetProviders(): void {
  providers = null;
  currentIdx = 0;
  chainIdVerified = false;
}
