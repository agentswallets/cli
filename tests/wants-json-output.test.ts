import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wantsJsonOutput } from '../src/core/output.js';

describe('wantsJsonOutput', () => {
  const origEnv = { ...process.env };
  const origArgv = [...process.argv];

  beforeEach(() => {
    delete process.env.AW_JSON;
    process.argv = ['node', 'aw'];
  });

  afterEach(() => {
    process.env = { ...origEnv };
    process.argv = [...origArgv];
  });

  it('--json flag alone → true', () => {
    expect(wantsJsonOutput({ json: true, output: undefined })).toBe(true);
  });

  it('--output json alone → true', () => {
    expect(wantsJsonOutput({ json: false, output: 'json' })).toBe(true);
  });

  it('AW_JSON=1 alone → true', () => {
    process.env.AW_JSON = '1';
    expect(wantsJsonOutput({ json: false, output: undefined })).toBe(true);
  });

  it('explicit --output human overrides --json → false', () => {
    expect(wantsJsonOutput({ json: true, output: 'human' })).toBe(false);
  });

  it('explicit --output human overrides AW_JSON → false', () => {
    process.env.AW_JSON = '1';
    expect(wantsJsonOutput({ json: false, output: 'human' })).toBe(false);
  });

  it('no flags on TTY → false', () => {
    // Mock TTY
    const origIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    try {
      expect(wantsJsonOutput({ json: false, output: undefined })).toBe(false);
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: origIsTTY, configurable: true });
    }
  });

  it('--json with output=undefined (Commander default removed) → true', () => {
    // This is the critical regression test:
    // When --output has no default, opts.output is undefined when not passed
    expect(wantsJsonOutput({ json: true, output: undefined })).toBe(true);
  });

  it('--output json with --json both set → true', () => {
    expect(wantsJsonOutput({ json: true, output: 'json' })).toBe(true);
  });

  it('--output invalid value → throws ERR_INVALID_PARAMS', () => {
    expect(() => wantsJsonOutput({ json: false, output: 'typo' })).toThrow(/--output must be human\|json/);
  });

  it('--output human from argv in non-TTY → false', () => {
    // Simulate non-TTY with --output human passed via argv but not via opts
    const origIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: undefined, configurable: true });
    process.argv = ['node', 'aw', 'health', '--output', 'human'];
    try {
      expect(wantsJsonOutput({ json: false, output: undefined })).toBe(false);
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: origIsTTY, configurable: true });
    }
  });

  it('--output json from argv in non-TTY with undefined opts → true', () => {
    process.argv = ['node', 'aw', 'health', '--output', 'json'];
    expect(wantsJsonOutput({ json: false, output: undefined })).toBe(true);
  });
});
