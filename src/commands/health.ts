import { isInitialized } from '../core/db.js';
import { isSessionValid } from '../core/session.js';
import { getProvider } from '../core/rpc.js';
import { CHAIN_ID, CHAIN_NAME, DEFAULT_RPC_URL } from '../core/constants.js';
import { CLI_VERSION } from '../core/version.js';
import { redactUrl, safeSummary } from '../util/redact.js';

type HealthStatus = {
  ok: boolean;
  version: string;
  chain: string;
  chain_id: number;
  db: { ok: boolean; error?: string };
  session: { ok: boolean };
  rpc: { ok: boolean; url: string; chain_id?: number; error?: string };
  polymarket_cli: { ok: boolean; error?: string };
};

export async function healthCommand(): Promise<HealthStatus> {
  const rawUrl = process.env.AW_RPC_URL || DEFAULT_RPC_URL;
  const result: HealthStatus = {
    ok: false,
    version: CLI_VERSION,
    chain: CHAIN_NAME,
    chain_id: CHAIN_ID,
    db: { ok: false },
    session: { ok: false },
    rpc: { ok: false, url: redactUrl(rawUrl) },
    polymarket_cli: { ok: false }
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

  // Check RPC
  try {
    const provider = getProvider();
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    result.rpc.ok = chainId === CHAIN_ID;
    result.rpc.chain_id = chainId;
    if (chainId !== CHAIN_ID) {
      result.rpc.error = `chain_id mismatch: expected ${CHAIN_ID}, got ${chainId}`;
    }
  } catch (err) {
    result.rpc.error = safeSummary(err instanceof Error ? err.message : String(err));
  }

  // Check polymarket CLI — try polymarket-cli first, then polymarket (matches cli-adapter.ts)
  try {
    const { execFileSync } = await import('node:child_process');
    let found = false;
    for (const binary of ['polymarket-cli', 'polymarket'] as const) {
      try {
        execFileSync(binary, ['--version'], { timeout: 5000, stdio: 'pipe' });
        found = true;
        break;
      } catch {
        // try next binary
      }
    }
    if (found) {
      result.polymarket_cli.ok = true;
    } else {
      result.polymarket_cli.error = 'polymarket CLI not found or not executable';
    }
  } catch {
    result.polymarket_cli.error = 'polymarket CLI not found or not executable';
  }

  // Top-level ok = critical services (db + rpc) both healthy
  result.ok = result.db.ok && result.rpc.ok;
  return result;
}
