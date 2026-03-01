import type { PolicyConfig, PolicyDecision } from './types.js';

type SpendStats = {
  todaySpent: number;
  todayTxCount: number;
};

type EvalInput = {
  policy: PolicyConfig;
  token: string;
  amount: number;
  toAddress?: string;
  stats: SpendStats;
  skipSpendLimits?: boolean;
};

/** M-8: Avoid floating-point precision issues by converting to micro-units. */
function toMicroUnits(n: number): number {
  return Math.round(n * 1e6);
}

function normalizeToken(t: string): string {
  const upper = t.toUpperCase();
  return upper === 'USDC.E' ? 'USDC.e' : upper;
}

export function evaluatePolicy(input: EvalInput): PolicyDecision {
  const token = normalizeToken(input.token);
  const allowedTokens = input.policy.allowed_tokens.map(normalizeToken);
  if (allowedTokens.length > 0 && !allowedTokens.includes(token)) {
    return { status: 'denied', code: 'ERR_TOKEN_NOT_ALLOWED', message: `token ${token} is not allowed` };
  }

  if (input.toAddress) {
    const allowedAddresses = input.policy.allowed_addresses.map((x) => x.toLowerCase());
    if (allowedAddresses.length > 0 && !allowedAddresses.includes(input.toAddress.toLowerCase())) {
      return {
        status: 'denied',
        code: 'ERR_ADDRESS_NOT_ALLOWED',
        message: `address ${input.toAddress} is not allowed`
      };
    }
  }

  // Skip spend-related limits for non-spending operations (e.g. sell/withdraw)
  if (!input.skipSpendLimits) {
    if (input.policy.per_tx_limit != null && toMicroUnits(input.amount) > toMicroUnits(input.policy.per_tx_limit)) {
      return {
        status: 'denied',
        code: 'ERR_PER_TX_LIMIT_EXCEEDED',
        message: `amount exceeds per-tx limit ${input.policy.per_tx_limit}`,
        details: { limit: String(input.policy.per_tx_limit), amount: String(input.amount) }
      };
    }

    if (input.policy.daily_limit != null && toMicroUnits(input.stats.todaySpent + input.amount) > toMicroUnits(input.policy.daily_limit)) {
      return {
        status: 'denied',
        code: 'ERR_DAILY_LIMIT_EXCEEDED',
        message: `amount exceeds daily limit ${input.policy.daily_limit}`,
        details: {
          limit: String(input.policy.daily_limit),
          current_spent: String(input.stats.todaySpent),
          amount: String(input.amount)
        }
      };
    }

    // L-2: Enforce require_approval_above threshold
    if (input.policy.require_approval_above != null && toMicroUnits(input.amount) > toMicroUnits(input.policy.require_approval_above)) {
      return {
        status: 'denied',
        code: 'ERR_APPROVAL_THRESHOLD_EXCEEDED',
        message: `amount exceeds approval threshold ${input.policy.require_approval_above}`,
        details: { threshold: String(input.policy.require_approval_above), amount: String(input.amount) }
      };
    }
  }

  if (input.policy.max_tx_per_day != null && input.stats.todayTxCount + 1 > input.policy.max_tx_per_day) {
    return {
      status: 'denied',
      code: 'ERR_TX_COUNT_LIMIT_EXCEEDED',
      message: `tx count exceeds max_tx_per_day ${input.policy.max_tx_per_day}`,
      details: { limit: input.policy.max_tx_per_day, current_count: input.stats.todayTxCount }
    };
  }

  return { status: 'allowed' };
}
