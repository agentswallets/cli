import { describe, expect, it } from 'vitest';
import { exitCodeForError } from '../src/core/errors.js';

describe('exit code mapping', () => {
  it('maps business errors to 1', () => {
    expect(exitCodeForError('ERR_INVALID_PARAMS')).toBe(1);
  });

  it('maps auth errors to 3', () => {
    expect(exitCodeForError('ERR_NEED_UNLOCK')).toBe(3);
    expect(exitCodeForError('ERR_AUTH_FAILED')).toBe(3);
    expect(exitCodeForError('ERR_POLYMARKET_AUTH')).toBe(3);
  });

  it('maps system errors to 2', () => {
    expect(exitCodeForError('ERR_RPC_UNAVAILABLE')).toBe(2);
    expect(exitCodeForError('ERR_POLYMARKET_CLI_NOT_FOUND')).toBe(2);
    expect(exitCodeForError('ERR_POLYMARKET_FAILED')).toBe(2);
  });
});
