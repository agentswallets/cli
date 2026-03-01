import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '../src/core/policy-engine.js';
import type { PolicyConfig } from '../src/core/types.js';

const basePolicy: PolicyConfig = {
  daily_limit: 500,
  per_tx_limit: 100,
  max_tx_per_day: 5,
  allowed_tokens: ['USDC'],
  allowed_addresses: ['0x1111111111111111111111111111111111111111'],
  require_approval_above: null
};

describe('policy engine', () => {
  it('rejects token not allowed', () => {
    const d = evaluatePolicy({
      policy: basePolicy,
      token: 'POL',
      amount: 10,
      toAddress: '0x1111111111111111111111111111111111111111',
      stats: { todaySpent: 0, todayTxCount: 0 }
    });
    expect(d.status).toBe('denied');
    expect(d.status === 'denied' ? d.code : '').toBe('ERR_TOKEN_NOT_ALLOWED');
  });

  it('rejects address not allowed', () => {
    const d = evaluatePolicy({
      policy: basePolicy,
      token: 'USDC',
      amount: 10,
      toAddress: '0x2222222222222222222222222222222222222222',
      stats: { todaySpent: 0, todayTxCount: 0 }
    });
    expect(d.status).toBe('denied');
    expect(d.status === 'denied' ? d.code : '').toBe('ERR_ADDRESS_NOT_ALLOWED');
  });

  it('rejects policy limits', () => {
    const d = evaluatePolicy({
      policy: basePolicy,
      token: 'USDC',
      amount: 120,
      toAddress: '0x1111111111111111111111111111111111111111',
      stats: { todaySpent: 0, todayTxCount: 0 }
    });
    expect(d.status).toBe('denied');
    expect(d.status === 'denied' ? d.code : '').toBe('ERR_PER_TX_LIMIT_EXCEEDED');
  });

  it('rejects daily limit', () => {
    const d = evaluatePolicy({
      policy: basePolicy,
      token: 'USDC',
      amount: 10,
      toAddress: '0x1111111111111111111111111111111111111111',
      stats: { todaySpent: 495, todayTxCount: 0 }
    });
    expect(d.status).toBe('denied');
    expect(d.status === 'denied' ? d.code : '').toBe('ERR_DAILY_LIMIT_EXCEEDED');
  });

  it('rejects when max_tx_per_day exceeded', () => {
    const d = evaluatePolicy({
      policy: basePolicy,
      token: 'USDC',
      amount: 1,
      toAddress: '0x1111111111111111111111111111111111111111',
      stats: { todaySpent: 0, todayTxCount: 5 }
    });
    expect(d.status).toBe('denied');
    expect(d.status === 'denied' ? d.code : '').toBe('ERR_TX_COUNT_LIMIT_EXCEEDED');
  });

  it('allows when all limits are null (no policy)', () => {
    const d = evaluatePolicy({
      policy: {
        daily_limit: null,
        per_tx_limit: null,
        max_tx_per_day: null,
        allowed_tokens: [],
        allowed_addresses: [],
        require_approval_above: null
      },
      token: 'POL',
      amount: 999999,
      stats: { todaySpent: 0, todayTxCount: 0 }
    });
    expect(d.status).toBe('allowed');
  });

  it('allows exact boundary amount (per_tx_limit)', () => {
    const d = evaluatePolicy({
      policy: basePolicy,
      token: 'USDC',
      amount: 100,
      toAddress: '0x1111111111111111111111111111111111111111',
      stats: { todaySpent: 0, todayTxCount: 0 }
    });
    expect(d.status).toBe('allowed');
  });

  it('denies just above per_tx_limit boundary', () => {
    const d = evaluatePolicy({
      policy: basePolicy,
      token: 'USDC',
      amount: 100.000001,
      toAddress: '0x1111111111111111111111111111111111111111',
      stats: { todaySpent: 0, todayTxCount: 0 }
    });
    expect(d.status).toBe('denied');
  });

  it('handles floating point precision with toCents', () => {
    const d = evaluatePolicy({
      policy: { ...basePolicy, daily_limit: 0.3 },
      token: 'USDC',
      amount: 0.1,
      toAddress: '0x1111111111111111111111111111111111111111',
      stats: { todaySpent: 0.2, todayTxCount: 0 }
    });
    // 0.1 + 0.2 = 0.3 exactly — should be allowed (toCents avoids fp issues)
    expect(d.status).toBe('allowed');
  });

  it('normalizes lowercase token to uppercase for allowlist', () => {
    const d = evaluatePolicy({
      policy: { ...basePolicy, allowed_tokens: ['POL'] },
      token: 'pol',
      amount: 1,
      toAddress: '0x1111111111111111111111111111111111111111',
      stats: { todaySpent: 0, todayTxCount: 0 }
    });
    expect(d.status).toBe('allowed');
  });

  it('enforces require_approval_above threshold', () => {
    const d = evaluatePolicy({
      policy: { ...basePolicy, require_approval_above: 50 },
      token: 'USDC',
      amount: 60,
      toAddress: '0x1111111111111111111111111111111111111111',
      stats: { todaySpent: 0, todayTxCount: 0 }
    });
    expect(d.status).toBe('denied');
    expect(d.status === 'denied' ? d.code : '').toBe('ERR_APPROVAL_THRESHOLD_EXCEEDED');
  });

  it('allows amount at or below require_approval_above', () => {
    const d = evaluatePolicy({
      policy: { ...basePolicy, require_approval_above: 50 },
      token: 'USDC',
      amount: 50,
      toAddress: '0x1111111111111111111111111111111111111111',
      stats: { todaySpent: 0, todayTxCount: 0 }
    });
    expect(d.status).toBe('allowed');
  });

  it('per-token limits: POL spend does not affect USDC daily_limit evaluation', () => {
    const multiTokenPolicy: PolicyConfig = {
      daily_limit: 100,
      per_tx_limit: null,
      max_tx_per_day: null,
      allowed_tokens: ['POL', 'USDC'],
      allowed_addresses: [],
      require_approval_above: null
    };
    // POL has spent 90 today — USDC should still have its own independent 100 limit
    const usdcDecision = evaluatePolicy({
      policy: multiTokenPolicy,
      token: 'USDC',
      amount: 50,
      stats: { todaySpent: 0, todayTxCount: 0 } // USDC stats: 0 spent
    });
    expect(usdcDecision.status).toBe('allowed');

    const polDecision = evaluatePolicy({
      policy: multiTokenPolicy,
      token: 'POL',
      amount: 50,
      stats: { todaySpent: 90, todayTxCount: 5 } // POL stats: 90 spent
    });
    expect(polDecision.status).toBe('denied');
    expect(polDecision.status === 'denied' ? polDecision.code : '').toBe('ERR_DAILY_LIMIT_EXCEEDED');
  });

  it('per-token limits: both tokens can independently hit their daily limit', () => {
    const policy: PolicyConfig = {
      daily_limit: 50,
      per_tx_limit: null,
      max_tx_per_day: null,
      allowed_tokens: ['POL', 'USDC'],
      allowed_addresses: [],
      require_approval_above: null
    };
    // Both at 49 spent — both should allow 1 more
    expect(evaluatePolicy({
      policy, token: 'POL', amount: 1,
      stats: { todaySpent: 49, todayTxCount: 0 }
    }).status).toBe('allowed');

    expect(evaluatePolicy({
      policy, token: 'USDC', amount: 1,
      stats: { todaySpent: 49, todayTxCount: 0 }
    }).status).toBe('allowed');

    // Both at 50 spent — both should deny 1 more
    expect(evaluatePolicy({
      policy, token: 'POL', amount: 1,
      stats: { todaySpent: 50, todayTxCount: 0 }
    }).status).toBe('denied');

    expect(evaluatePolicy({
      policy, token: 'USDC', amount: 1,
      stats: { todaySpent: 50, todayTxCount: 0 }
    }).status).toBe('denied');
  });
});
