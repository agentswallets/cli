import { describe, expect, it } from 'vitest';
import { validateSigningIntent } from '../src/security/signing-validator.js';

describe('signing validator', () => {
  it('passes when all params match', () => {
    expect(() => validateSigningIntent({
      userTo: '0xaaaa', userChainId: 137, txTo: '0xaaaa', txChainId: 137
    })).not.toThrow();
  });

  it('passes with case-insensitive address comparison', () => {
    expect(() => validateSigningIntent({
      userTo: '0xAAAA', userChainId: 137, txTo: '0xaaaa', txChainId: 137
    })).not.toThrow();
  });

  it('throws on chain ID mismatch', () => {
    expect(() => validateSigningIntent({
      userTo: '0xaaaa', userChainId: 137, txTo: '0xaaaa', txChainId: 1
    })).toThrow('Chain ID mismatch');
  });

  it('throws on address mismatch', () => {
    expect(() => validateSigningIntent({
      userTo: '0xaaaa', userChainId: 137, txTo: '0xbbbb', txChainId: 137
    })).toThrow('Destination address mismatch');
  });

  it('skips address check when skipAddressCheck is true', () => {
    expect(() => validateSigningIntent({
      userTo: '0xaaaa', userChainId: 137, txTo: '0xbbbb', txChainId: 137,
      skipAddressCheck: true
    })).not.toThrow();
  });

  it('still checks chainId even with skipAddressCheck', () => {
    expect(() => validateSigningIntent({
      userTo: '0xaaaa', userChainId: 137, txTo: '0xbbbb', txChainId: 1,
      skipAddressCheck: true
    })).toThrow('Chain ID mismatch');
  });

  // ── Malformed input tests ──

  it('handles empty string addresses', () => {
    // Both empty → match (case-insensitive '' === '')
    expect(() => validateSigningIntent({
      userTo: '', userChainId: 137, txTo: '', txChainId: 137
    })).not.toThrow();
  });

  it('throws on empty vs non-empty address', () => {
    expect(() => validateSigningIntent({
      userTo: '', userChainId: 137, txTo: '0xaaaa', txChainId: 137
    })).toThrow('Destination address mismatch');
  });

  it('handles very long addresses without crashing', () => {
    const longAddr = '0x' + 'a'.repeat(1000);
    expect(() => validateSigningIntent({
      userTo: longAddr, userChainId: 137, txTo: longAddr, txChainId: 137
    })).not.toThrow();
  });

  it('throws on addresses differing only in non-hex characters', () => {
    expect(() => validateSigningIntent({
      userTo: '0xGGGG', userChainId: 137, txTo: '0xgggg', txChainId: 137
    })).not.toThrow(); // toLowerCase matches — non-hex chars are still comparable
  });

  it('handles chainId 0', () => {
    expect(() => validateSigningIntent({
      userTo: '0xaaaa', userChainId: 0, txTo: '0xaaaa', txChainId: 0
    })).not.toThrow();
  });

  it('throws on chainId 0 vs 1', () => {
    expect(() => validateSigningIntent({
      userTo: '0xaaaa', userChainId: 0, txTo: '0xaaaa', txChainId: 1
    })).toThrow('Chain ID mismatch');
  });
});
