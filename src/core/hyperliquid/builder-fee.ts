import type { ExchangeClient } from '@nktkas/hyperliquid';
import { getSetting, setSetting } from '../settings.js';
import { HL_BUILDER_ADDRESS, HL_MAX_FEE_RATE } from './constants.js';
import { AppError } from '../errors.js';

/** Settings key for tracking builder fee approval per wallet address. */
function approvalKey(address: string): string {
  return `hl_builder_approved_${address.toLowerCase()}`;
}

/** Check if builder fee has been approved for this wallet address. */
export function isBuilderFeeApproved(address: string): boolean {
  return getSetting(approvalKey(address)) === '1';
}

/**
 * Approve builder fee if not already approved.
 * Must be called with the user's main wallet (not an agent wallet).
 */
export async function ensureBuilderFeeApproved(exchange: ExchangeClient, address: string): Promise<void> {
  if (isBuilderFeeApproved(address)) return;

  try {
    await exchange.approveBuilderFee({
      maxFeeRate: HL_MAX_FEE_RATE,
      builder: HL_BUILDER_ADDRESS,
    });
    setSetting(approvalKey(address), '1');
  } catch (err) {
    throw new AppError(
      'ERR_HL_BUILDER_FEE_FAILED',
      `Failed to approve builder fee: ${(err as Error).message}`,
    );
  }
}
