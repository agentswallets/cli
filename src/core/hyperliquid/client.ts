import { HttpTransport, InfoClient, ExchangeClient } from '@nktkas/hyperliquid';
import { Wallet } from 'ethers';

/** Create a read-only InfoClient (no auth needed). */
export function createInfoClient(): InfoClient {
  return new InfoClient({ transport: new HttpTransport() });
}

/**
 * Create an authenticated ExchangeClient from a decrypted private key buffer.
 * Caller MUST call cleanup() when done to zero-out the key.
 */
export function createExchangeClient(pkHex: string): { exchange: ExchangeClient; wallet: Wallet } {
  const wallet = new Wallet(pkHex);
  const exchange = new ExchangeClient({ transport: new HttpTransport(), wallet });
  return { exchange, wallet };
}
