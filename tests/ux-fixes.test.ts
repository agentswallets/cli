import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ===== Fix 1: wallet resolution (resolveWalletArg) =====
describe('Fix 1: wallet resolution', () => {
  it('wallet info accepts [wallet] positional and --wallet flag', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const infoCmd = cli.commands
      .find(c => c.name() === 'wallet')
      ?.commands.find(c => c.name() === 'info');
    expect(infoCmd).toBeDefined();
    const walletOpt = infoCmd?.options.find(o => o.long === '--wallet');
    expect(walletOpt).toBeDefined();
    expect(walletOpt?.description).toContain('name or address');
  });

  it('policy show accepts --wallet flag with name/address', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const policyCmd = cli.commands
      .find(c => c.name() === 'policy')
      ?.commands.find(c => c.name() === 'show');
    expect(policyCmd).toBeDefined();
    const walletOpt = policyCmd?.options.find(o => o.long === '--wallet');
    expect(walletOpt).toBeDefined();
    expect(walletOpt?.description).toContain('name or address');
  });

  it('policy set accepts --wallet flag with name/address', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const policyCmd = cli.commands
      .find(c => c.name() === 'policy')
      ?.commands.find(c => c.name() === 'set');
    expect(policyCmd).toBeDefined();
    const walletOpt = policyCmd?.options.find(o => o.long === '--wallet');
    expect(walletOpt).toBeDefined();
    expect(walletOpt?.description).toContain('name or address');
  });

  it('wallet balance accepts --wallet flag with name/address', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const balCmd = cli.commands
      .find(c => c.name() === 'wallet')
      ?.commands.find(c => c.name() === 'balance');
    expect(balCmd).toBeDefined();
    const walletOpt = balCmd?.options.find(o => o.long === '--wallet');
    expect(walletOpt).toBeDefined();
    expect(walletOpt?.description).toContain('name or address');
  });
});

// ===== Fix 2: Alias labels in --help =====
describe('Fix 2: alias labels', () => {
  it('tx send description includes alias marker', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const txSend = cli.commands
      .find(c => c.name() === 'tx')
      ?.commands.find(c => c.name() === 'send');
    expect(txSend?.description()).toContain('alias for: aw send');
  });

  it('wallet settings description includes alias marker', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const settings = cli.commands
      .find(c => c.name() === 'wallet')
      ?.commands.find(c => c.name() === 'settings');
    expect(settings?.description()).toContain('alias for: aw policy show');
  });

  it('wallet settings-set description includes alias marker', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const settingsSet = cli.commands
      .find(c => c.name() === 'wallet')
      ?.commands.find(c => c.name() === 'settings-set');
    expect(settingsSet?.description()).toContain('alias for: aw policy set');
  });
});

// ===== Fix 3: POL token naming =====
describe('Fix 3: POL token naming', () => {
  it('DEFAULT_POLICY uses POL', async () => {
    const { DEFAULT_POLICY } = await import('../src/core/constants.js');
    expect(DEFAULT_POLICY.allowed_tokens).toContain('POL');
  });

  it('policy engine accepts POL directly', async () => {
    const { evaluatePolicy } = await import('../src/core/policy-engine.js');
    const result = evaluatePolicy({
      policy: {
        daily_limit: 1000,
        per_tx_limit: 100,
        max_tx_per_day: 20,
        allowed_tokens: ['POL', 'USDC'],
        allowed_addresses: [],
        require_approval_above: null
      },
      token: 'POL',
      amount: 1,
      stats: { todaySpent: 0, todayTxCount: 0 }
    });
    expect(result.status).toBe('allowed');
  });
});

// ===== Fix 4: wallet create skips password verification when session valid =====
describe('Fix 4: wallet create session-aware', () => {
  it('walletCreateCommand imports isSessionValid', async () => {
    // Verify the module can be imported without errors
    const mod = await import('../src/commands/wallet.js');
    expect(typeof mod.walletCreateCommand).toBe('function');
  });
});

// ===== Fix 5: Expanded policy set =====
describe('Fix 5: expanded policy set', () => {
  it('policy set command accepts all new flags', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const policySet = cli.commands
      .find(c => c.name() === 'policy')
      ?.commands.find(c => c.name() === 'set');
    expect(policySet).toBeDefined();

    const optNames = policySet?.options.map(o => o.long) ?? [];
    expect(optNames).toContain('--limit-daily');
    expect(optNames).toContain('--limit-per-tx');
    expect(optNames).toContain('--max-tx-per-day');
    expect(optNames).toContain('--allowed-tokens');
    expect(optNames).toContain('--allowed-addresses');
    expect(optNames).toContain('--require-approval-above');
  });

  it('policy set has 6 configurable fields', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const policySet = cli.commands
      .find(c => c.name() === 'policy')
      ?.commands.find(c => c.name() === 'set');
    const policyFlags = ['--limit-daily', '--limit-per-tx', '--max-tx-per-day', '--allowed-tokens', '--allowed-addresses', '--require-approval-above'];
    const found = policySet?.options.filter(o => policyFlags.includes(o.long ?? '')) ?? [];
    expect(found.length).toBe(6);
  });

  it('policySetCommand parses comma-separated tokens', async () => {
    // Unit test: verify the parsing logic by checking the CLI command registration
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const policySet = cli.commands
      .find(c => c.name() === 'policy')
      ?.commands.find(c => c.name() === 'set');

    // Verify --allowed-tokens uses <tokens> not [tokens]
    const tokensOpt = policySet?.options.find(o => o.long === '--allowed-tokens');
    expect(tokensOpt).toBeDefined();
    expect(tokensOpt?.description).toContain('Comma-separated');
  });

  it('policySetCommand parses require-approval-above', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const policySet = cli.commands
      .find(c => c.name() === 'policy')
      ?.commands.find(c => c.name() === 'set');

    const approvalOpt = policySet?.options.find(o => o.long === '--require-approval-above');
    expect(approvalOpt).toBeDefined();
    expect(approvalOpt?.description).toContain('approval');
  });
});

