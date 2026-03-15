import { Command, Option } from 'commander';
import { initCommand } from './commands/init.js';
import { unlockCommand } from './commands/unlock.js';
import { runCommand, wantsJsonOutput } from './core/output.js';
import crypto from 'node:crypto';
import {
  walletAddressCommand,
  walletBalanceAllChainsCommand,
  walletBalanceAllCommand,
  walletBalanceAllWalletsAllChainsCommand,
  walletBalanceCommand,
  walletCreateCommand,
  walletExportKeyCommand,
  walletInfoCommand,
  walletListCommand
} from './commands/wallet.js';
import { txHistoryCommand, txSendCommand, txStatusCommand } from './commands/tx.js';
import { walletDrainCommand } from './commands/drain.js';
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
import { swapChainsCommand, swapQuoteCommand, swapExecCommand } from './commands/swap.js';
import { bridgeChainsCommand, bridgeQuoteCommand, bridgeExecCommand, bridgeStatusCommand } from './commands/bridge.js';
import { marketPriceCommand, marketCandlesCommand, marketTradesCommand } from './commands/market.js';
import { tokenSearchCommand, tokenInfoCommand, tokenTrendingCommand, tokenHoldersCommand } from './commands/token-cmd.js';
import { historyListCommand } from './commands/history.js';
import { perpAssetsCommand, perpPricesCommand, perpFundingCommand, perpAccountCommand, perpPositionsCommand, perpOrdersCommand, perpOpenCommand, perpCloseCommand, perpCancelCommand } from './commands/perp.js';
import { securityBlacklistAddCommand, securityBlacklistRemoveCommand, securityBlacklistListCommand, securityStatusCommand, securityBaselineInitCommand, securityBaselineVerifyCommand, securityReportCommand, securityAnomalyCommand } from './commands/security.js';

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
    .option('--timeout <ms>', 'RPC timeout in milliseconds (default: 30000)')
    .option('--chain <name>', 'Chain: ethereum|bnb|base|polygon|arbitrum|solana');
}

/** Like withCommon but without --chain (for predict commands hardcoded to Polygon).
 *  Hidden --chain accepted for agent-wrapper compat but silently ignored. */
