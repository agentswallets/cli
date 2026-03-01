#!/usr/bin/env node
import fs from 'node:fs';
import { Command, CommanderError } from 'commander';
import { AppError } from './core/errors.js';
import { exitCodeForError } from './core/errors.js';
import { jsonError, jsonOk, wantsJsonOutput } from './core/output.js';
import { CLI_VERSION } from './core/version.js';
import { destroyProviders } from './core/rpc.js';
import { redactSecrets } from './util/redact.js';
import { buildCli, commandSchema } from './cli.js';
import { getDbPath } from './core/config.js';

// Safety net: redact any sensitive data from unhandled rejections before they hit stderr.
process.on('unhandledRejection', (reason) => {
  const msg = redactSecrets(reason instanceof Error ? reason.message : String(reason));
  process.stderr.write(`[ERR_INTERNAL] Unhandled: ${msg}\n`);
  process.exitCode = 2;
});

const isJsonMode = wantsJsonOutput({ json: process.argv.includes('--json'), output: undefined });

// Suppress third-party stdout/stderr noise (e.g. ethers warnings) in JSON mode.
// L-6: Our JSON output now uses process.stdout.write directly, so we can safely
// suppress console.log/warn entirely in JSON mode.
if (isJsonMode) {
  const nativeLog = console.log.bind(console);
  const nativeWarn = console.warn.bind(console);
  console.log = () => {};
  console.warn = () => {};
  // Restore after event loop drains so tests behave normally.
  process.on('beforeExit', () => {
    console.log = nativeLog;
    console.warn = nativeWarn;
  });
}

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  if (isJsonMode) {
    process.stdout.write(JSON.stringify(jsonOk({ version: CLI_VERSION })) + '\n');
  } else {
    process.stdout.write(CLI_VERSION + '\n');
  }
  process.exit(0);
}

/**
 * P0 fix: Ensure deterministic exit.
 * ethers JsonRpcProvider holds active handles (sockets, timers) that prevent
 * Node.js from exiting. We destroy all providers and force exit after completion.
 */
function exitCleanly(): void {
  destroyProviders();
  // Give stdout/stderr a tick to flush, then force exit.
  setImmediate(() => process.exit(process.exitCode ?? 0));
}

/** Walk process.argv to find the deepest matching subcommand. */
function findTargetCommand(root: Command, argv: string[]): Command {
  const args = argv.slice(2).filter(a => !a.startsWith('-'));
  let cmd = root;
  for (const arg of args) {
    const sub = cmd.commands.find(c => c.name() === arg);
    if (!sub) break;
    cmd = sub;
  }
  return cmd;
}

const cli = buildCli();

// Bare `aw` (no subcommand) → show welcome or help instead of an error.
const bareArgs = process.argv.slice(2).filter(a => !a.startsWith('-'));
if (bareArgs.length === 0 && !process.argv.includes('--help') && !process.argv.includes('-h')) {
  const initialized = fs.existsSync(getDbPath());
  if (isJsonMode) {
    if (!initialized) {
      process.stdout.write(JSON.stringify(jsonOk({
        version: CLI_VERSION,
        initialized: false,
        message: 'Welcome to AgentsWallets. Run `aw init --json` to get started.',
        next_step: 'aw init --json'
      })) + '\n');
    } else {
      process.stdout.write(JSON.stringify(jsonOk(commandSchema(cli))) + '\n');
    }
  } else {
    if (!initialized) {
      process.stdout.write([
        '',
        `  AgentsWallets v${CLI_VERSION}`,
        '  Wallets for AI Agents \u00b7 Polygon',
        '',
        '  Get started:',
        '    aw init              Set up master password',
        '    aw --help            Show all commands',
        '',
        '  https://github.com/agentswallets/cli',
        '',
      ].join('\n') + '\n');
    } else {
      cli.outputHelp();
    }
  }
  process.exit(0);
}

cli.parseAsync(process.argv)
  .then(() => {
    exitCleanly();
  })
  .catch((err) => {
    const jsonMode = wantsJsonOutput({ json: process.argv.includes('--json'), output: undefined });

    if (err instanceof CommanderError) {
      if (err.code === 'commander.helpDisplayed') {
        if (isJsonMode) {
          const targetCmd = findTargetCommand(cli, process.argv);
          const schema = commandSchema(targetCmd);
          process.stdout.write(JSON.stringify(jsonOk(schema)) + '\n');
        }
        process.exitCode = 0;
        exitCleanly();
        return;
      }
      const appError = new AppError('ERR_INVALID_PARAMS', err.message);
      if (jsonMode) {
        process.stdout.write(JSON.stringify(jsonError(appError.code, appError.message)) + '\n');
      } else {
        process.stderr.write(`[${appError.code}] ${redactSecrets(appError.message)}\n`);
      }
      process.exitCode = 1;
      exitCleanly();
      return;
    }

    const appError = err instanceof AppError ? err : new AppError('ERR_INTERNAL', err?.message || 'Internal error');
    if (jsonMode) {
      process.stdout.write(JSON.stringify(jsonError(appError.code, appError.message, appError.details)) + '\n');
    } else {
      process.stderr.write(`[${appError.code}] ${redactSecrets(appError.message)}\n`);
      if (appError.details && Object.keys(appError.details).length > 0) {
        process.stderr.write(redactSecrets(JSON.stringify(appError.details, null, 2)) + '\n');
      }
    }
    process.exitCode = exitCodeForError(appError.code);
    exitCleanly();
  });
