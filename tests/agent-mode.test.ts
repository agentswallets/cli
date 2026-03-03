import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/core/errors.js';
import { confirmAction, getMasterPassword, _resetPasswordCache } from '../src/util/agent-input.js';
import { runCommand } from '../src/core/output.js';

// Mock keychain so tests don't pick up real OS keychain entries
vi.mock('../src/core/keychain.js', () => ({
  keychainGet: () => null,
  keychainSet: () => {},
  keychainAvailable: () => false
}));

function clearAgentEnv(): void {
  delete process.env.AW_MASTER_PASSWORD;
  delete process.env.AW_MASTER_PASSWORD_ENV;
  delete process.env.AW_NON_INTERACTIVE;
  delete process.env.AW_AUTO_APPROVE;
  delete process.env.AW_JSON;
}

afterEach(() => {
  clearAgentEnv();
  _resetPasswordCache();
  vi.restoreAllMocks();
});

describe('agent mode behavior', () => {
  it('reads master password from AW_MASTER_PASSWORD', async () => {
    process.env.AW_MASTER_PASSWORD = 'StrongPass123';
    await expect(getMasterPassword('Master password: ')).resolves.toBe('StrongPass123');
  });

  it('fails fast in non-interactive mode when password is missing', async () => {
    process.env.AW_NON_INTERACTIVE = '1';
    await expect(getMasterPassword('Master password: ')).rejects.toMatchObject<AppError>({
      code: 'ERR_INVALID_PARAMS'
    });
  });

  it('auto-confirms when AW_AUTO_APPROVE is enabled', async () => {
    process.env.AW_AUTO_APPROVE = '1';
    await expect(confirmAction('Approve?')).resolves.toBe(true);
  });

  it('caches password across multiple getMasterPassword calls (drain multi-step)', async () => {
    process.env.AW_MASTER_PASSWORD = 'DrainPass456';
    process.env.AW_NON_INTERACTIVE = '1';
    // First call: reads from env, caches, deletes env var
    const pw1 = await getMasterPassword('Master password: ');
    expect(pw1).toBe('DrainPass456');
    expect(process.env.AW_MASTER_PASSWORD).toBeUndefined();
    // Second call: env var gone, but cache returns it
    const pw2 = await getMasterPassword('Master password: ');
    expect(pw2).toBe('DrainPass456');
    // Third call: still works
    const pw3 = await getMasterPassword('Master password: ');
    expect(pw3).toBe('DrainPass456');
  });

  it('uses AW_JSON=1 as default machine output', async () => {
    process.env.AW_JSON = '1';
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await runCommand({}, () => ({ status: 'ok' }));

    expect(errSpy).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(writeSpy.mock.calls[0]?.[0]));
    expect(payload.ok).toBe(true);
    expect(payload.data).toEqual({ status: 'ok' });
    expect(typeof payload.meta?.request_id).toBe('string');
  });
});

describe('predict commands tolerate --chain from agent wrappers', () => {
  it('predict subcommands have hidden --chain option', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const predict = cli.commands.find(c => c.name() === 'predict');
    expect(predict).toBeDefined();
    for (const sub of predict!.commands) {
      const chainOpt = sub.options.find(o => o.long === '--chain');
      expect(chainOpt, `predict ${sub.name()} should have --chain option`).toBeDefined();
      expect(chainOpt!.hidden, `predict ${sub.name()} --chain should be hidden`).toBe(true);
    }
  });

  it('predict subcommands still reject truly unknown options', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const predict = cli.commands.find(c => c.name() === 'predict');
    expect(predict).toBeDefined();
    for (const sub of predict!.commands) {
      expect(
        (sub as unknown as { _allowUnknownOption: boolean })._allowUnknownOption,
        `predict ${sub.name()} should NOT allow unknown options`
      ).toBeFalsy();
    }
  });
});
