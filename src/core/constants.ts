export const APP_NAME = 'agentswallets';

/** @deprecated Use `getChain('polygon').chainId` from chains.ts */
export const CHAIN_ID = 137;
/** @deprecated Use `getChain('polygon').name` from chains.ts */
export const CHAIN_NAME = 'Polygon';
/** @deprecated Use `getChain('polygon').defaultRpcUrls` from chains.ts */
export const DEFAULT_RPC_URL = 'https://polygon.drpc.org,https://polygon-bor-rpc.publicnode.com,https://1rpc.io/matic';
/** @deprecated Use `resolveToken(chain, 'USDC').address` from chains.ts */
export const USDC_ADDRESS = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
/** @deprecated Use `resolveToken(chain, 'USDC.e').address` from chains.ts */
export const USDC_LEGACY_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

// S7: Hard cap at 15 minutes for financial CLI security, minimum 1 minute
export const SESSION_TTL_MINUTES = Math.max(1, Math.min(Number(process.env.AW_SESSION_TTL_MINUTES) || 15, 15));

/** Default policy applied to every newly created wallet — safe-by-default limits. */
export const DEFAULT_POLICY = {
  per_tx_limit: 100,
  daily_limit: 500,
  max_tx_per_day: 20,
  allowed_tokens: ['ETH', 'USDC', 'USDT'] as string[],
  allowed_addresses: [] as string[],
  require_approval_above: null as number | null,
} as const;

/** @deprecated Use `chain.gasEstimateNative` from chains.ts */
export const GAS_ESTIMATE_NATIVE_POL = 0.01;
/** @deprecated Use `chain.gasEstimateErc20` from chains.ts */
export const GAS_ESTIMATE_ERC20_POL = 0.005;

/** Minimum stablecoin balance worth draining (below this = dust). */
export const STABLECOIN_DUST_THRESHOLD = 0.01;
