import { describe, expect, it } from 'vitest';
import { jsonError, jsonOk } from '../src/core/output.js';

describe('output envelope', () => {
  it('success envelope', () => {
    const out = jsonOk({ a: 1 }, 'req_test');
    expect(out).toEqual({
      ok: true,
      data: { a: 1 },
      error: null,
      meta: { request_id: 'req_test' }
    });
  });

  it('success envelope keeps strict shape', () => {
    const out = jsonOk({ status: 'ok' }, 'req_test');
    expect(out).toEqual({
      ok: true,
      data: { status: 'ok' },
      error: null,
      meta: { request_id: 'req_test' }
    });
  });

  it('error envelope', () => {
    const out = jsonError('ERR_PER_TX_LIMIT_EXCEEDED', 'blocked', { limit: 1 }, 'req_test');
    expect(out).toEqual({
      ok: false,
      data: null,
      error: { code: 'ERR_PER_TX_LIMIT_EXCEEDED', message: 'blocked', details: { limit: 1 }, recovery_hint: 'Reduce amount or raise per-tx limit with `aw policy set`.' },
      meta: { request_id: 'req_test' }
    });
  });

  it('passes through ERR_WALLET_NOT_FOUND directly', () => {
    const out = jsonError('ERR_WALLET_NOT_FOUND', 'wallet_id not found: w1', {}, 'req_test');
    expect(out.error.code).toBe('ERR_WALLET_NOT_FOUND');
  });

  it('passes through ERR_MARKET_NOT_FOUND directly', () => {
    const out = jsonError('ERR_MARKET_NOT_FOUND', 'market not found', {}, 'req_test');
    expect(out.error.code).toBe('ERR_MARKET_NOT_FOUND');
  });

  it('passes through ERR_INVALID_AMOUNT directly', () => {
    const out = jsonError('ERR_INVALID_AMOUNT', 'invalid amount', {}, 'req_test');
    expect(out.error.code).toBe('ERR_INVALID_AMOUNT');
  });
});
