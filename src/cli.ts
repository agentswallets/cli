import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { unlockCommand } from './commands/unlock.js';
import { runCommand, wantsJsonOutput } from './core/output.js';
import crypto from 'node:crypto';
import {
  walletAddressCommand,
  walletBalanceAllCommand,
  walletBalanceCommand,
  walletCreateCommand,
  walletExportKeyCommand,
  walletInfoCommand,
  walletListCommand
} from './commands/wallet.js';
import { txHistoryCommand, txSendCommand, txStatusCommand } from './commands/tx.js';
import { polyApproveCheckCommand, polyApproveSetCommand, polyBridgeDepositCommand, polyBuyCommand, polyCancelCommand, polyCtfMergeCommand, polyCtfRedeemCommand, polyCtfSplitCommand, polyOrdersCommand, polyPositionsCommand, polySearchCommand, polySellCommand, polyUpdateBalanceCommand } from './commands/poly.js';
import { policySetCommand, policyShowCommand } from './commands/policy.js';
import { auditListCommand } from './commands/audit.js';
import { healthCommand } from './commands/health.js';
import { clearSession } from './core/session.js';
import { logAudit } from './core/audit-service.js';
import { AppError } from './core/errors.js';
import type { AppErrorCode } from './core/types.js';
import { keychainAvailable, keychainGet, keychainRemove, keychainSet } from './core/keychain.js';
import { verifyMasterPassword } from './core/crypto.js';
import { getSetting } from './core/settings.js';
import { getMasterPassword } from './util/agent-input.js';
import { requirePositiveInt } from './util/validate.js';
import { redactSecrets } from './util/redact.js';
import { resolveWallet } from './core/wallet-store.js';

/** Resolve wallet identifier (name, address, or UUID) from positional arg OR --wallet flag. Returns internal wallet_id. */
function resolveWalletArg(positional: string | undefined, flag: string | undefined): string {
  const identifier = positional || flag;
  if (!identifier) throw new AppError('ERR_INVALID_PARAMS', 'wallet is required (positional or --wallet)');
  return resolveWallet(identifier).id;
}

type CommonOpts = {
  json?: boolean;
  output?: string;
  nonInteractive?: boolean;
  requestId?: string;
  yes?: boolean;
};

function withCommon<T extends Command>(cmd: T): T {
  return cmd
    .option('--json', 'Output as JSON')
    .option('--output <format>', 'Output format: human|json')
    .option('--non-interactive', 'Disable interactive prompts')
    .option('--request-id <id>', 'Request id for tracing')
    .option('--timeout <ms>', 'RPC timeout in milliseconds (default: 30000)');
}

