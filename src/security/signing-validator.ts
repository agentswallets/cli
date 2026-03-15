import { AppError } from '../core/errors.js';

/**
 * Validates that the transaction parameters match the user's declared intent.
 * Throws ERR_PREFLIGHT_FAILED if there's a mismatch.
 */
export function validateSigningIntent(params: {
  userTo: string;
  userChainId: number;
  txTo: string;
  txChainId: number;
  skipAddressCheck?: boolean;  // For swap/bridge where txTo is a router contract
}): void {
  // 1. Verify chainId matches
  if (params.userChainId !== params.txChainId) {
    throw new AppError('ERR_PREFLIGHT_FAILED',
      `Chain ID mismatch: user intent ${params.userChainId}, transaction ${params.txChainId}`,
      { userChainId: params.userChainId, txChainId: params.txChainId }
    );
  }

  // 2. Verify destination address matches (unless skipAddressCheck)
  if (!params.skipAddressCheck) {
    if (params.userTo.toLowerCase() !== params.txTo.toLowerCase()) {
      throw new AppError('ERR_PREFLIGHT_FAILED',
        `Destination address mismatch: user intent ${params.userTo}, transaction ${params.txTo}`,
        { userTo: params.userTo, txTo: params.txTo }
      );
    }
  }
}
