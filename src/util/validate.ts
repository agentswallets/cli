import { isAddress } from 'ethers';
import { z } from 'zod';
import { AppError } from '../core/errors.js';

export const amountSchema = z.coerce.number().finite().positive();

export function requireAddress(address: string): string {
  if (!isAddress(address)) {
    throw new AppError('ERR_INVALID_PARAMS', `Invalid address: ${address}`);
  }
  return address;
}

export function requirePositiveNumber(input: unknown, field: string): number {
  const parsed = amountSchema.safeParse(input);
  if (!parsed.success) throw new AppError('ERR_INVALID_PARAMS', `Invalid ${field}`);
  return parsed.data;
}

export function requirePositiveInt(input: unknown, field: string, max = 10000): number {
  const n = Number(input);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new AppError('ERR_INVALID_PARAMS', `Invalid ${field}: must be a positive integer`);
  }
  if (n > max) {
    throw new AppError('ERR_INVALID_PARAMS', `Invalid ${field}: must not exceed ${max}`);
  }
  return n;
}
