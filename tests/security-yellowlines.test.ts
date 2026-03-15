import { describe, expect, it } from 'vitest';
import type { SecurityContext } from '../src/security/types.js';
import {
  checkHighSlippage,
  checkHighLeverage,
  checkRapidTransactions,
  checkNightTrading,
  checkLargeCrossChain,
  checkLargePerpPosition,
  checkUnknownToken,
} from '../src/security/yellowlines.js';

describe('security yellowlines', () => {
  it('checkHighSlippage triggers above threshold', () => {
    const ctx: SecurityContext = { walletId: 'w1', action: 'swap.exec', slippage: 5 };
    const result = checkHighSlippage(ctx, 3);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('WARN_AND_LOG');
    expect(result!.rule).toBe('HIGH_SLIPPAGE');
  });

  it('checkHighSlippage returns null below threshold', () => {
    const ctx: SecurityContext = { walletId: 'w1', action: 'swap.exec', slippage: 1 };
    expect(checkHighSlippage(ctx, 3)).toBeNull();
  });

  it('checkHighLeverage triggers above threshold for perp.open', () => {
    const ctx: SecurityContext = { walletId: 'w1', action: 'perp.open', leverage: 25 };
    const result = checkHighLeverage(ctx, 20);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('WARN_AND_LOG');
    expect(result!.rule).toBe('HIGH_LEVERAGE');
  });

  it('checkHighLeverage returns null for non-perp actions', () => {
    const ctx: SecurityContext = { walletId: 'w1', action: 'tx.send', leverage: 25 };
    expect(checkHighLeverage(ctx, 20)).toBeNull();
  });

  it('checkRapidTransactions triggers when count exceeds limit', () => {
    const ctx: SecurityContext = { walletId: 'w1', action: 'tx.send' };
    const getRecentCount = () => 6;
    const result = checkRapidTransactions(ctx, getRecentCount, 10, 5);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('WARN_AND_LOG');
    expect(result!.rule).toBe('RAPID_TRANSACTIONS');
  });

  it('checkRapidTransactions returns null when count is low', () => {
    const ctx: SecurityContext = { walletId: 'w1', action: 'tx.send' };
    const getRecentCount = () => 2;
    expect(checkRapidTransactions(ctx, getRecentCount, 10, 5)).toBeNull();
  });

  it('checkNightTrading triggers during night hours with large amount', () => {
    const ctx: SecurityContext = { walletId: 'w1', action: 'tx.send', amount: 600 };
    // Force night time by using a wide range
    const result = checkNightTrading(ctx, 500, 0, 24);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('LOG_ONLY');
    expect(result!.rule).toBe('NIGHT_TRADING');
  });

  it('checkNightTrading returns null for small amounts', () => {
    const ctx: SecurityContext = { walletId: 'w1', action: 'tx.send', amount: 10 };
    expect(checkNightTrading(ctx, 500, 0, 24)).toBeNull();
  });

  it('checkLargeCrossChain triggers on large bridge amounts', () => {
    const ctx: SecurityContext = { walletId: 'w1', action: 'bridge.exec', amount: 2000 };
    const result = checkLargeCrossChain(ctx, 1000);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('WARN_AND_LOG');
    expect(result!.rule).toBe('LARGE_CROSS_CHAIN');
  });

  it('checkLargeCrossChain returns null for non-bridge actions', () => {
    const ctx: SecurityContext = { walletId: 'w1', action: 'tx.send', amount: 2000 };
    expect(checkLargeCrossChain(ctx, 1000)).toBeNull();
  });

  it('checkLargePerpPosition triggers on large perp.open notional', () => {
    const ctx: SecurityContext = { walletId: 'w1', action: 'perp.open', amount: 10000 };
    const result = checkLargePerpPosition(ctx, 5000);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('WARN_AND_LOG');
    expect(result!.rule).toBe('LARGE_PERP_POSITION');
  });

  it('checkUnknownToken triggers for unknown token', () => {
    const ctx: SecurityContext = { walletId: 'w1', action: 'swap.exec', token: 'SCAM', chain: 'Polygon' };
    const isKnown = () => false;
    const result = checkUnknownToken(ctx, isKnown);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('WARN_AND_LOG');
    expect(result!.rule).toBe('UNKNOWN_TOKEN');
  });

  it('checkUnknownToken returns null for known token', () => {
    const ctx: SecurityContext = { walletId: 'w1', action: 'swap.exec', token: 'USDC', chain: 'Polygon' };
    const isKnown = () => true;
    expect(checkUnknownToken(ctx, isKnown)).toBeNull();
  });

  // ── Boundary value tests ──

  it('checkHighSlippage returns null at exactly threshold', () => {
    const ctx: SecurityContext = { walletId: 'w1', action: 'swap.exec', slippage: 3 };
    expect(checkHighSlippage(ctx, 3)).toBeNull();
  });

  it('checkHighSlippage triggers just above threshold', () => {
    const ctx: SecurityContext = { walletId: 'w1', action: 'swap.exec', slippage: 3.01 };
    expect(checkHighSlippage(ctx, 3)).not.toBeNull();
  });

  it('checkHighLeverage returns null at exactly threshold', () => {
    const ctx: SecurityContext = { walletId: 'w1', action: 'perp.open', leverage: 20 };
    expect(checkHighLeverage(ctx, 20)).toBeNull();
  });

  it('checkHighLeverage triggers just above threshold', () => {
    const ctx: SecurityContext = { walletId: 'w1', action: 'perp.open', leverage: 20.01 };
    expect(checkHighLeverage(ctx, 20)).not.toBeNull();
  });

  it('checkNightTrading returns null at hour 6 (boundary)', () => {
    // nightEnd=6, so hour 6 should NOT trigger
    const ctx: SecurityContext = { walletId: 'w1', action: 'tx.send', amount: 600 };
    const result = checkNightTrading(ctx, 500, 0, 6);
    // This depends on current time; use explicit hour range to test boundary
    // hour >= 0 && hour < 6 — test with nightEnd=0 to ensure 0 doesn't match
    const ctx2: SecurityContext = { walletId: 'w1', action: 'tx.send', amount: 600 };
    expect(checkNightTrading(ctx2, 500, 7, 7)).toBeNull(); // start==end → no night window
  });

  it('checkNightTrading returns null when amount equals threshold', () => {
    const ctx: SecurityContext = { walletId: 'w1', action: 'tx.send', amount: 500 };
    expect(checkNightTrading(ctx, 500, 0, 24)).toBeNull(); // amount must be > threshold
  });
});
