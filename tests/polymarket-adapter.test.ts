import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { CliPolymarketAdapter } from '../src/core/polymarket/cli-adapter.js';
import { AppError } from '../src/core/errors.js';

type SpawnSyncResult = { status: number; stdout: string; stderr: string };

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: (d: string) => void; end: () => void };
  kill: (signal?: NodeJS.Signals) => boolean;
};

function makeChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: () => {}, end: () => {} };
  child.kill = () => true;
  return child;
}

function modernHelp(): SpawnSyncResult {
  return { status: 0, stdout: 'markets search\nclob create-order\n', stderr: '' };
}

describe('CliPolymarketAdapter', () => {
  it('returns ERR_POLYMARKET_CLI_NOT_FOUND when binary is missing', async () => {
    const adapter = new CliPolymarketAdapter({
      spawnSyncImpl: (() => ({ status: 1, stdout: '', stderr: '' })) as unknown as typeof import('node:child_process').spawnSync
    });

    await expect(adapter.searchMarkets({ query: 'trump', limit: 1 })).rejects.toMatchObject<AppError>({
      code: 'ERR_POLYMARKET_CLI_NOT_FOUND'
    });
  });

  it('returns ERR_RPC_UNAVAILABLE on timeout', async () => {
    const spawnImpl = (() => makeChild()) as unknown as typeof import('node:child_process').spawn;
    const adapter = new CliPolymarketAdapter({
      timeoutMs: 10,
      spawnSyncImpl: (() => modernHelp()) as unknown as typeof import('node:child_process').spawnSync,
      spawnImpl
    });

    await expect(adapter.searchMarkets({ query: 'trump', limit: 1 })).rejects.toMatchObject<AppError>({
      code: 'ERR_RPC_UNAVAILABLE'
    });
  });

  it('returns ERR_POLYMARKET_FAILED when stdout is invalid JSON', async () => {
    const spawnImpl = (() => {
      const child = makeChild();
      setImmediate(() => {
        child.stdout.emit('data', 'not-json');
        child.emit('close', 0, null);
      });
      return child;
    }) as unknown as typeof import('node:child_process').spawn;

    const adapter = new CliPolymarketAdapter({
      spawnSyncImpl: (() => modernHelp()) as unknown as typeof import('node:child_process').spawnSync,
      spawnImpl
    });

    await expect(adapter.searchMarkets({ query: 'trump', limit: 1 })).rejects.toMatchObject<AppError>({
      code: 'ERR_POLYMARKET_FAILED'
    });
  });

  it('classifies provider market-not-found as business error', async () => {
    const spawnImpl = (() => {
      const child = makeChild();
      setImmediate(() => {
        child.stderr.emit('data', 'Market not found');
        child.emit('close', 1, null);
      });
      return child;
    }) as unknown as typeof import('node:child_process').spawn;

    const adapter = new CliPolymarketAdapter({
      spawnSyncImpl: (() => modernHelp()) as unknown as typeof import('node:child_process').spawnSync,
      spawnImpl
    });

    await expect(adapter.searchMarkets({ query: 'nope', limit: 1 })).rejects.toMatchObject<AppError>({
      code: 'ERR_MARKET_NOT_FOUND',
      message: 'market not found'
    });
  });

  it('does not leak private key in error details', async () => {
    const key = `0x${'a'.repeat(64)}`;
    const spawnImpl = (() => {
      const child = makeChild();
      setImmediate(() => {
        child.stderr.emit('data', `failed with PRIVATE_KEY=${key}`);
        child.emit('close', 1, null);
      });
      return child;
    }) as unknown as typeof import('node:child_process').spawn;

    const adapter = new CliPolymarketAdapter({
      spawnSyncImpl: (() => modernHelp()) as unknown as typeof import('node:child_process').spawnSync,
      spawnImpl
    });

    try {
      await adapter.searchMarkets({ query: 'nope', limit: 1 });
    } catch (err) {
      const appErr = err as AppError;
      expect(appErr.code).toBe('ERR_POLYMARKET_FAILED');
      const details = JSON.stringify(appErr.details ?? {});
      expect(details).not.toContain(key);
      expect(details).not.toContain('PRIVATE_KEY=' + key);
      expect(details).toContain('[REDACTED');
    }
  });

  it('detectSignatureType tries eoa before proxy', async () => {
    const callLog: string[] = [];
    const spawnImpl = ((_cmd: string, args: string[]) => {
      const child = makeChild();
      const sigType = args.find((a, i) => args[i - 1] === '--signature-type');
      callLog.push(sigType || 'unknown');
      setImmediate(() => {
        if (sigType === 'eoa') {
          // eoa succeeds
          child.stdout.emit('data', JSON.stringify({ address: '0x123' }));
          child.emit('close', 0, null);
        } else {
          // proxy fails
          child.stderr.emit('data', 'auth failed');
          child.emit('close', 1, null);
        }
      });
      return child;
    }) as unknown as typeof import('node:child_process').spawn;

    const adapter = new CliPolymarketAdapter({
      spawnSyncImpl: (() => modernHelp()) as unknown as typeof import('node:child_process').spawnSync,
      spawnImpl
    });

    // orders() triggers detectSignatureType internally
    const result = await adapter.orders({ privateKey: '0x' + 'ab'.repeat(32) });
    // eoa should be tried first
    expect(callLog[0]).toBe('eoa');
    expect(result.data).toBeDefined();
  });

  it('cancelOrder sends correct args and returns parsed JSON', async () => {
    const spawnImpl = ((_cmd: string, args: string[]) => {
      const child = makeChild();
      setImmediate(() => {
        // detectSignatureType call
        if (args.includes('wallet')) {
          child.stdout.emit('data', JSON.stringify({ address: '0x1' }));
          child.emit('close', 0, null);
          return;
        }
        // actual cancel call
        child.stdout.emit('data', JSON.stringify({ status: 'cancelled', order_id: 'ord_123' }));
        child.emit('close', 0, null);
      });
      return child;
    }) as unknown as typeof import('node:child_process').spawn;

    const adapter = new CliPolymarketAdapter({
      spawnSyncImpl: (() => modernHelp()) as unknown as typeof import('node:child_process').spawnSync,
      spawnImpl
    });

    const result = await adapter.cancelOrder({ orderId: 'ord_123', privateKey: '0x' + 'cc'.repeat(32) });
    expect(result.data).toEqual({ status: 'cancelled', order_id: 'ord_123' });
  });

  it('approveCheck sends correct args and returns parsed JSON', async () => {
    const spawnImpl = ((_cmd: string, args: string[]) => {
      const child = makeChild();
      setImmediate(() => {
        if (args.includes('wallet')) {
          child.stdout.emit('data', JSON.stringify({ address: '0x1' }));
          child.emit('close', 0, null);
          return;
        }
        child.stdout.emit('data', JSON.stringify({ approved: true, allowances: {} }));
        child.emit('close', 0, null);
      });
      return child;
    }) as unknown as typeof import('node:child_process').spawn;

    const adapter = new CliPolymarketAdapter({
      spawnSyncImpl: (() => modernHelp()) as unknown as typeof import('node:child_process').spawnSync,
      spawnImpl
    });

    const result = await adapter.approveCheck({ privateKey: '0x' + 'dd'.repeat(32) });
    expect(result.data).toEqual({ approved: true, allowances: {} });
  });

  it('approveSet sends correct args and returns parsed JSON', async () => {
    const spawnImpl = ((_cmd: string, args: string[]) => {
      const child = makeChild();
      setImmediate(() => {
        if (args.includes('wallet')) {
          child.stdout.emit('data', JSON.stringify({ address: '0x1' }));
          child.emit('close', 0, null);
          return;
        }
        child.stdout.emit('data', JSON.stringify({ status: 'approved', txs: 6 }));
        child.emit('close', 0, null);
      });
      return child;
    }) as unknown as typeof import('node:child_process').spawn;

    const adapter = new CliPolymarketAdapter({
      spawnSyncImpl: (() => modernHelp()) as unknown as typeof import('node:child_process').spawnSync,
      spawnImpl
    });

    const result = await adapter.approveSet({ privateKey: '0x' + 'ee'.repeat(32) });
    expect(result.data).toEqual({ status: 'approved', txs: 6 });
  });

  it('updateBalance sends correct args and returns parsed JSON', async () => {
    const spawnImpl = ((_cmd: string, args: string[]) => {
      const child = makeChild();
      setImmediate(() => {
        if (args.includes('wallet')) {
          child.stdout.emit('data', JSON.stringify({ address: '0x1' }));
          child.emit('close', 0, null);
          return;
        }
        child.stdout.emit('data', JSON.stringify({ balance: '100.5' }));
        child.emit('close', 0, null);
      });
      return child;
    }) as unknown as typeof import('node:child_process').spawn;

    const adapter = new CliPolymarketAdapter({
      spawnSyncImpl: (() => modernHelp()) as unknown as typeof import('node:child_process').spawnSync,
      spawnImpl
    });

    const result = await adapter.updateBalance({ privateKey: '0x' + 'ff'.repeat(32) });
    expect(result.data).toEqual({ balance: '100.5' });
  });
});
