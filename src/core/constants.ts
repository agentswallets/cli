export const APP_NAME = 'agentswallets';
export const CHAIN_ID = 137;
export const CHAIN_NAME = 'Polygon';
export const DEFAULT_RPC_URL = 'https://polygon.drpc.org,https://polygon-bor-rpc.publicnode.com,https://1rpc.io/matic';
// Polygon native USDC (CCTP).
export const USDC_ADDRESS = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
// Legacy bridged USDC (USDC.e).
export const USDC_LEGACY_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
// S7: Hard cap at 15 minutes for financial CLI security, minimum 1 minute
export const SESSION_TTL_MINUTES = Math.max(1, Math.min(Number(process.env.AW_SESSION_TTL_MINUTES) || 15, 15));
export const POLYMARKET_INSTALL_GUIDE = 'https://github.com/Polymarket/cli';

/** Default policy applied to every newly created wallet — safe-by-default limits. */
export const DEFAULT_POLICY = {
  per_tx_limit: 100,
  daily_limit: 500,
  max_tx_per_day: 20,
  allowed_tokens: ['POL', 'USDC', 'USDC.e'] as string[],
  allowed_addresses: [] as string[],
  require_approval_above: null as number | null,
} as const;

/** Conservative gas cost estimates in POL for preflight balance checks. */
export const GAS_ESTIMATE_NATIVE_POL = 0.01;
export const GAS_ESTIMATE_ERC20_POL = 0.005;
