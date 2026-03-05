import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { txHistoryCommand } from '../src/commands/tx.js';
import { AppError } from '../src/core/errors.js';

function withHome(home: string, fn: () => Promise<void> | void): Promise<void> | void {
  const prev = process.env.AGENTSWALLETS_HOME;
  process.env.AGENTSWALLETS_HOME = home;
  try {
    return fn();
  } finally {
    process.env.AGENTSWALLETS_HOME = prev;
  }
}

describe('cli-like json errors', () => {
  it('not initialized raises ERR_NOT_INITIALIZED', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-test-'));
    await withHome(dir, async () => {
      try {
        txHistoryCommand('w1', 10);
        throw new Error('should fail');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('ERR_NOT_INITIALIZED');
      }
    });
  });
});
