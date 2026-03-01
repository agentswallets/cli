import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCli } from '../src/cli.js';

const origArgv = [...process.argv];
const origEnv = { ...process.env };

vi.mock('../src/core/db.js', () => ({
  getDb: () => { throw new Error('no db in test'); },
  ensureDataDir: () => {},
  initDbSchema: () => {},
  assertInitialized: () => {},
  isInitialized: () => true
}));

vi.mock('../src/core/wallet-store.js', () => ({
  listWallets: () => [],
  getWalletById: () => { throw new Error('not found'); },
  getWalletByName: () => { throw new Error('not found'); },
  getWalletByAddress: () => { throw new Error('not found'); },
  resolveWallet: () => { throw new Error('not found'); },
  getPolicy: () => ({ daily_limit: null, per_tx_limit: null, max_tx_per_day: null, allowed_tokens: [], allowed_addresses: [], require_approval_above: null }),
  upsertPolicy: () => {},
  insertWallet: () => ({})
}));

describe('CLI E2E integration', () => {
  beforeEach(() => {
    process.argv = ['node', 'aw'];
    delete process.env.AW_JSON;
  });

  afterEach(() => {
    process.argv = [...origArgv];
    process.env = { ...origEnv };
    vi.restoreAllMocks();
  });

  it('--json flag produces JSON envelope on stdout', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const cli = buildCli();
    process.argv = ['node', 'aw', 'wallet', 'list', '--json'];
    await cli.parseAsync(process.argv);

    expect(writeSpy).toHaveBeenCalled();
    const output = String(writeSpy.mock.calls[0]?.[0]);
    const parsed = JSON.parse(output.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data).toEqual({ wallets: [], hint: 'No wallets found. Create one with: aw wallet create --name <name>' });
    expect(parsed.meta.request_id).toBeTruthy();
  });

  it('--output human overrides --json', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const cli = buildCli();
    process.argv = ['node', 'aw', 'wallet', 'list', '--json', '--output', 'human'];
    await cli.parseAsync(process.argv);

    expect(logSpy).toHaveBeenCalled();
  });

  it('--output invalid value throws AppError', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const cli = buildCli();
    process.argv = ['node', 'aw', 'wallet', 'list', '--output', 'invalid'];

    await expect(cli.parseAsync(process.argv)).rejects.toThrow(/--output must be human\|json/);
  });

  it('export-key command is always registered (runtime guard, not registration guard)', () => {
    delete process.env.AW_ALLOW_EXPORT;
    const cli = buildCli();
    const walletCmd = cli.commands.find((c) => c.name() === 'wallet');
    const exportCmd = walletCmd?.commands.find((c) => c.name() === 'export-key');
    expect(exportCmd).toBeDefined();
  });
});