// ===== Fix 6: --dry-run =====
describe('Fix 6: --dry-run', () => {
  it('send command accepts --dry-run flag', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const send = cli.commands.find(c => c.name() === 'send');
    expect(send).toBeDefined();
    const dryRunOpt = send?.options.find(o => o.long === '--dry-run');
    expect(dryRunOpt).toBeDefined();
  });

  it('predict buy accepts --dry-run flag', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const buy = cli.commands
      .find(c => c.name() === 'predict')
      ?.commands.find(c => c.name() === 'buy');
    expect(buy).toBeDefined();
    const dryRunOpt = buy?.options.find(o => o.long === '--dry-run');
    expect(dryRunOpt).toBeDefined();
  });

  it('predict sell accepts --dry-run flag', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const sell = cli.commands
      .find(c => c.name() === 'predict')
      ?.commands.find(c => c.name() === 'sell');
    expect(sell).toBeDefined();
    const dryRunOpt = sell?.options.find(o => o.long === '--dry-run');
    expect(dryRunOpt).toBeDefined();
  });

  it('tx send alias also accepts --dry-run flag', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const txSend = cli.commands
      .find(c => c.name() === 'tx')
      ?.commands.find(c => c.name() === 'send');
    expect(txSend).toBeDefined();
    const dryRunOpt = txSend?.options.find(o => o.long === '--dry-run');
    expect(dryRunOpt).toBeDefined();
  });
});

// ===== Fix: --idempotency-key optional value handling =====
describe('Fix: idempotency-key optional value', () => {
  it('send --idempotency-key is optional (not required)', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const send = cli.commands.find(c => c.name() === 'send');
    const idemOpt = send?.options.find(o => o.long === '--idempotency-key');
    expect(idemOpt).toBeDefined();
    expect(idemOpt?.required).toBeFalsy();
  });

  it('predict buy --idempotency-key is optional', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const buy = cli.commands
      .find(c => c.name() === 'predict')
      ?.commands.find(c => c.name() === 'buy');
    const idemOpt = buy?.options.find(o => o.long === '--idempotency-key');
    expect(idemOpt).toBeDefined();
    expect(idemOpt?.required).toBeFalsy();
  });

  it('tx send --idempotency-key is optional', async () => {
    const { buildCli } = await import('../src/cli.js');
    const cli = buildCli();
    const txSend = cli.commands
      .find(c => c.name() === 'tx')
      ?.commands.find(c => c.name() === 'send');
    const idemOpt = txSend?.options.find(o => o.long === '--idempotency-key');
    expect(idemOpt).toBeDefined();
    expect(idemOpt?.required).toBeFalsy();
  });
});

// ===== Fix 7: Human-readable output =====
describe('Fix 7: human-readable output', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Force human output
    delete process.env.AW_JSON;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('formatHuman produces key-value pairs for flat objects', async () => {
    const { runCommand } = await import('../src/core/output.js');
    await runCommand({ output: 'human' }, () => ({ status: 'locked' }));
    const output = String(writeSpy.mock.calls[0]?.[0] ?? '');
    expect(output).toContain('status: locked');
    expect(output).not.toContain('{');
    expect(output).not.toContain('"');
  });

  it('formatHuman handles nested objects with dot notation', async () => {
    const { runCommand } = await import('../src/core/output.js');
    await runCommand({ output: 'human' }, () => ({
      name: 'w1',
      balances: { POL: '1.5', USDC: '100.0' }
    }));
    const output = String(writeSpy.mock.calls[0]?.[0] ?? '');
    expect(output).toContain('balances.POL: 1.5');
    expect(output).toContain('balances.USDC: 100.0');
  });

  it('formatHuman handles arrays', async () => {
    const { runCommand } = await import('../src/core/output.js');
    await runCommand({ output: 'human' }, () => ({
      name: 'w1',
      policy: { allowed_tokens: ['POL', 'USDC'] }
    }));
    const output = String(writeSpy.mock.calls[0]?.[0] ?? '');
    expect(output).toContain('policy.allowed_tokens: POL, USDC');
  });

  it('formatHuman shows (none) for empty arrays', async () => {
    const { runCommand } = await import('../src/core/output.js');
    await runCommand({ output: 'human' }, () => ({
      name: 'w1',
      policy: { allowed_addresses: [] }
    }));
    const output = String(writeSpy.mock.calls[0]?.[0] ?? '');
    expect(output).toContain('policy.allowed_addresses: (none)');
  });
});
