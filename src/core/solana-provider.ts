import { Connection } from '@solana/web3.js';
import { getChain } from './chains.js';

let connectionInstance: Connection | null = null;

function parseSolanaRpcUrl(): string {
  const chain = getChain('solana');
  const envUrl = process.env[chain.rpcEnvVar];
  if (envUrl) return envUrl.trim();
  return chain.defaultRpcUrls;
}

export function getSolanaConnection(): Connection {
  if (!connectionInstance) {
    const url = parseSolanaRpcUrl();
    connectionInstance = new Connection(url, 'confirmed');
  }
  return connectionInstance;
}

/** Reset connection state (for testing only). */
export function __resetSolanaConnection(): void {
  connectionInstance = null;
}
