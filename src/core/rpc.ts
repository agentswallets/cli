import { FetchRequest, JsonRpcProvider } from 'ethers';
import { type ChainKey, getChain, getDefaultChainKey } from './chains.js';
import { AppError } from './errors.js';
import { safeSummary } from '../util/redact.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
let rpcTimeoutMs = 30_000;

/** Set RPC timeout in milliseconds. Must be called before any RPC operation. */
export function setRpcTimeout(ms: number): void {
  rpcTimeoutMs = ms;
}

type ProviderPool = { providers: JsonRpcProvider[]; idx: number; verified: boolean };
const pools = new Map<ChainKey, ProviderPool>();

function validateUrl(url: string): string {
  // M-3: Reject non-localhost http:// URLs
  if (/^http:\/\//i.test(url)) {
    const hostname = new URL(url).hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') {
      throw new AppError('ERR_RPC_UNAVAILABLE', `Insecure RPC URL rejected (use HTTPS): ${url}`);
    }
  }
  return url;
}

function parseRpcUrls(chainKey: ChainKey): string[] {
  const chain = getChain(chainKey);

  // Priority: chain-specific env var > AW_RPC_URL (default chain only) > defaults
  const chainEnv = process.env[chain.rpcEnvVar];
  if (chainEnv) {
    return chainEnv.split(',').map(u => u.trim()).filter(Boolean).map(validateUrl);
  }

  const genericEnv = process.env.AW_RPC_URL;
  if (genericEnv && chainKey === getDefaultChainKey()) {
    return genericEnv.split(',').map(u => u.trim()).filter(Boolean).map(validateUrl);
  }

  return chain.defaultRpcUrls.split(',').map(u => u.trim()).filter(Boolean).map(validateUrl);
}

function makeProvider(url: string): JsonRpcProvider {
  const req = new FetchRequest(url);
  req.timeout = rpcTimeoutMs;
  return new JsonRpcProvider(req);
}

function getPool(chainKey: ChainKey): ProviderPool {
  let pool = pools.get(chainKey);
  if (!pool) {
    const urls = parseRpcUrls(chainKey);
    const providers = urls.length > 0
      ? urls.map(url => makeProvider(url))
      : [makeProvider(getChain(chainKey).defaultRpcUrls.split(',')[0])];
    pool = { providers, idx: 0, verified: false };
    pools.set(chainKey, pool);
  }
  return pool;
}

export function getProvider(chainKey?: ChainKey): JsonRpcProvider {
  const key = chainKey ?? getDefaultChainKey();
  const pool = getPool(key);
  return pool.providers[pool.idx % pool.providers.length];
}

function nextProvider(chainKey: ChainKey): JsonRpcProvider {
  const pool = getPool(chainKey);
  if (pool.providers.length > 1) {
    pool.idx = (pool.idx + 1) % pool.providers.length;
  }
  return pool.providers[pool.idx];
}

export async function verifyChainId(chainKey?: ChainKey): Promise<void> {
  const key = chainKey ?? getDefaultChainKey();
  const pool = getPool(key);
  if (pool.verified) return;
  const chain = getChain(key);
  const provider = getProvider(key);
  try {
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    if (chainId !== chain.chainId) {
      throw new AppError('ERR_RPC_UNAVAILABLE', `RPC chain ID mismatch: expected ${chain.chainId} (${chain.name}), got ${chainId}. Check ${chain.rpcEnvVar}.`);
    }
    pool.verified = true;
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

export async function withRetry<T>(fn: (provider: JsonRpcProvider) => Promise<T>, chainKey?: ChainKey): Promise<T> {
  const key = chainKey ?? getDefaultChainKey();
  const pool = getPool(key);
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn(getProvider(key));
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!isRetryableError(msg)) throw err;
      if (pool.providers.length > 1) nextProvider(key);
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
  for (const pool of pools.values()) {
    for (const p of pool.providers) {
      try { p.destroy(); } catch { /* best effort */ }
    }
  }
  pools.clear();
}

/** Reset provider state (for testing only). */
export function __resetProviders(): void {
  pools.clear();
}
