import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCommand } from '../src/core/output.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runCommand runtime behavior', () => {
  it('emits compact single-line json in json mode via process.stdout.write', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await runCommand({ json: true }, () => ({ hello: 'world' }));

    expect(errSpy).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const line = String(writeSpy.mock.calls[0]?.[0]);
    const parsed = JSON.parse(line.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data).toEqual({ hello: 'world' });
  });

  it('maps unknown non-app errors to ERR_INTERNAL via stdout', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.exitCode = 0;

    await runCommand({ json: true }, () => {
      throw new Error('boom');
    });

    expect(errSpy).not.toHaveBeenCalled();
    // Error JSON now goes to stdout (2 calls: success path never fires, error path does)
    const errorCalls = writeSpy.mock.calls.filter(c => {
      try { const p = JSON.parse(String(c[0])); return p.ok === false; } catch { return false; }
    });
    expect(errorCalls).toHaveLength(1);
    const parsed = JSON.parse(String(errorCalls[0]?.[0]));
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INTERNAL_ERROR');
    expect(process.exitCode).toBe(2);
  });
});
