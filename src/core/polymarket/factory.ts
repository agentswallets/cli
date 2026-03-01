import type { PolymarketAdapter } from './adapter.js';
import { CliPolymarketAdapter } from './cli-adapter.js';

let singleton: PolymarketAdapter | null = null;

export function getPolymarketAdapter(): PolymarketAdapter {
  if (!singleton) {
    singleton = new CliPolymarketAdapter();
  }
  return singleton;
}

export function __setPolymarketAdapterForTests(adapter: PolymarketAdapter | null): void {
  singleton = adapter;
}
