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
  const authErrors: AppErrorCode[] = ['ERR_NEED_UNLOCK', 'ERR_AUTH_FAILED', 'ERR_POLYMARKET_AUTH'];
  if (authErrors.includes(code)) return 3;
  const systemErrors: AppErrorCode[] = [
    'ERR_RPC_UNAVAILABLE',
    'ERR_POLYMARKET_CLI_NOT_FOUND',
    'ERR_POLYMARKET_FAILED',
    'ERR_POLYMARKET_TIMEOUT',
    'ERR_TX_FAILED',
    'ERR_INTERNAL'
  ];
  return systemErrors.includes(code) ? 2 : 1;
}

const RECOVERY_HINTS: Partial<Record<AppErrorCode, string>> = {
  ERR_NOT_INITIALIZED: 'Run `aw init` to initialize.',
  ERR_NEED_UNLOCK: 'Run `aw unlock` to start a session.',
  ERR_AUTH_FAILED: 'Check master password. Run `aw unlock` to retry.',
  ERR_POLYMARKET_AUTH: 'Set POLYMARKET_PRIVATE_KEY or check Polymarket credentials.',
  ERR_WALLET_NOT_FOUND: 'Check wallet name or address with `aw wallet list`.',
  ERR_INSUFFICIENT_FUNDS: 'Top up wallet. Check balance with `aw wallet balance <name>`.',
  ERR_RPC_UNAVAILABLE: 'Check network or set AW_RPC_URL. Retry with `--timeout <ms>`.',
  ERR_DAILY_LIMIT_EXCEEDED: 'Wait for daily reset (UTC midnight) or raise limit with `aw policy set`.',
  ERR_PER_TX_LIMIT_EXCEEDED: 'Reduce amount or raise per-tx limit with `aw policy set`.',
  ERR_TX_COUNT_LIMIT_EXCEEDED: 'Wait for daily reset (UTC midnight) or raise max_tx_per_day.',
  ERR_APPROVAL_THRESHOLD_EXCEEDED: 'Reduce amount below the approval threshold.',
  ERR_POLYMARKET_CLI_NOT_FOUND: 'Install polymarket-cli and ensure it is in PATH.',
  ERR_TOKEN_NOT_ALLOWED: 'Token not in allowlist. Update policy with `aw policy set`.',
  ERR_ADDRESS_NOT_ALLOWED: 'Address not in allowlist. Update policy with `aw policy set`.',
  ERR_INVALID_PARAMS: 'Check command arguments and input requirements.'
};

export function recoveryHintForCode(code: AppErrorCode): string | undefined {
  return RECOVERY_HINTS[code];
}