export function buildCli(): Command {
  const program = new Command();
  program
    .name('aw')
    .description('Wallets for AI Agents')
    .helpOption('-h, --help', 'Display help')
    .addHelpCommand(false)
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: (str) => {
        if (wantsJsonOutput({ json: process.argv.includes('--json'), output: undefined })) return;
        process.stdout.write(str);
      },
      writeErr: (str) => {
        if (wantsJsonOutput({ json: process.argv.includes('--json'), output: undefined })) return;
        process.stderr.write(redactSecrets(str));
      }
    });

  withCommon(
    program.command('init').description('Initialize local data store').addHelpText('after', '\nExample:\n  aw init --json\n').action((opts: CommonOpts) => runCommand(opts, () => initCommand()))
  );

  withCommon(
    program.command('unlock').description('Unlock session').addHelpText('after', '\nExample:\n  AW_MASTER_PASSWORD=*** aw unlock --json\n').action((opts: CommonOpts) => runCommand(opts, () => unlockCommand()))
  );

  const wallet = program.command('wallet').description('Wallet operations');

  withCommon(
    wallet
      .command('create')
      .description('Create wallet')
      .requiredOption('--name <name>', 'Wallet name')
      .addHelpText('after', '\nExample:\n  aw wallet create --name bot --json\n')
      .action((opts: CommonOpts & { name: string }) => runCommand(opts, () => walletCreateCommand(opts.name)))
  );
  withCommon(wallet.command('list').description('List wallets').addHelpText('after', '\nExample:\n  aw wallet list --json\n').action((opts: CommonOpts) => runCommand(opts, () => walletListCommand())));
  withCommon(wallet.command('info [wallet]').description('Get wallet info').option('--wallet <wallet>', 'Wallet name or address').addHelpText('after', '\nExample:\n  aw wallet info alice --json\n  aw wallet info --wallet 0xCFEb...B0B --json\n').action((walletArg: string | undefined, opts: CommonOpts & { wallet?: string }) => runCommand(opts, () => walletInfoCommand(resolveWalletArg(walletArg, opts.wallet)))));
  withCommon(wallet.command('balance [wallet]').description('Get wallet balance').option('--wallet <wallet>', 'Wallet name or address').option('--all', 'Show all wallets').addHelpText('after', '\nExample:\n  aw wallet balance alice --json\n  aw wallet balance --wallet 0xCFEb...B0B --json\n  aw wallet balance --all --json\n').action((walletArg: string | undefined, opts: CommonOpts & { wallet?: string; all?: boolean }) => {
    if (opts.all) return runCommand(opts, () => walletBalanceAllCommand());
    return runCommand(opts, () => walletBalanceCommand(resolveWalletArg(walletArg, opts.wallet)));
  }));
  withCommon(wallet.command('deposit-address [wallet]').description('Get wallet deposit address').option('--wallet <wallet>', 'Wallet name or address').addHelpText('after', '\nExample:\n  aw wallet deposit-address alice --json\n  aw wallet deposit-address --wallet 0xCFEb...B0B --json\n').action((walletArg: string | undefined, opts: CommonOpts & { wallet?: string }) => runCommand(opts, () => walletAddressCommand(resolveWalletArg(walletArg, opts.wallet)))));
  withCommon(
    wallet
      .command('export-key [wallet]')
      .description('Export wallet private key (dev only)')
      .option('--wallet <wallet>', 'Wallet name or address')
      .option('--yes', 'Skip confirmation')
      .option('--danger-export', 'Confirm you want to export the private key')
      .addHelpText('after', '\nExample:\n  AW_ALLOW_EXPORT=1 aw wallet export-key alice --danger-export --yes --json\n')
      .action((walletArg: string | undefined, opts: CommonOpts & { wallet?: string; dangerExport?: boolean }) => runCommand({ ...opts, skipRedact: true }, () => walletExportKeyCommand(resolveWalletArg(walletArg, opts.wallet), Boolean(opts.yes), Boolean(opts.dangerExport))))
  );
  withCommon(wallet.command('settings [wallet]').description('Show wallet policy (alias for: aw policy show)').option('--wallet <wallet>', 'Wallet name or address').addHelpText('after', '\nExample:\n  aw wallet settings alice --json\n').action((walletArg: string | undefined, opts: CommonOpts & { wallet?: string }) => runCommand(opts, () => policyShowCommand(resolveWalletArg(walletArg, opts.wallet)))));
  withCommon(
    wallet
      .command('settings-set [wallet]')
      .description('Set wallet limits (alias for: aw policy set)')
      .option('--wallet <wallet>', 'Wallet name or address')
      .option('--limit-daily <n>', 'Daily spending limit')
      .option('--limit-per-tx <n>', 'Per transaction spending limit')
      .option('--max-tx-per-day <n>', 'Max transactions per day')
      .option('--allowed-tokens <tokens>', 'Comma-separated token list (e.g. POL,USDC)')
      .option('--allowed-addresses <addrs>', 'Comma-separated address allowlist')
      .option('--require-approval-above <n>', 'Require approval above this amount (0 to clear)')
      .addHelpText(
        'after',
        '\nExample:\n  aw wallet settings-set alice --limit-daily 500 --limit-per-tx 100 --json\n'
      )
      .action((walletArg: string | undefined, opts: CommonOpts & { wallet?: string; limitDaily?: string; limitPerTx?: string; maxTxPerDay?: string; allowedTokens?: string; allowedAddresses?: string; requireApprovalAbove?: string }) =>
        runCommand(opts, () =>
          policySetCommand(resolveWalletArg(walletArg, opts.wallet), {
            limitDaily: opts.limitDaily,
            limitPerTx: opts.limitPerTx,
            maxTxPerDay: opts.maxTxPerDay,
            allowedTokens: opts.allowedTokens,
            allowedAddresses: opts.allowedAddresses,
            requireApprovalAbove: opts.requireApprovalAbove
          })
        )
      )
  );

  withCommon(
    program
      .command('send')
      .description('Send token transfer')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--to <address>', 'Destination address')
      .requiredOption('--amount <n>', 'Amount')
      .requiredOption('--token <POL|USDC|USDC.e>', 'Token symbol')
      .option('--idempotency-key [key]', 'Idempotency key for retry safety (auto-generated if omitted)')
      .option('--dry-run', 'Validate without broadcasting')
      .addHelpText(
        'after',
        '\nUsage:\n  aw send --wallet alice --to <address> --amount <n> --token <symbol>\n\nExample:\n  aw send --wallet alice --to 0x742d... --amount 1 --token USDC --json\n  aw send --wallet alice --to 0x742d... --amount 1 --token USDC --idempotency-key s1 --json\n  aw send --wallet alice --to 0x742d... --amount 1 --token USDC --dry-run --json\n'
      )
      .action((opts: CommonOpts & { wallet: string; to: string; amount: string; token: string; idempotencyKey?: string | boolean; dryRun?: boolean }) => {
        const walletId = resolveWalletArg(undefined, opts.wallet);
        const idemKey = typeof opts.idempotencyKey === 'string' ? opts.idempotencyKey : crypto.randomUUID();
        return runCommand(opts, () =>
          txSendCommand(walletId, {
            to: opts.to,
            amount: opts.amount,
            token: opts.token,
            idempotencyKey: idemKey,
            dryRun: opts.dryRun
          })
        );
      })
  );

  const predict = program.command('predict').description('Prediction market operations');
  withCommon(
    predict
      .command('markets')
      .description('Search markets')
      .requiredOption('-q, --query <query>', 'Search query')
      .option('--limit <n>', 'Result limit', '10')
      .addHelpText('after', '\nExample:\n  aw predict markets --query "trump" --limit 10 --json\n')
      .action((opts: CommonOpts & { query: string; limit: string }) =>
        runCommand(opts, () => polySearchCommand(opts.query, requirePositiveInt(opts.limit, 'limit')))
      )
  );
  withCommon(
    predict
      .command('buy')
      .description('Buy market outcome')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--market <market_id>', 'Market id')
      .requiredOption('--outcome <yes|no>', 'Outcome side')
      .requiredOption('--size <n>', 'Size')
      .requiredOption('--price <n>', 'Price')
      .option('--idempotency-key [key]', 'Idempotency key for retry safety (auto-generated if omitted)')
      .option('--dry-run', 'Validate without placing order')
      .addHelpText('after', '\nExample:\n  aw predict buy --wallet alice --market mkt_xxx --outcome yes --size 10 --price 0.4 --json\n')
      .action((opts: CommonOpts & { wallet: string; market: string; outcome: string; size: string; price: string; idempotencyKey?: string | boolean; dryRun?: boolean }) => {
        const walletId = resolveWalletArg(undefined, opts.wallet);
        const idemKey = typeof opts.idempotencyKey === 'string' ? opts.idempotencyKey : crypto.randomUUID();
        return runCommand(opts, () =>
          polyBuyCommand(walletId, {
            market: opts.market,
            outcome: opts.outcome,
            size: opts.size,
            price: opts.price,
            idempotencyKey: idemKey,
            dryRun: opts.dryRun
          })
        );
      })
  );
  withCommon(
    predict
      .command('sell')
      .description('Sell existing position')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--position <position_id>', 'Position id')
      .requiredOption('--size <n>', 'Size')
      .option('--idempotency-key [key]', 'Idempotency key for retry safety (auto-generated if omitted)')
      .option('--dry-run', 'Validate without placing order')
      .addHelpText('after', '\nExample:\n  aw predict sell --wallet alice --position pos_xxx --size 5 --json\n')
      .action((opts: CommonOpts & { wallet: string; position: string; size: string; idempotencyKey?: string | boolean; dryRun?: boolean }) => {
        const walletId = resolveWalletArg(undefined, opts.wallet);
        const idemKey = typeof opts.idempotencyKey === 'string' ? opts.idempotencyKey : crypto.randomUUID();
        return runCommand(opts, () =>
          polySellCommand(walletId, {
            position: opts.position,
            size: opts.size,
            idempotencyKey: idemKey,
            dryRun: opts.dryRun
          })
        );
      })
  );
  withCommon(predict.command('positions').description('List positions').requiredOption('--wallet <wallet>', 'Wallet name or address').addHelpText('after', '\nExample:\n  aw predict positions --wallet alice --json\n').action((opts: CommonOpts & { wallet: string }) => runCommand(opts, () => polyPositionsCommand(resolveWalletArg(undefined, opts.wallet)))));
  withCommon(predict.command('orders').description('List orders').requiredOption('--wallet <wallet>', 'Wallet name or address').addHelpText('after', '\nExample:\n  aw predict orders --wallet alice --json\n').action((opts: CommonOpts & { wallet: string }) => runCommand(opts, () => polyOrdersCommand(resolveWalletArg(undefined, opts.wallet)))));
  withCommon(
    predict
      .command('cancel')
      .description('Cancel an open order')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--order-id <order_id>', 'Order id to cancel')
      .addHelpText('after', '\nExample:\n  aw predict cancel --wallet alice --order-id <order_id> --json\n')
      .action((opts: CommonOpts & { wallet: string; orderId: string }) =>
        runCommand(opts, () => polyCancelCommand(resolveWalletArg(undefined, opts.wallet), opts.orderId))
      )
  );
  withCommon(
    predict
      .command('approve-check')
      .description('Check contract approval status')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .addHelpText('after', '\nExample:\n  aw predict approve-check --wallet alice --json\n')
      .action((opts: CommonOpts & { wallet: string }) =>
        runCommand(opts, () => polyApproveCheckCommand(resolveWalletArg(undefined, opts.wallet)))
      )
  );
  withCommon(
    predict
      .command('approve-set')
      .description('Execute contract approvals (6 approval transactions)')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .addHelpText('after', '\nExample:\n  aw predict approve-set --wallet alice --json\n')
      .action((opts: CommonOpts & { wallet: string }) =>
        runCommand(opts, () => polyApproveSetCommand(resolveWalletArg(undefined, opts.wallet)))
      )
  );
  withCommon(
    predict
      .command('update-balance')
      .description('Refresh CLOB collateral balance cache')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .addHelpText('after', '\nExample:\n  aw predict update-balance --wallet alice --json\n')
      .action((opts: CommonOpts & { wallet: string }) =>
        runCommand(opts, () => polyUpdateBalanceCommand(resolveWalletArg(undefined, opts.wallet)))
      )
  );
  withCommon(
    predict
      .command('ctf-split')
      .description('Split USDC.e collateral into Yes+No outcome tokens')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--condition <condition_id>', 'Condition ID (0x-prefixed)')
      .requiredOption('--amount <n>', 'Amount in USDC')
      .addHelpText('after', '\nExample:\n  aw predict ctf-split --wallet alice --condition 0xabc... --amount 5 --json\n')
      .action((opts: CommonOpts & { wallet: string; condition: string; amount: string }) =>
        runCommand(opts, () => polyCtfSplitCommand(resolveWalletArg(undefined, opts.wallet), { condition: opts.condition, amount: opts.amount }))
      )
  );
  withCommon(
    predict
      .command('ctf-merge')
      .description('Merge Yes+No outcome tokens back into USDC.e collateral')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--condition <condition_id>', 'Condition ID (0x-prefixed)')
      .requiredOption('--amount <n>', 'Amount in USDC')
      .addHelpText('after', '\nExample:\n  aw predict ctf-merge --wallet alice --condition 0xabc... --amount 5 --json\n')
      .action((opts: CommonOpts & { wallet: string; condition: string; amount: string }) =>
        runCommand(opts, () => polyCtfMergeCommand(resolveWalletArg(undefined, opts.wallet), { condition: opts.condition, amount: opts.amount }))
      )
  );
  withCommon(
    predict
      .command('ctf-redeem')
      .description('Redeem winning tokens after market resolution')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--condition <condition_id>', 'Condition ID (0x-prefixed)')
      .addHelpText('after', '\nExample:\n  aw predict ctf-redeem --wallet alice --condition 0xabc... --json\n')
      .action((opts: CommonOpts & { wallet: string; condition: string }) =>
        runCommand(opts, () => polyCtfRedeemCommand(resolveWalletArg(undefined, opts.wallet), { condition: opts.condition }))
      )
  );
  withCommon(
    predict
      .command('bridge-deposit')
      .description('Get deposit addresses for USDC → USDC.e bridging')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .addHelpText('after', '\nExample:\n  aw predict bridge-deposit --wallet alice --json\n')
      .action((opts: CommonOpts & { wallet: string }) =>
        runCommand(opts, () => polyBridgeDepositCommand(resolveWalletArg(undefined, opts.wallet)))
      )
  );

  // U-5: tx send alias
  const tx = program.command('tx').description('Transaction operations');
  withCommon(
    tx
      .command('send')
      .description('Send token transfer (alias for: aw send)')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--to <address>', 'Destination address')
      .requiredOption('--amount <n>', 'Amount')
      .requiredOption('--token <POL|USDC|USDC.e>', 'Token symbol')
      .option('--idempotency-key [key]', 'Idempotency key for retry safety (auto-generated if omitted)')
      .option('--dry-run', 'Validate without broadcasting')
      .addHelpText('after', '\nExample:\n  aw tx send --wallet alice --to 0x742d... --amount 1 --token USDC --json\n')
      .action((opts: CommonOpts & { wallet: string; to: string; amount: string; token: string; idempotencyKey?: string | boolean; dryRun?: boolean }) => {
        const walletId = resolveWalletArg(undefined, opts.wallet);
        const idemKey = typeof opts.idempotencyKey === 'string' ? opts.idempotencyKey : crypto.randomUUID();
        return runCommand(opts, () =>
          txSendCommand(walletId, {
            to: opts.to,
            amount: opts.amount,
            token: opts.token,
            idempotencyKey: idemKey,
            dryRun: opts.dryRun
          })
        );
      })
  );
  withCommon(tx.command('list').description('List operations').requiredOption('--wallet <wallet>', 'Wallet name or address').option('--limit <n>', 'Limit', '50').addHelpText('after', '\nExample:\n  aw tx list --wallet alice --limit 50 --json\n').action((opts: CommonOpts & { wallet: string; limit: string }) => runCommand(opts, () => txHistoryCommand(resolveWalletArg(undefined, opts.wallet), requirePositiveInt(opts.limit, 'limit')))));
  withCommon(tx.command('status <tx_id>').description('Get operation status').addHelpText('after', '\nExample:\n  aw tx status tx_abc123 --json\n').action((txId: string, opts: CommonOpts) => runCommand(opts, () => txStatusCommand(txId))));

  const audit = program.command('audit').description('Audit log operations');
  withCommon(
    audit
      .command('list')
      .description('List audit logs')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .option('--action <action>', 'Filter by action')
      .option('--limit <n>', 'Limit', '50')
      .addHelpText('after', '\nExample:\n  aw audit list --wallet alice --limit 50 --json\n')
      .action((opts: CommonOpts & { wallet: string; action?: string; limit: string }) =>
        runCommand(opts, () => auditListCommand(resolveWalletArg(undefined, opts.wallet), { action: opts.action, limit: requirePositiveInt(opts.limit, 'limit') }))
      )
  );

  // Top-level policy commands (canonical entry point for agents)
  const policy = program.command('policy').description('Spending policy operations');
  withCommon(
    policy.command('show [wallet]').description('Show wallet spending policy').option('--wallet <wallet>', 'Wallet name or address').addHelpText('after', '\nExample:\n  aw policy show alice --json\n  aw policy show --wallet 0xCFEb...B0B --json\n').action((walletArg: string | undefined, opts: CommonOpts & { wallet?: string }) => runCommand(opts, () => policyShowCommand(resolveWalletArg(walletArg, opts.wallet))))
  );
  withCommon(
    policy
      .command('set [wallet]')
      .description('Set wallet spending limits')
      .option('--wallet <wallet>', 'Wallet name or address')
      .option('--limit-daily <n>', 'Daily spending limit')
      .option('--limit-per-tx <n>', 'Per transaction spending limit')
      .option('--max-tx-per-day <n>', 'Max transactions per day')
      .option('--allowed-tokens <tokens>', 'Comma-separated token list (e.g. POL,USDC)')
      .option('--allowed-addresses <addrs>', 'Comma-separated address allowlist')
      .option('--require-approval-above <n>', 'Require approval above this amount (0 to clear)')
      .addHelpText('after', '\nExample:\n  aw policy set alice --limit-daily 500 --limit-per-tx 100 --json\n  aw policy set --wallet alice --allowed-tokens POL,USDC --max-tx-per-day 50 --json\n')
      .action((walletArg: string | undefined, opts: CommonOpts & { wallet?: string; limitDaily?: string; limitPerTx?: string; maxTxPerDay?: string; allowedTokens?: string; allowedAddresses?: string; requireApprovalAbove?: string }) =>
        runCommand(opts, () => policySetCommand(resolveWalletArg(walletArg, opts.wallet), {
          limitDaily: opts.limitDaily,
          limitPerTx: opts.limitPerTx,
          maxTxPerDay: opts.maxTxPerDay,
          allowedTokens: opts.allowedTokens,
          allowedAddresses: opts.allowedAddresses,
          requireApprovalAbove: opts.requireApprovalAbove
        }))
      )
  );

  withCommon(
    program.command('health').description('Check system health (DB, RPC, session, polymarket CLI)').addHelpText('after', '\nExample:\n  aw health --json\n').action((opts: CommonOpts) =>
      runCommand(opts, async () => {
        const result = await healthCommand();
        if (!result.ok) {
          // Root-cause error classification — agents get actionable error codes
          let code: AppErrorCode = 'ERR_INTERNAL';
          let reason = 'System health check failed';
          if (!result.db.ok) {
            code = 'ERR_NOT_INITIALIZED';
            reason = result.db.error || 'Database not initialized';
          } else if (!result.rpc.ok) {
            code = 'ERR_RPC_UNAVAILABLE';
            reason = result.rpc.error || 'RPC unavailable';
          }
          const verbose = process.env.AW_HEALTH_VERBOSE === '1';
          const details: Record<string, unknown> = verbose
            ? (result as unknown as Record<string, unknown>)
            : { db: { ok: result.db.ok }, rpc: { ok: result.rpc.ok }, session: { ok: result.session.ok } };
          throw new AppError(code, reason, details);
        }
        return result;
      })
    )
  );

  // U-9: Lock command
  withCommon(
    program.command('lock').description('Lock session (clear credentials)').addHelpText('after', '\nExample:\n  aw lock --json\n').action((opts: CommonOpts) =>
      runCommand(opts, () => {
        clearSession();
        logAudit({ action: 'lock', request: {}, decision: 'ok' });
        return { status: 'locked' };
      })
    )
  );

  // Keychain commands
  const keychain = program.command('keychain').description('OS keychain operations for master password');
  withCommon(
    keychain.command('status').description('Check keychain availability and stored status').addHelpText('after', '\nExample:\n  aw keychain status --json\n').action((opts: CommonOpts) =>
      runCommand(opts, () => {
        const available = keychainAvailable();
        const stored = available ? keychainGet() !== null : false;
        return { available, stored };
      })
    )
  );
  withCommon(
    keychain.command('save').description('Save master password to OS keychain').addHelpText('after', '\nExample:\n  aw keychain save --json\n').action((opts: CommonOpts) =>
      runCommand(opts, async () => {
        if (!keychainAvailable()) {
          throw new AppError('ERR_INVALID_PARAMS', 'OS keychain not available on this platform');
        }
        const password = await getMasterPassword('Master password to save: ');
        const salt = getSetting('master_password_salt');
        const verifier = getSetting('master_password_verifier');
        const kdf = getSetting('master_password_kdf_params');
        if (!salt || !verifier) {
          throw new AppError('ERR_NOT_INITIALIZED', 'Not initialized. Run `aw init` first.');
        }
        if (!verifyMasterPassword(password, salt, verifier, kdf)) {
          throw new AppError('ERR_INVALID_PARAMS', 'Incorrect master password');
        }
        keychainSet(password);
        logAudit({ action: 'keychain.save', request: {}, decision: 'ok' });
        return { status: 'saved' };
      })
    )
  );
  withCommon(
    keychain.command('remove').description('Remove master password from OS keychain').addHelpText('after', '\nExample:\n  aw keychain remove --json\n').action((opts: CommonOpts) =>
      runCommand(opts, () => {
        if (!keychainAvailable()) {
          throw new AppError('ERR_INVALID_PARAMS', 'OS keychain not available on this platform');
        }
        keychainRemove();
        logAudit({ action: 'keychain.remove', request: {}, decision: 'ok' });
        return { status: 'removed' };
      })
    )
  );

  return program;
}

/** Extract machine-readable schema from a Commander command tree. */
export function commandSchema(cmd: Command): object {
  return {
    name: cmd.name(),
    description: cmd.description(),
    arguments: cmd.registeredArguments.map(a => ({
      name: a.name(),
      required: a.required,
      description: a.description,
      default: a.defaultValue
    })),
    options: cmd.options
      .filter(o => !['--json', '--output', '--non-interactive', '--request-id', '--timeout'].includes(o.long ?? ''))
      .map(o => ({
        flags: o.flags,
        description: o.description,
        required: o.required,
        default: o.defaultValue
      })),
    subcommands: cmd.commands.length > 0
      ? cmd.commands.map(c => commandSchema(c))
      : undefined
  };
}

