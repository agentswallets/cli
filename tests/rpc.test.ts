import { describe, expect, it } from 'vitest';
import { mapRpcError } from '../src/core/rpc.js';
import { AppError } from '../src/core/errors.js';

describe('mapRpcError', () => {
  it('maps insufficient funds to ERR_INSUFFICIENT_FUNDS', () => {
    try {
      mapRpcError(new Error('insufficient funds for transfer'));
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('ERR_INSUFFICIENT_FUNDS');
      return;
    }
    expect.fail('should have thrown');
  });

  it('maps timeout to ERR_RPC_UNAVAILABLE', () => {
    try {
      mapRpcError(new Error('request timeout'));
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('ERR_RPC_UNAVAILABLE');
      return;
    }
    expect.fail('should have thrown');
  });

  it('maps ECONN to ERR_RPC_UNAVAILABLE', () => {
    try {
      mapRpcError(new Error('ECONNREFUSED 127.0.0.1:8545'));
    } catch (e) {
      expect((e as AppError).code).toBe('ERR_RPC_UNAVAILABLE');
      return;
    }
    expect.fail('should have thrown');
  });

  it('maps ENOTFOUND to ERR_RPC_UNAVAILABLE', () => {
    try {
      mapRpcError(new Error('getaddrinfo ENOTFOUND example.com'));
    } catch (e) {
      expect((e as AppError).code).toBe('ERR_RPC_UNAVAILABLE');
      return;
    }
    expect.fail('should have thrown');
  });

  it('maps 503 to ERR_RPC_UNAVAILABLE', () => {
    try {
      mapRpcError(new Error('server returned 503'));
    } catch (e) {
      expect((e as AppError).code).toBe('ERR_RPC_UNAVAILABLE');
      return;
    }
    expect.fail('should have thrown');
  });

  it('maps 429 to ERR_RPC_UNAVAILABLE', () => {
    try {
      mapRpcError(new Error('rate limited 429'));
    } catch (e) {
      expect((e as AppError).code).toBe('ERR_RPC_UNAVAILABLE');
      return;
    }
    expect.fail('should have thrown');
  });

  it('maps network error to ERR_RPC_UNAVAILABLE', () => {
    try {
      mapRpcError(new Error('network error'));
    } catch (e) {
      expect((e as AppError).code).toBe('ERR_RPC_UNAVAILABLE');
      return;
    }
    expect.fail('should have thrown');
  });

  it('maps unknown errors to ERR_INTERNAL', () => {
    try {
      mapRpcError(new Error('something completely unknown'));
    } catch (e) {
      expect((e as AppError).code).toBe('ERR_INTERNAL');
      return;
    }
    expect.fail('should have thrown');
  });

  it('handles non-Error objects', () => {
    try {
      mapRpcError('string error');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('ERR_INTERNAL');
      return;
    }
    expect.fail('should have thrown');
  });
});
