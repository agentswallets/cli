import { isInitialized } from '../core/db.js';
import { isSessionValid } from '../core/session.js';
import { getProvider } from '../core/rpc.js';
import { getChain, getDefaultChainKey, isSolanaChain, resolveChainKey } from '../core/chains.js';
import type { ChainKey } from '../core/chains.js';
import { getSolanaConnection } from '../core/solana-provider.js';
import { CLI_VERSION } from '../core/version.js';
import { redactUrl, safeSummary } from '../util/redact.js';
import { getHomeDir } from '../core/config.js';

type HealthStatus = {
  ok: boolean;
  version: string;
  chain: string;
  default_chain: string;
  checked_chain: string;
  home_dir: string;
  db: { ok: boolean; error?: string };
  session: { ok: boolean };
  rpc: { ok: boolean; url: string; error?: string };
  polymarket_sdk: { ok: boolean; error?: string };
  solana: { supported: true; rpc_url: string };
};

export async function healthCommand(chainOpt?: string): Promise<HealthStatus> {
  const defaultKey = getDefaultChainKey();
  const chainKey: ChainKey = chainOpt ? resolveChainKey(chainOpt) : defaultKey;
  const chain = getChain(chainKey);
  const rawUrl = process.env[chain.rpcEnvVar] || process.env.AW_RPC_URL || chain.defaultRpcUrls;

  const solanaChain = getChain('solana');
  const solanaRpcUrl = process.env[solanaChain.rpcEnvVar] || solanaChain.defaultRpcUrls;

  const result: HealthStatus = {
    ok: false,
    version: CLI_VERSION,
    chain: chain.name,
    default_chain: defaultKey,
    checked_chain: chainKey,
    home_dir: getHomeDir(),
    db: { ok: false },
    session: { ok: false },
    rpc: { ok: false, url: redactUrl(rawUrl) },
    polymarket_sdk: { ok: false },
    solana: { supported: true, rpc_url: redactUrl(solanaRpcUrl) },
  };

  // Check DB
  try {
    result.db.ok = isInitialized();
    if (!result.db.ok) result.db.error = 'not initialized';
  } catch (err) {
    result.db.error = safeSummary(err instanceof Error ? err.message : String(err));
  }

  // Check session
  try {
    result.session.ok = isSessionValid();
  } catch {
    result.session.ok = false;
  }

  // Check RPC — Solana uses its own Connection, EVM uses ethers provider
  try {
    if (isSolanaChain(chainKey)) {
      const conn = getSolanaConnection();
      await conn.getLatestBlockhash();
      result.rpc.ok = true;
    } else {
      const provider = getProvider(chainKey);
      const network = await provider.getNetwork();
      const chainId = Number(network.chainId);
      result.rpc.ok = chainId === chain.chainId;
      if (chainId !== chain.chainId) {
        result.rpc.error = `Chain mismatch: expected ${chain.name} (${chain.chainId}), got chain_id ${chainId}`;
      }
    }
  } catch (err) {
    result.rpc.error = safeSummary(err instanceof Error ? err.message : String(err));
  }

  // Check Polymarket SDK connectivity (lightweight CLOB API ping)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://clob.polymarket.com/', { signal: controller.signal });
    clearTimeout(timer);
    result.polymarket_sdk.ok = res.ok;
    if (!res.ok) result.polymarket_sdk.error = `CLOB API returned HTTP ${res.status}`;
  } catch (err) {
    result.polymarket_sdk.error = err instanceof Error ? err.message : 'CLOB API unreachable';
  }

  // Top-level ok = critical services (db + rpc) both healthy
  result.ok = result.db.ok && result.rpc.ok;
  return result;
}
