import { describe, expect, it } from 'vitest';
import { requireAddress, requirePositiveNumber, requirePositiveInt } from '../src/util/validate.js';

describe('validate', () => {
  describe('requireAddress', () => {
    it('accepts valid checksummed address', () => {
      expect(requireAddress('0x1111111111111111111111111111111111111111')).toBeTruthy();
    });

    it('accepts valid lowercase address', () => {
      expect(requireAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBeTruthy();
    });

    it('rejects invalid address', () => {
      expect(() => requireAddress('not-an-address')).toThrow(/Invalid address/);
    });

    it('rejects empty string', () => {
      expect(() => requireAddress('')).toThrow(/Invalid address/);
    });
  });

  describe('requirePositiveNumber', () => {
    it('accepts positive number string', () => {
      expect(requirePositiveNumber('10.5', 'amount')).toBe(10.5);
    });

    it('accepts positive number', () => {
      expect(requirePositiveNumber(42, 'amount')).toBe(42);
    });

    it('rejects zero', () => {
      expect(() => requirePositiveNumber('0', 'amount')).toThrow(/Invalid amount/);
    });

    it('rejects negative', () => {
      expect(() => requirePositiveNumber('-5', 'amount')).toThrow(/Invalid amount/);
    });

    it('rejects non-numeric string', () => {
      expect(() => requirePositiveNumber('abc', 'amount')).toThrow(/Invalid amount/);
    });
  });

  describe('requirePositiveInt', () => {
    it('accepts positive integer string', () => {
      expect(requirePositiveInt('10', 'limit')).toBe(10);
    });

    it('accepts positive integer number', () => {
      expect(requirePositiveInt(42, 'limit')).toBe(42);
    });

    it('rejects zero', () => {
      expect(() => requirePositiveInt('0', 'limit')).toThrow(/positive integer/);
    });

    it('rejects negative', () => {
      expect(() => requirePositiveInt('-1', 'limit')).toThrow(/positive integer/);
    });

    it('rejects float', () => {
      expect(() => requirePositiveInt('3.5', 'limit')).toThrow(/positive integer/);
    });

    it('rejects non-numeric', () => {
      expect(() => requirePositiveInt('abc', 'limit')).toThrow(/positive integer/);
    });

    it('rejects value exceeding max', () => {
      expect(() => requirePositiveInt('101', 'limit', 100)).toThrow(/must not exceed 100/);
    });

    it('accepts value equal to max', () => {
      expect(requirePositiveInt('100', 'limit', 100)).toBe(100);
    });
  });
});