function withCommonNoChain<T extends Command>(cmd: T): T {
  return cmd
    .option('--json', 'Output as JSON')
    .option('--output <format>', 'Output format: human|json')
    .option('--non-interactive', 'Disable interactive prompts')
    .option('--request-id <id>', 'Request id for tracing')
    .option('--timeout <ms>', 'RPC timeout in milliseconds (default: 30000)')
    .addOption(new Option('--chain <name>').hideHelp());
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
    program.command('init').description('Initialize local data store').addHelpText('after', '\nExample:\n  aw init --json\n  aw init --chain ethereum --json\n').action((opts: CommonOpts & { chain?: string }) => runCommand(opts, () => initCommand({ chain: opts.chain })))
  );

  withCommon(
    program.command('unlock').description('Unlock session').option('--single', 'Single-operation session (invalidates after one write)').addHelpText('after', '\nExample:\n  AW_MASTER_PASSWORD=*** aw unlock --json\n  AW_MASTER_PASSWORD=*** aw unlock --single --json\n').action((opts: CommonOpts & { single?: boolean }) => runCommand(opts, () => unlockCommand({ single: opts.single })))
  );

  const wallet = program.command('wallet').description('Wallet operations');

  withCommon(
    wallet
      .command('create')
      .description('Create wallet')
      .requiredOption('--name <name>', 'Wallet name')
      .addHelpText('after', '\nExample:\n  aw wallet create --name bot --json\n')
      .action((opts: CommonOpts & { name: string }) => runCommand({ ...opts, write: true }, () => walletCreateCommand(opts.name)))
  );
  withCommon(wallet.command('list').description('List wallets').addHelpText('after', '\nExample:\n  aw wallet list --json\n').action((opts: CommonOpts) => runCommand(opts, () => walletListCommand())));
  withCommon(wallet.command('info [wallet]').description('Get wallet info (wallet required as arg or --wallet)').option('--wallet <wallet>', 'Wallet name or address').addHelpText('after', '\nExample:\n  aw wallet info alice --json\n  aw wallet info --wallet 0xCFEb...B0B --json\n').action((walletArg: string | undefined, opts: CommonOpts & { wallet?: string }) => runCommand(opts, () => walletInfoCommand(resolveWalletArg(walletArg, opts.wallet)))));
  withCommon(wallet.command('balance [wallet]').description('Get wallet balance (wallet required unless --all)').option('--wallet <wallet>', 'Wallet name or address').option('--all', 'Show all wallets').addHelpText('after', '\nExample:\n  aw wallet balance alice --json\n  aw wallet balance --wallet 0xCFEb...B0B --json\n  aw wallet balance --all --json\n  aw wallet balance alice --chain ethereum --json\n  aw wallet balance alice --json              # all chains\n').action((walletArg: string | undefined, opts: CommonOpts & { wallet?: string; all?: boolean; chain?: string }) => {
    if (opts.all && opts.chain) return runCommand(opts, () => walletBalanceAllCommand(opts.chain));
    if (opts.all) return runCommand(opts, () => walletBalanceAllWalletsAllChainsCommand());
    const walletId = resolveWalletArg(walletArg, opts.wallet);
    if (opts.chain) return runCommand(opts, () => walletBalanceCommand(walletId, opts.chain));
    return runCommand(opts, () => walletBalanceAllChainsCommand(walletId));
  }));
  withCommon(wallet.command('deposit-address [wallet]').description('Get wallet deposit address (wallet required as arg or --wallet)').option('--wallet <wallet>', 'Wallet name or address').addHelpText('after', '\nExample:\n  aw wallet deposit-address alice --json\n  aw wallet deposit-address --wallet 0xCFEb...B0B --json\n  aw wallet deposit-address alice --chain solana --json\n').action((walletArg: string | undefined, opts: CommonOpts & { wallet?: string; chain?: string }) => runCommand(opts, () => walletAddressCommand(resolveWalletArg(walletArg, opts.wallet), opts.chain))));
  withCommon(
    wallet
      .command('export-key [wallet]')
      .description('Export wallet private key (wallet required as arg or --wallet)')
      .option('--wallet <wallet>', 'Wallet name or address')
      .option('--yes', 'Skip confirmation')
      .option('--danger-export', 'Confirm you want to export the private key')
      .option('--force', 'Skip yellow-line security warnings')
      .addHelpText('after', '\nExample:\n  AW_ALLOW_EXPORT=1 aw wallet export-key alice --danger-export --yes --json\n')
      .action((walletArg: string | undefined, opts: CommonOpts & { wallet?: string; dangerExport?: boolean; force?: boolean }) => runCommand({ ...opts, skipRedact: true }, () => walletExportKeyCommand(resolveWalletArg(walletArg, opts.wallet), Boolean(opts.yes), Boolean(opts.dangerExport), Boolean(opts.force))))
  );
  withCommon(
    wallet
      .command('drain [wallet]')
      .description('Drain all tokens to a destination (wallet required as arg or --wallet)')
      .option('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--to <address>', 'Destination address')
      .option('--idempotency-key [key]', 'Idempotency key for retry safety (auto-generated if omitted)')
      .option('--dry-run', 'Preview drain plan without executing transfers')
      .option('--force', 'Skip yellow-line security warnings')
      .option('--yes', 'Auto-confirm red-line security prompts')
      .addHelpText('after', '\nExample:\n  aw wallet drain alice --to 0x742d... --json\n  aw wallet drain alice --to 0x742d... --dry-run --json\n  aw wallet drain --wallet alice --to 0x742d... --idempotency-key drain1 --json\n  aw wallet drain alice --to 0x742d... --chain ethereum --json\n')
      .action((walletArg: string | undefined, opts: CommonOpts & { wallet?: string; to: string; idempotencyKey?: string | boolean; dryRun?: boolean; chain?: string; force?: boolean }) => {
        const walletId = resolveWalletArg(walletArg, opts.wallet);
        const idemKey = typeof opts.idempotencyKey === 'string' ? opts.idempotencyKey : undefined;
        return runCommand({ ...opts, write: !opts.dryRun }, () => walletDrainCommand(walletId, { to: opts.to, idempotencyKey: idemKey, dryRun: opts.dryRun, chain: opts.chain, force: opts.force, yes: opts.yes }));
      })
  );
  withCommon(wallet.command('settings [wallet]').description('Show wallet policy (alias for: aw policy show; wallet required as arg or --wallet)').option('--wallet <wallet>', 'Wallet name or address').addHelpText('after', '\nExample:\n  aw wallet settings alice --json\n').action((walletArg: string | undefined, opts: CommonOpts & { wallet?: string }) => runCommand(opts, () => policyShowCommand(resolveWalletArg(walletArg, opts.wallet)))));
  withCommon(
    wallet
      .command('settings-set [wallet]')
      .description('Set wallet limits (alias for: aw policy set; wallet required as arg or --wallet)')
      .option('--wallet <wallet>', 'Wallet name or address')
      .option('--limit-daily <n>', 'Daily spending limit')
      .option('--limit-per-tx <n>', 'Per transaction spending limit')
      .option('--max-tx-per-day <n>', 'Max transactions per day')
      .option('--allowed-tokens <tokens>', 'Comma-separated token list (e.g. POL,USDC)')
      .option('--allowed-addresses <addrs>', 'Comma-separated address allowlist')
      .option('--require-approval-above <n>', 'Require approval above this amount (0 to clear)')
      .option('--force', 'Skip yellow-line security warnings')
      .option('--yes', 'Auto-confirm red-line security prompts')
      .addHelpText(
        'after',
        '\nExample:\n  aw wallet settings-set alice --limit-daily 500 --limit-per-tx 100 --json\n'
      )
      .action((walletArg: string | undefined, opts: CommonOpts & { wallet?: string; limitDaily?: string; limitPerTx?: string; maxTxPerDay?: string; allowedTokens?: string; allowedAddresses?: string; requireApprovalAbove?: string; force?: boolean }) =>
        runCommand({ ...opts, write: true }, () =>
          policySetCommand(resolveWalletArg(walletArg, opts.wallet), {
            limitDaily: opts.limitDaily,
            limitPerTx: opts.limitPerTx,
            maxTxPerDay: opts.maxTxPerDay,
            allowedTokens: opts.allowedTokens,
            allowedAddresses: opts.allowedAddresses,
            requireApprovalAbove: opts.requireApprovalAbove,
            force: opts.force,
            yes: opts.yes
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
      .requiredOption('--token <symbol>', 'Token symbol (e.g. POL, ETH, USDC, USDT)')
      .option('--idempotency-key [key]', 'Idempotency key for retry safety (auto-generated if omitted)')
      .option('--dry-run', 'Validate without broadcasting')
      .option('--force', 'Skip yellow-line security warnings')
      .option('--yes', 'Auto-confirm red-line security prompts')
      .addHelpText(
        'after',
        '\nUsage:\n  aw send --wallet alice --to <address> --amount <n> --token <symbol>\n\nExample:\n  aw send --wallet alice --to 0x742d... --amount 1 --token USDC --json\n  aw send --wallet alice --to 0x742d... --amount 1 --token USDC --idempotency-key s1 --json\n  aw send --wallet alice --to 0x742d... --amount 1 --token ETH --chain ethereum --json\n'
      )
      .action((opts: CommonOpts & { wallet: string; to: string; amount: string; token: string; idempotencyKey?: string | boolean; dryRun?: boolean; chain?: string; force?: boolean }) => {
        const walletId = resolveWalletArg(undefined, opts.wallet);
        const idemKey = typeof opts.idempotencyKey === 'string' ? opts.idempotencyKey : crypto.randomUUID();
        return runCommand({ ...opts, write: true }, () =>
          txSendCommand(walletId, {
            to: opts.to,
            amount: opts.amount,
            token: opts.token,
            idempotencyKey: idemKey,
            dryRun: opts.dryRun,
            chain: opts.chain,
            force: opts.force,
            yes: opts.yes
          })
        );
      })
  );

  const predict = program.command('predict').description('Prediction market operations (Polymarket, requires USDC.e on Polygon)');
  withCommonNoChain(
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
  withCommonNoChain(
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
      .option('--force', 'Skip yellow-line security warnings')
      .option('--yes', 'Auto-confirm red-line security prompts')
      .addHelpText('after', '\nNote: Polymarket uses USDC.e (bridged) on Polygon, not native USDC.\n  Ensure wallet has USDC.e balance. Use `aw swap` to convert USDC → USDC.e if needed.\n  Run `aw predict approve-set` before first trade.\n\nExample:\n  aw predict buy --wallet alice --market mkt_xxx --outcome yes --size 10 --price 0.4 --json\n')
      .action((opts: CommonOpts & { wallet: string; market: string; outcome: string; size: string; price: string; idempotencyKey?: string | boolean; dryRun?: boolean; force?: boolean }) => {
        const walletId = resolveWalletArg(undefined, opts.wallet);
        const idemKey = typeof opts.idempotencyKey === 'string' ? opts.idempotencyKey : crypto.randomUUID();
        return runCommand({ ...opts, write: true }, () =>
          polyBuyCommand(walletId, {
            market: opts.market,
            outcome: opts.outcome,
            size: opts.size,
            price: opts.price,
            idempotencyKey: idemKey,
            dryRun: opts.dryRun,
            force: opts.force,
            yes: opts.yes
          })
        );
      })
  );
  withCommonNoChain(
    predict
      .command('sell')
      .description('Sell existing position')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--position <position_id>', 'Position id')
      .requiredOption('--size <n>', 'Size')
      .option('--idempotency-key [key]', 'Idempotency key for retry safety (auto-generated if omitted)')
      .option('--dry-run', 'Validate without placing order')
      .option('--force', 'Skip yellow-line security warnings')
      .option('--yes', 'Auto-confirm red-line security prompts')
      .addHelpText('after', '\nNote: Polymarket uses USDC.e (bridged) on Polygon. Run `aw predict approve-set` before first trade.\n\nExample:\n  aw predict sell --wallet alice --position pos_xxx --size 5 --json\n')
      .action((opts: CommonOpts & { wallet: string; position: string; size: string; idempotencyKey?: string | boolean; dryRun?: boolean; force?: boolean }) => {
        const walletId = resolveWalletArg(undefined, opts.wallet);
        const idemKey = typeof opts.idempotencyKey === 'string' ? opts.idempotencyKey : crypto.randomUUID();
        return runCommand({ ...opts, write: true }, () =>
          polySellCommand(walletId, {
            position: opts.position,
            size: opts.size,
            idempotencyKey: idemKey,
            dryRun: opts.dryRun,
            force: opts.force,
            yes: opts.yes
          })
        );
      })
  );
  withCommonNoChain(predict.command('positions').description('List positions').requiredOption('--wallet <wallet>', 'Wallet name or address').addHelpText('after', '\nExample:\n  aw predict positions --wallet alice --json\n').action((opts: CommonOpts & { wallet: string }) => runCommand(opts, () => polyPositionsCommand(resolveWalletArg(undefined, opts.wallet)))));
  withCommonNoChain(predict.command('orders').description('List orders').requiredOption('--wallet <wallet>', 'Wallet name or address').addHelpText('after', '\nExample:\n  aw predict orders --wallet alice --json\n').action((opts: CommonOpts & { wallet: string }) => runCommand(opts, () => polyOrdersCommand(resolveWalletArg(undefined, opts.wallet)))));
  withCommonNoChain(
    predict
      .command('cancel')
      .description('Cancel an open order')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--order-id <order_id>', 'Order id to cancel')
      .option('--force', 'Skip yellow-line security warnings')
      .option('--yes', 'Auto-confirm red-line security prompts')
      .addHelpText('after', '\nExample:\n  aw predict cancel --wallet alice --order-id <order_id> --json\n')
      .action((opts: CommonOpts & { wallet: string; orderId: string; force?: boolean; yes?: boolean }) =>
        runCommand({ ...opts, write: true }, () => polyCancelCommand(resolveWalletArg(undefined, opts.wallet), opts.orderId, { force: opts.force, yes: opts.yes }))
      )
  );
  withCommonNoChain(
    predict
      .command('approve-check')
      .description('Check contract approval status')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .addHelpText('after', '\nExample:\n  aw predict approve-check --wallet alice --json\n')
      .action((opts: CommonOpts & { wallet: string }) =>
        runCommand(opts, () => polyApproveCheckCommand(resolveWalletArg(undefined, opts.wallet)))
      )
  );
  withCommonNoChain(
    predict
      .command('approve-set')
      .description('Execute contract approvals for USDC.e trading (required before first trade)')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .option('--force', 'Skip yellow-line security warnings')
      .option('--yes', 'Auto-confirm red-line security prompts')
      .addHelpText('after', '\nApproves USDC.e and CTF token contracts for Polymarket Exchange.\nMust be run once per wallet before placing orders.\n\nExample:\n  aw predict approve-set --wallet alice --json\n')
      .action((opts: CommonOpts & { wallet: string; force?: boolean; yes?: boolean }) =>
        runCommand({ ...opts, write: true }, () => polyApproveSetCommand(resolveWalletArg(undefined, opts.wallet), { force: opts.force, yes: opts.yes }))
      )
  );
  withCommonNoChain(
    predict
      .command('update-balance')
      .description('Refresh CLOB collateral balance cache')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .option('--force', 'Skip yellow-line security warnings')
      .option('--yes', 'Auto-confirm red-line security prompts')
      .addHelpText('after', '\nExample:\n  aw predict update-balance --wallet alice --json\n')
      .action((opts: CommonOpts & { wallet: string; force?: boolean; yes?: boolean }) =>
        runCommand({ ...opts, write: true }, () => polyUpdateBalanceCommand(resolveWalletArg(undefined, opts.wallet), { force: opts.force, yes: opts.yes }))
      )
  );
  withCommonNoChain(
    predict
      .command('ctf-split')
      .description('Split USDC.e collateral into Yes+No outcome tokens')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--condition <condition_id>', 'Condition ID (0x-prefixed)')
      .requiredOption('--amount <n>', 'Amount in USDC')
      .option('--force', 'Skip yellow-line security warnings')
      .option('--yes', 'Auto-confirm red-line security prompts')
      .addHelpText('after', '\nExample:\n  aw predict ctf-split --wallet alice --condition 0xabc... --amount 5 --json\n')
      .action((opts: CommonOpts & { wallet: string; condition: string; amount: string; force?: boolean; yes?: boolean }) =>
        runCommand({ ...opts, write: true }, () => polyCtfSplitCommand(resolveWalletArg(undefined, opts.wallet), { condition: opts.condition, amount: opts.amount, force: opts.force, yes: opts.yes }))
      )
  );
  withCommonNoChain(
    predict
      .command('ctf-merge')
      .description('Merge Yes+No outcome tokens back into USDC.e collateral')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--condition <condition_id>', 'Condition ID (0x-prefixed)')
      .requiredOption('--amount <n>', 'Amount in USDC')
      .option('--force', 'Skip yellow-line security warnings')
      .option('--yes', 'Auto-confirm red-line security prompts')
      .addHelpText('after', '\nExample:\n  aw predict ctf-merge --wallet alice --condition 0xabc... --amount 5 --json\n')
      .action((opts: CommonOpts & { wallet: string; condition: string; amount: string; force?: boolean; yes?: boolean }) =>
        runCommand({ ...opts, write: true }, () => polyCtfMergeCommand(resolveWalletArg(undefined, opts.wallet), { condition: opts.condition, amount: opts.amount, force: opts.force, yes: opts.yes }))
      )
  );
  withCommonNoChain(
    predict
      .command('ctf-redeem')
      .description('Redeem winning tokens after market resolution')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--condition <condition_id>', 'Condition ID (0x-prefixed)')
      .option('--force', 'Skip yellow-line security warnings')
      .option('--yes', 'Auto-confirm red-line security prompts')
      .addHelpText('after', '\nExample:\n  aw predict ctf-redeem --wallet alice --condition 0xabc... --json\n')
      .action((opts: CommonOpts & { wallet: string; condition: string; force?: boolean; yes?: boolean }) =>
        runCommand({ ...opts, write: true }, () => polyCtfRedeemCommand(resolveWalletArg(undefined, opts.wallet), { condition: opts.condition, force: opts.force, yes: opts.yes }))
      )
  );
  withCommonNoChain(
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
      .requiredOption('--token <symbol>', 'Token symbol (e.g. POL, ETH, USDC, USDT)')
      .option('--idempotency-key [key]', 'Idempotency key for retry safety (auto-generated if omitted)')
      .option('--dry-run', 'Validate without broadcasting')
      .option('--force', 'Skip yellow-line security warnings')
      .option('--yes', 'Auto-confirm red-line security prompts')
      .addHelpText('after', '\nExample:\n  aw tx send --wallet alice --to 0x742d... --amount 1 --token USDC --json\n')
      .action((opts: CommonOpts & { wallet: string; to: string; amount: string; token: string; idempotencyKey?: string | boolean; dryRun?: boolean; chain?: string; force?: boolean }) => {
        const walletId = resolveWalletArg(undefined, opts.wallet);
        const idemKey = typeof opts.idempotencyKey === 'string' ? opts.idempotencyKey : crypto.randomUUID();
        return runCommand({ ...opts, write: true }, () =>
          txSendCommand(walletId, {
            to: opts.to,
            amount: opts.amount,
            token: opts.token,
            idempotencyKey: idemKey,
            dryRun: opts.dryRun,
            chain: opts.chain,
            force: opts.force,
            yes: opts.yes
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
    policy.command('show [wallet]').description('Show wallet spending policy (wallet required as arg or --wallet)').option('--wallet <wallet>', 'Wallet name or address').addHelpText('after', '\nExample:\n  aw policy show alice --json\n  aw policy show --wallet 0xCFEb...B0B --json\n').action((walletArg: string | undefined, opts: CommonOpts & { wallet?: string }) => runCommand(opts, () => policyShowCommand(resolveWalletArg(walletArg, opts.wallet))))
  );
  withCommon(
    policy
      .command('set [wallet]')
      .description('Set wallet spending limits (wallet required as arg or --wallet)')
      .option('--wallet <wallet>', 'Wallet name or address')
      .option('--limit-daily <n>', 'Daily spending limit')
      .option('--limit-per-tx <n>', 'Per transaction spending limit')
      .option('--max-tx-per-day <n>', 'Max transactions per day')
      .option('--allowed-tokens <tokens>', 'Comma-separated token list (e.g. POL,USDC)')
      .option('--allowed-addresses <addrs>', 'Comma-separated address allowlist')
      .option('--require-approval-above <n>', 'Require approval above this amount (0 to clear)')
      .option('--force', 'Skip yellow-line security warnings')
      .option('--yes', 'Auto-confirm red-line security prompts')
      .addHelpText('after', '\nExample:\n  aw policy set alice --limit-daily 500 --limit-per-tx 100 --json\n  aw policy set --wallet alice --allowed-tokens POL,USDC --max-tx-per-day 50 --json\n')
      .action((walletArg: string | undefined, opts: CommonOpts & { wallet?: string; limitDaily?: string; limitPerTx?: string; maxTxPerDay?: string; allowedTokens?: string; allowedAddresses?: string; requireApprovalAbove?: string; force?: boolean }) =>
        runCommand({ ...opts, write: true }, () => policySetCommand(resolveWalletArg(walletArg, opts.wallet), {
          limitDaily: opts.limitDaily,
          limitPerTx: opts.limitPerTx,
          maxTxPerDay: opts.maxTxPerDay,
          allowedTokens: opts.allowedTokens,
          allowedAddresses: opts.allowedAddresses,
          requireApprovalAbove: opts.requireApprovalAbove,
          force: opts.force,
          yes: opts.yes
        }))
      )
  );

  withCommon(
    program.command('health').description('Check system health (DB, RPC, session, Polymarket SDK)').addHelpText('after', '\nExample:\n  aw health --json\n  aw health --chain solana --json\n').action((opts: CommonOpts & { chain?: string }) =>
      runCommand(opts, async () => {
        const result = await healthCommand(opts.chain);
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

  // ── Swap (DEX aggregator) ──
  const swap = program.command('swap').description('DEX swap operations (via OKX)');
  withCommon(
    swap.command('chains').description('List supported chains for DEX swap')
      .addHelpText('after', '\nExample:\n  aw swap chains --json\n')
      .action((opts: CommonOpts & { chain?: string }) => runCommand(opts, () => swapChainsCommand(opts)))
  );
  withCommon(
    swap.command('quote').description('Get swap quote (no execution)')
      .requiredOption('--from <token>', 'From token symbol or address')
      .requiredOption('--to <token>', 'To token symbol or address')
      .requiredOption('--amount <n>', 'Amount to swap')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .option('--slippage <n>', 'Slippage tolerance (default: 0.5%)')
      .addHelpText('after', '\nExample:\n  aw swap quote --from ETH --to USDC --amount 1 --wallet alice --chain ethereum --json\n')
      .action((opts: CommonOpts & { from: string; to: string; amount: string; wallet: string; slippage?: string; chain?: string }) =>
        runCommand(opts, () => swapQuoteCommand(opts))
      )
  );
  withCommon(
    swap.command('exec').description('Execute token swap')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--from <token>', 'From token symbol or address')
      .requiredOption('--to <token>', 'To token symbol or address')
      .requiredOption('--amount <n>', 'Amount to swap')
      .option('--slippage <n>', 'Slippage tolerance (default: 0.5%)')
      .option('--idempotency-key [key]', 'Idempotency key for retry safety (auto-generated if omitted)')
      .option('--dry-run', 'Validate without executing')
      .option('--force', 'Skip yellow-line security warnings')
      .option('--yes', 'Auto-confirm red-line security prompts')
      .addHelpText('after', '\nExample:\n  aw swap exec --wallet alice --from ETH --to USDC --amount 0.1 --chain ethereum --json\n')
      .action((opts: CommonOpts & { wallet: string; from: string; to: string; amount: string; slippage?: string; idempotencyKey?: string | boolean; dryRun?: boolean; chain?: string; force?: boolean }) => {
        const walletId = resolveWalletArg(undefined, opts.wallet);
        const idemKey = typeof opts.idempotencyKey === 'string' ? opts.idempotencyKey : crypto.randomUUID();
        return runCommand({ ...opts, write: !opts.dryRun }, () =>
          swapExecCommand(walletId, {
            chain: opts.chain,
            from: opts.from,
            to: opts.to,
            amount: opts.amount,
            slippage: opts.slippage,
            idempotencyKey: idemKey,
            dryRun: opts.dryRun,
            force: opts.force,
            yes: opts.yes,
          })
        );
      })
  );

  // ── Bridge (cross-chain) ──
  const bridge = program.command('bridge').description('Cross-chain bridge operations (via OKX)');
  withCommon(
    bridge.command('chains').description('List supported bridge chains')
      .addHelpText('after', '\nExample:\n  aw bridge chains --json\n')
      .action((opts: CommonOpts) => runCommand(opts, () => bridgeChainsCommand()))
  );
  withCommon(
    bridge.command('quote').description('Get bridge quote')
      .requiredOption('--from-chain <chain>', 'Source chain')
      .requiredOption('--to-chain <chain>', 'Destination chain')
      .requiredOption('--from-token <token>', 'From token')
      .requiredOption('--to-token <token>', 'To token')
      .requiredOption('--amount <n>', 'Amount')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .addHelpText('after', '\nExample:\n  aw bridge quote --from-chain ethereum --to-chain polygon --from-token ETH --to-token ETH --amount 0.1 --wallet alice --json\n')
      .action((opts: CommonOpts & { fromChain: string; toChain: string; fromToken: string; toToken: string; amount: string; wallet: string }) =>
        runCommand(opts, () => bridgeQuoteCommand(opts))
      )
  );
  withCommon(
    bridge.command('exec').description('Execute cross-chain bridge')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--from-chain <chain>', 'Source chain')
      .requiredOption('--to-chain <chain>', 'Destination chain')
      .requiredOption('--from-token <token>', 'From token')
      .requiredOption('--to-token <token>', 'To token')
      .requiredOption('--amount <n>', 'Amount')
      .option('--idempotency-key [key]', 'Idempotency key (auto-generated if omitted)')
      .option('--force', 'Skip yellow-line security warnings')
      .option('--yes', 'Auto-confirm red-line security prompts')
      .addHelpText('after', '\nExample:\n  aw bridge exec --wallet alice --from-chain ethereum --to-chain polygon --from-token ETH --to-token ETH --amount 0.1 --json\n')
      .action((opts: CommonOpts & { wallet: string; fromChain: string; toChain: string; fromToken: string; toToken: string; amount: string; idempotencyKey?: string | boolean; force?: boolean }) => {
        const walletId = resolveWalletArg(undefined, opts.wallet);
        const idemKey = typeof opts.idempotencyKey === 'string' ? opts.idempotencyKey : crypto.randomUUID();
        return runCommand({ ...opts, write: true }, () =>
          bridgeExecCommand(walletId, {
            fromChain: opts.fromChain,
            toChain: opts.toChain,
            fromToken: opts.fromToken,
            toToken: opts.toToken,
            amount: opts.amount,
            idempotencyKey: idemKey,
            force: opts.force,
            yes: opts.yes,
          })
        );
      })
  );
  withCommon(
    bridge.command('status <tx_hash>').description('Check bridge transaction status')
      .addHelpText('after', '\nExample:\n  aw bridge status 0xabc... --chain ethereum --json\n')
      .action((txHash: string, opts: CommonOpts & { chain?: string }) =>
        runCommand(opts, () => bridgeStatusCommand(txHash, opts))
      )
  );

  // ── Market (read-only) ──
  const market = program.command('market').description('Market data (via OKX)');
  withCommon(
    market.command('price').description('Get real-time token price')
      .requiredOption('--token <token>', 'Token symbol or address')
      .addHelpText('after', '\nExample:\n  aw market price --token ETH --chain ethereum --json\n')
      .action((opts: CommonOpts & { token: string; chain?: string }) =>
        runCommand(opts, () => marketPriceCommand(opts))
      )
  );
  withCommon(
    market.command('candles').description('Get K-line (OHLCV) data')
      .requiredOption('--token <token>', 'Token symbol or address')
      .requiredOption('--interval <bar>', 'Interval (1m,5m,15m,1H,4H,1D)')
      .option('--limit <n>', 'Number of candles', '100')
      .addHelpText('after', '\nExample:\n  aw market candles --token ETH --interval 1H --limit 24 --chain ethereum --json\n')
      .action((opts: CommonOpts & { token: string; interval: string; limit?: string; chain?: string }) =>
        runCommand(opts, () => marketCandlesCommand(opts))
      )
  );
  withCommon(
    market.command('trades').description('Get recent trades')
      .requiredOption('--token <token>', 'Token symbol or address')
      .option('--limit <n>', 'Number of trades', '50')
      .addHelpText('after', '\nExample:\n  aw market trades --token ETH --limit 20 --chain ethereum --json\n')
      .action((opts: CommonOpts & { token: string; limit?: string; chain?: string }) =>
        runCommand(opts, () => marketTradesCommand(opts))
      )
  );

  // ── Token (read-only) ──
  const token = program.command('token').description('Token discovery (via OKX)');
  withCommon(
    token.command('search').description('Search tokens by keyword')
      .requiredOption('--keyword <keyword>', 'Search keyword')
      .addHelpText('after', '\nExample:\n  aw token search --keyword USDC --chain ethereum --json\n')
      .action((opts: CommonOpts & { keyword: string; chain?: string }) =>
        runCommand(opts, () => tokenSearchCommand(opts))
      )
  );
  withCommon(
    token.command('info').description('Get token details')
      .requiredOption('--address <address>', 'Token contract address')
      .addHelpText('after', '\nExample:\n  aw token info --address 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --chain ethereum --json\n')
      .action((opts: CommonOpts & { address: string; chain?: string }) =>
        runCommand(opts, () => tokenInfoCommand(opts))
      )
  );
  withCommon(
    token.command('trending').description('Get trending tokens')
      .addHelpText('after', '\nExample:\n  aw token trending --chain ethereum --json\n')
      .action((opts: CommonOpts & { chain?: string }) =>
        runCommand(opts, () => tokenTrendingCommand(opts))
      )
  );
  withCommon(
    token.command('holders').description('Get top token holders')
      .requiredOption('--address <address>', 'Token contract address or symbol')
      .addHelpText('after', '\nExample:\n  aw token holders --chain ethereum --address USDC --json\n')
      .action((opts: CommonOpts & { address: string; chain?: string }) =>
        runCommand(opts, () => tokenHoldersCommand(opts))
      )
  );

  // ── History (on-chain, via OKX) ──
  const history = program.command('history').description('On-chain transaction history (via OKX)');
  withCommon(
    history.command('list').description('List on-chain transactions')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .option('--limit <n>', 'Number of transactions', '50')
      .addHelpText('after', '\nExample:\n  aw history list --wallet alice --chain ethereum --json\n')
      .action((opts: CommonOpts & { wallet: string; limit?: string; chain?: string }) =>
        runCommand(opts, () => historyListCommand(opts))
      )
  );

  // ── Perp (Hyperliquid perpetual contracts) ──
  // Perp commands are Hyperliquid-only. --chain is hidden (silently ignored) like predict commands.
  const perp = program.command('perp').description('Perpetual contract operations (via Hyperliquid)');
  withCommonNoChain(
    perp.command('assets').description('List tradable perpetual assets')
      .addHelpText('after', '\nExample:\n  aw perp assets --json\n')
      .action((opts: CommonOpts) => runCommand(opts, () => perpAssetsCommand()))
  );
  withCommonNoChain(
    perp.command('prices').description('Get current mid prices')
      .option('--asset <asset>', 'Filter by asset symbol (e.g. BTC)')
      .addHelpText('after', '\nExample:\n  aw perp prices --json\n  aw perp prices --asset BTC --json\n')
      .action((opts: CommonOpts & { asset?: string }) =>
        runCommand(opts, () => perpPricesCommand({ asset: opts.asset }))
      )
  );
  withCommonNoChain(
    perp.command('funding').description('Get funding rates for an asset')
      .requiredOption('--asset <asset>', 'Asset symbol (e.g. BTC)')
      .addHelpText('after', '\nExample:\n  aw perp funding --asset BTC --json\n')
      .action((opts: CommonOpts & { asset: string }) =>
        runCommand(opts, () => perpFundingCommand({ asset: opts.asset }))
      )
  );
  withCommonNoChain(
    perp.command('account').description('Account overview (margin, positions, PnL)')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .addHelpText('after', '\nExample:\n  aw perp account --wallet alice --json\n')
      .action((opts: CommonOpts & { wallet: string }) =>
        runCommand(opts, () => perpAccountCommand(resolveWalletArg(undefined, opts.wallet)))
      )
  );
  withCommonNoChain(
    perp.command('positions').description('List current positions')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .addHelpText('after', '\nExample:\n  aw perp positions --wallet alice --json\n')
      .action((opts: CommonOpts & { wallet: string }) =>
        runCommand(opts, () => perpPositionsCommand(resolveWalletArg(undefined, opts.wallet)))
      )
  );
  withCommonNoChain(
    perp.command('orders').description('List open orders')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .addHelpText('after', '\nExample:\n  aw perp orders --wallet alice --json\n')
      .action((opts: CommonOpts & { wallet: string }) =>
        runCommand(opts, () => perpOrdersCommand(resolveWalletArg(undefined, opts.wallet)))
      )
  );
  withCommonNoChain(
    perp.command('open').description('Open a perpetual position')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--asset <asset>', 'Asset symbol (e.g. BTC, ETH)')
      .requiredOption('--side <side>', 'Position side: long or short')
      .requiredOption('--size <n>', 'Position size in base currency')
      .option('--leverage <n>', 'Leverage (default: 1)')
      .option('--idempotency-key [key]', 'Idempotency key (auto-generated if omitted)')
      .option('--dry-run', 'Validate without executing')
      .option('--force', 'Skip yellow-line security warnings')
      .option('--yes', 'Auto-confirm red-line security prompts')
      .addHelpText('after', '\nExample:\n  aw perp open --wallet alice --asset BTC --side long --size 0.01 --leverage 5 --json\n')
      .action((opts: CommonOpts & { wallet: string; asset: string; side: string; size: string; leverage?: string; idempotencyKey?: string | boolean; dryRun?: boolean; force?: boolean }) => {
        const walletId = resolveWalletArg(undefined, opts.wallet);
        const idemKey = typeof opts.idempotencyKey === 'string' ? opts.idempotencyKey : crypto.randomUUID();
        return runCommand({ ...opts, write: !opts.dryRun }, () =>
          perpOpenCommand(walletId, {
            asset: opts.asset,
            side: opts.side,
            size: opts.size,
            leverage: opts.leverage,
            idempotencyKey: idemKey,
            dryRun: opts.dryRun,
            force: opts.force,
            yes: opts.yes,
          })
        );
      })
  );
  withCommonNoChain(
    perp.command('close').description('Close a perpetual position')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--asset <asset>', 'Asset symbol (e.g. BTC)')
      .option('--size <n>', 'Size to close (default: full position)')
      .option('--idempotency-key [key]', 'Idempotency key (auto-generated if omitted)')
      .option('--dry-run', 'Validate without executing')
      .option('--force', 'Skip yellow-line security warnings')
      .option('--yes', 'Auto-confirm red-line security prompts')
      .addHelpText('after', '\nExample:\n  aw perp close --wallet alice --asset BTC --json\n  aw perp close --wallet alice --asset BTC --size 0.005 --json\n')
      .action((opts: CommonOpts & { wallet: string; asset: string; size?: string; idempotencyKey?: string | boolean; dryRun?: boolean; force?: boolean }) => {
        const walletId = resolveWalletArg(undefined, opts.wallet);
        const idemKey = typeof opts.idempotencyKey === 'string' ? opts.idempotencyKey : crypto.randomUUID();
        return runCommand({ ...opts, write: !opts.dryRun }, () =>
          perpCloseCommand(walletId, {
            asset: opts.asset,
            size: opts.size,
            idempotencyKey: idemKey,
            dryRun: opts.dryRun,
            force: opts.force,
            yes: opts.yes,
          })
        );
      })
  );
  withCommonNoChain(
    perp.command('cancel').description('Cancel an open order')
      .requiredOption('--wallet <wallet>', 'Wallet name or address')
      .requiredOption('--asset <asset>', 'Asset symbol')
      .requiredOption('--order-id <oid>', 'Order ID to cancel')
      .option('--idempotency-key [key]', 'Idempotency key (auto-generated if omitted)')
      .option('--force', 'Skip yellow-line security warnings')
      .option('--yes', 'Auto-confirm red-line security prompts')
      .addHelpText('after', '\nExample:\n  aw perp cancel --wallet alice --asset BTC --order-id 12345 --json\n')
      .action((opts: CommonOpts & { wallet: string; asset: string; orderId: string; idempotencyKey?: string | boolean; force?: boolean; yes?: boolean }) => {
        const walletId = resolveWalletArg(undefined, opts.wallet);
        const idemKey = typeof opts.idempotencyKey === 'string' ? opts.idempotencyKey : crypto.randomUUID();
        return runCommand({ ...opts, write: true }, () =>
          perpCancelCommand(walletId, {
            asset: opts.asset,
            orderId: opts.orderId,
            idempotencyKey: idemKey,
            force: opts.force,
            yes: opts.yes,
          })
        );
      })
  );

  // ── Security commands ──
  const security = program.command('security').description('Security operations');

  withCommon(
    security.command('status').description('Show security status')
      .addHelpText('after', '\nExample:\n  aw security status --json\n')
      .action((opts: CommonOpts) => runCommand(opts, () => securityStatusCommand()))
  );

  const blacklist = security.command('blacklist').description('Manage address blacklist');

  withCommon(
    blacklist.command('add').description('Add address to blacklist')
      .requiredOption('--address <address>', 'Address to blacklist')
      .option('--reason <reason>', 'Reason for blacklisting')
      .addHelpText('after', '\nExample:\n  aw security blacklist add --address 0xdead... --reason "known scam" --json\n  aw security blacklist add --address 0xdead... --chain polygon --json\n')
      .action((opts: CommonOpts & { address: string; chain?: string; reason?: string }) =>
        runCommand({ ...opts, write: true }, () => securityBlacklistAddCommand(opts.address, { chain: opts.chain, reason: opts.reason }))
      )
  );

  withCommon(
    blacklist.command('remove').description('Remove address from blacklist')
      .requiredOption('--address <address>', 'Address to remove')
      .addHelpText('after', '\nExample:\n  aw security blacklist remove --address 0xdead... --json\n')
      .action((opts: CommonOpts & { address: string }) =>
        runCommand({ ...opts, write: true }, () => securityBlacklistRemoveCommand(opts.address))
      )
  );

  withCommon(
    blacklist.command('list').description('List blacklisted addresses')
      .addHelpText('after', '\nExample:\n  aw security blacklist list --json\n')
      .action((opts: CommonOpts) => runCommand(opts, () => securityBlacklistListCommand()))
  );

  // ── Baseline ──
  const baseline = security.command('baseline').description('Config baseline verification');

  withCommon(
    baseline.command('init').description('Initialize config baseline hashes')
      .action((opts: CommonOpts) => runCommand({ ...opts, write: true }, () => securityBaselineInitCommand()))
  );

  withCommon(
    baseline.command('verify').description('Verify config baseline hashes')
      .action((opts: CommonOpts) => runCommand(opts, () => securityBaselineVerifyCommand()))
  );

  // ── Report ──
  withCommon(
    security.command('report').description('Generate security report')
      .option('--wallet <id>', 'Filter by wallet ID')
      .option('--days <n>', 'Number of days to cover (default: 7)')
      .action((opts: CommonOpts & { wallet?: string; days?: string }) =>
        runCommand(opts, () => securityReportCommand({ wallet: opts.wallet, days: opts.days }))
      )
  );

  // ── Anomaly ──
  withCommon(
    security.command('anomaly <wallet>').description('Detect anomalies for a wallet')
      .option('--days <n>', 'Number of days to cover (default: 7)')
      .action((wallet: string, opts: CommonOpts & { days?: string }) =>
        runCommand(opts, () => securityAnomalyCommand(wallet, { days: opts.days }))
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
      .filter(o => !o.hidden && !['--json', '--output', '--non-interactive', '--request-id', '--timeout'].includes(o.long ?? ''))
      .map(o => ({
        flags: o.flags,
        description: o.description,
        required: o.mandatory ?? false,
        default: o.defaultValue
      })),
    subcommands: cmd.commands.length > 0
      ? cmd.commands.map(c => commandSchema(c))
      : undefined
  };
}

