import { afterEach, describe, expect, it } from 'vitest';
import { buildCli } from '../src/cli.js';

const originalArgv = [...process.argv];

describe('help branding behavior', () => {
  afterEach(() => {
    process.argv = [...originalArgv];
  });

  it('keeps help clean in json mode (no ascii banner)', () => {
    process.argv = ['node', 'dist/index.js', '--help', '--json'];
    const cli = buildCli();
    const help = cli.helpInformation();
    expect(help).not.toContain('AGENTSWALLETS');
  });

  it('keeps help clean in human mode (no ascii banner)', () => {
    process.argv = ['node', 'dist/index.js', '--help'];
    const cli = buildCli();
    const help = cli.helpInformation();
    expect(help).toContain('Wallets for AI Agents');
    expect(help).not.toContain('AGENTSWALLETS');
  });

  it('keeps start alias hidden from help', () => {
    process.argv = ['node', 'dist/index.js', '--help'];
    const cli = buildCli();
    const help = cli.helpInformation();
    expect(help).not.toContain('\n  start ');
    expect(help).toContain('wallet');
    expect(help).toContain('predict');
  });

  it('buildCli exposes commands for JSON help listing', () => {
    const cli = buildCli();
    const commands = cli.commands.map((c) => ({
      name: c.name(),
      description: c.description()
    }));
    expect(commands.length).toBeGreaterThan(0);
    const names = commands.map((c) => c.name);
    expect(names).toContain('init');
    expect(names).toContain('wallet');
    expect(names).toContain('predict');
    expect(names).toContain('audit');
    // Each command should have a description
    for (const cmd of commands) {
      expect(cmd.description).toBeTruthy();
    }
  });
});
