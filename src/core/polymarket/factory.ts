import type { PolymarketAdapter } from './adapter.js';
import { SdkPolymarketAdapter } from './sdk-adapter.js';

let singleton: PolymarketAdapter | null = null;

export function getPolymarketAdapter(): PolymarketAdapter {
  if (!singleton) {
    singleton = new SdkPolymarketAdapter();
  }
  return singleton;
}

export function __setPolymarketAdapterForTests(adapter: PolymarketAdapter | null): void {
  singleton = adapter;
}
