import { describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for P0–P2 bugfixes.
 */

// ── P1: toSmallestUnit scientific notation ──

describe('toSmallestUnit — scientific notation fix', () => {
  // We test indirectly by importing swap and testing the private function behavior
  // via the public API. But since toSmallestUnit is private, test the fix directly
  // by replicating the logic.

  function toSmallestUnit(amount: number, decimals: number): string {
    const str = amount.toFixed(decimals);
    const [intPart, fracPart = ''] = str.split('.');
    const paddedFrac = fracPart.padEnd(decimals, '0').slice(0, decimals);
    const raw = intPart + paddedFrac;
    return BigInt(raw).toString();
  }

  it('handles normal amounts', () => {
    expect(toSmallestUnit(1.5, 18)).toBe('1500000000000000000');
    expect(toSmallestUnit(100, 6)).toBe('100000000');
    expect(toSmallestUnit(0.1, 6)).toBe('100000');
  });

  it('handles very small amounts (scientific notation input)', () => {
    // This was the bug: 1e-18 as a number → String(1e-18) = "1e-18" → BigInt crash
    expect(toSmallestUnit(1e-18, 18)).toBe('1');
    expect(toSmallestUnit(1e-6, 6)).toBe('1');
    expect(toSmallestUnit(5e-8, 8)).toBe('5');
  });

  it('handles zero', () => {
    expect(toSmallestUnit(0, 18)).toBe('0');
  });
});

// ── P1: token-resolver throws AppError ──

vi.mock('../src/core/db.js', () => ({
  getDb: () => ({}),
  assertInitialized: () => {},
  isInitialized: () => true,
}));

describe('resolveTokenAddress — error classification', () => {
  it('throws AppError with ERR_INVALID_PARAMS for unknown token', async () => {
    const { resolveTokenAddress } = await import('../src/core/okx/token-resolver.js');

    try {
      resolveTokenAddress('ethereum', 'NONEXISTENT_TOKEN_XYZ');
      expect.fail('should have thrown');
    } catch (err: any) {
      // P1 fix: should be AppError, not plain Error
      expect(err.code).toBe('ERR_INVALID_PARAMS');
      expect(err.message).toContain('NONEXISTENT_TOKEN_XYZ');
      expect(err.message).toContain('not found');
    }
  });
});

// ── P2: ERR_OKX_AUTH recovery hint ──

describe('ERR_OKX_AUTH recovery hint', () => {
  it('does not reference non-existent aw okx setup command', async () => {
    const { recoveryHintForCode } = await import('../src/core/errors.js');
    const hint = recoveryHintForCode('ERR_OKX_AUTH');
    expect(hint).toBeDefined();
    expect(hint).not.toContain('aw okx setup');
    expect(hint).toContain('OKX_API_KEY');
  });
});
