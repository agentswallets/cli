import { isAddress } from 'ethers';
import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import { AppError } from '../core/errors.js';

export const amountSchema = z.coerce.number().finite().positive();

export function requireAddress(address: string): string {
  if (!isAddress(address)) {
    throw new AppError('ERR_INVALID_PARAMS', `Invalid address: ${address}`);
  }
  return address;
}

export function requireSolanaAddress(address: string): string {
  try {
    // PublicKey constructor validates base58 encoding + 32-byte length.
    // Do NOT check isOnCurve — PDAs and program addresses are valid transfer targets.
    new PublicKey(address);
    return address;
  } catch {
    throw new AppError('ERR_INVALID_PARAMS', `Invalid Solana address: ${address}`);
  }
}

/** Validate address for the given chain type. */
export function requireChainAddress(address: string, chainType: 'evm' | 'solana'): string {
  if (chainType === 'solana') return requireSolanaAddress(address);
  return requireAddress(address);
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
