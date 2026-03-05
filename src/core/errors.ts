import type { AppErrorCode } from './types.js';

export class AppError extends Error {
  code: AppErrorCode;
  details: Record<string, unknown>;

  constructor(code: AppErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details ?? {};
  }
}

export function exitCodeForError(code: AppErrorCode): number {
  const authErrors: AppErrorCode[] = ['ERR_NEED_UNLOCK', 'ERR_AUTH_FAILED', 'ERR_POLYMARKET_AUTH', 'ERR_OKX_AUTH'];
  if (authErrors.includes(code)) return 3;
  const systemErrors: AppErrorCode[] = [
    'ERR_RPC_UNAVAILABLE',
    'ERR_POLYMARKET_FAILED',
    'ERR_POLYMARKET_TIMEOUT',
    'ERR_TX_FAILED',
    'ERR_OKX_API_FAILED',
    'ERR_OKX_TIMEOUT',
    'ERR_OKX_QUOTE_FAILED',
    'ERR_SWAP_FAILED',
    'ERR_BRIDGE_FAILED',
    'ERR_HL_API_FAILED',
    'ERR_HL_ORDER_FAILED',
    'ERR_HL_BUILDER_FEE_FAILED',
    'ERR_INTERNAL'
  ];
  return systemErrors.includes(code) ? 2 : 1;
}

const RECOVERY_HINTS: Partial<Record<AppErrorCode, string>> = {
  ERR_NOT_INITIALIZED: 'Run `aw init` to initialize.',
  ERR_NEED_UNLOCK: 'Run `aw unlock` to start a session.',
  ERR_AUTH_FAILED: 'Check master password. Run `aw unlock` to retry.',
  ERR_POLYMARKET_AUTH: 'Check Polymarket wallet credentials. Ensure wallet has been used with Polymarket before.',
  ERR_WALLET_NOT_FOUND: 'Check wallet name or address with `aw wallet list`.',
  ERR_INSUFFICIENT_FUNDS: 'Top up wallet. Check balance with `aw wallet balance <name>`.',
  ERR_RPC_UNAVAILABLE: 'Check network or set AW_RPC_URL. Retry with `--timeout <ms>`.',
  ERR_DAILY_LIMIT_EXCEEDED: 'Wait for daily reset (UTC midnight) or raise limit with `aw policy set`.',
  ERR_PER_TX_LIMIT_EXCEEDED: 'Reduce amount or raise per-tx limit with `aw policy set`.',
  ERR_TX_COUNT_LIMIT_EXCEEDED: 'Wait for daily reset (UTC midnight) or raise max_tx_per_day.',
  ERR_APPROVAL_THRESHOLD_EXCEEDED: 'Reduce amount below the approval threshold.',
  ERR_TOKEN_NOT_ALLOWED: 'Token not in allowlist. Update policy with `aw policy set`.',
  ERR_ADDRESS_NOT_ALLOWED: 'Address not in allowlist. Update policy with `aw policy set`.',
  ERR_INVALID_PARAMS: 'Check command arguments and input requirements.',
  ERR_OKX_AUTH: 'Check OKX API credentials. Set OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE env vars.',
  ERR_OKX_API_FAILED: 'OKX API returned an error. Check parameters and try again.',
  ERR_OKX_TIMEOUT: 'OKX API request timed out. Check network and retry.',
  ERR_OKX_QUOTE_FAILED: 'Failed to get swap/bridge quote. Check token pair and amount.',
  ERR_SWAP_FAILED: 'Swap transaction failed on-chain. Check token allowance and balance.',
  ERR_BRIDGE_FAILED: 'Bridge transaction failed. Check source chain balance and try again.',
  ERR_HL_API_FAILED: 'Hyperliquid API error. Check network and try again.',
  ERR_HL_ORDER_FAILED: 'Hyperliquid order failed. Check asset, size, and margin.',
  ERR_HL_INVALID_ASSET: 'Unknown Hyperliquid asset. Use `aw perp assets` to see available assets.',
  ERR_HL_INSUFFICIENT_MARGIN: 'Insufficient margin. Deposit more USDC to Hyperliquid or reduce position size.',
  ERR_HL_BUILDER_FEE_FAILED: 'Failed to approve builder fee. Try again.'
};

export function recoveryHintForCode(code: AppErrorCode): string | undefined {
  return RECOVERY_HINTS[code];
}
