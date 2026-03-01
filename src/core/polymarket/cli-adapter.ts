import crypto from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { AppError } from '../errors.js';
import { POLYMARKET_INSTALL_GUIDE } from '../constants.js';
import { safeSummary } from '../../util/redact.js';
import type {
  AdapterResult,
  ApproveCheckInput,
  ApproveSetInput,
  BridgeDepositInput,
  BuyInput,
  CancelOrderInput,
  CtfMergeInput,
  CtfRedeemInput,
  CtfSplitInput,
  OrdersInput,
  PolymarketAdapter,
  PositionsInput,
  SearchMarketsInput,
  SellInput,
  UpdateBalanceInput
} from './adapter.js';

type Runtime = {
  binary: 'polymarket' | 'polymarket-cli';
  modern: boolean;
};

type RunResult = {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
};

type SpawnImpl = typeof spawn;
type SpawnSyncImpl = typeof spawnSync;

const DEFAULT_TIMEOUT_MS = Number(process.env.AW_POLY_TIMEOUT_MS || '30000');

/** Only pass safe, necessary env vars to the polymarket subprocess. */
const ENV_WHITELIST = ['PATH', 'HOME', 'LANG', 'TERM', 'USER', 'SHELL', 'TMPDIR', 'NODE_ENV'] as const;

function safeEnv(extra?: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const key of ENV_WHITELIST) {
    if (process.env[key]) safe[key] = process.env[key]!;
  }
  if (extra) Object.assign(safe, extra);
  return safe;
}

/**
 * S4: Shell wrapper that reads the private key from stdin and sets it as env vars.
 * This avoids putting the key in the spawn env (visible via /proc/[pid]/environ on Linux).
 * The key flows through a pipe and only exists in the short-lived child shell's memory.
 */
const STDIN_KEY_WRAPPER = 'IFS= read -r _AW_K && export PRIVATE_KEY="$_AW_K" POLYMARKET_PRIVATE_KEY="$_AW_K" && unset _AW_K && exec "$@"';

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function classifyCliFailure(stderr: string, stdout: string): AppError {
  const text = `${stderr}\n${stdout}`.toLowerCase();
  const details = { stderr: safeSummary(stderr), stdout: safeSummary(stdout) };
  if (text.includes('market') && text.includes('not found')) {
    return new AppError('ERR_MARKET_NOT_FOUND', 'market not found', details);
  }
  if (text.includes('timed out') || text.includes('timeout')) {
    return new AppError('ERR_POLYMARKET_TIMEOUT', 'polymarket command timed out', details);
  }
  if (text.includes('unauthorized') || text.includes('authentication') || text.includes('forbidden') || text.includes('invalid signature') || text.includes('401') || text.includes('403')) {
    return new AppError('ERR_POLYMARKET_AUTH', 'polymarket authentication failed', details);
  }
  return new AppError('ERR_POLYMARKET_FAILED', 'polymarket command failed', details);
}

export class CliPolymarketAdapter implements PolymarketAdapter {
  private readonly timeoutMs: number;

  private runtimeCache: Runtime | null = null;

  // M-7: Cache per key hash to distinguish different private keys
  private signatureTypeCache: Map<string, 'proxy' | 'eoa'> = new Map();

  private readonly spawnImpl: SpawnImpl;

  private readonly spawnSyncImpl: SpawnSyncImpl;

  constructor(input?: { timeoutMs?: number; spawnImpl?: SpawnImpl; spawnSyncImpl?: SpawnSyncImpl }) {
    this.timeoutMs =
      input?.timeoutMs && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0 ? input.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.spawnImpl = input?.spawnImpl ?? spawn;
    this.spawnSyncImpl = input?.spawnSyncImpl ?? spawnSync;
  }

  async searchMarkets(input: SearchMarketsInput): Promise<AdapterResult> {
    const runtime = this.resolveRuntime();
    const args = runtime.modern
      ? ['markets', 'search', input.query, '--limit', String(input.limit), '--output', 'json']
      : ['search', '--q', input.query, '--limit', String(input.limit), '--json'];
    const run = await this.runPolymarketCommand(args);
    const data = this.parseJson(run.stdout, { action: 'searchMarkets', args });
    return { data, raw: { elapsed_ms: run.elapsedMs } };
  }

  async buy(input: BuyInput): Promise<AdapterResult> {
    const runtime = this.resolveRuntime();
    if (!runtime.modern) {
      throw new AppError('ERR_POLYMARKET_FAILED', 'predict buy requires modern polymarket CLI');
    }
    const signatureType = await this.detectSignatureType(input.privateKey);
    const marketJson = await this.runPolymarketJson(
      ['--signature-type', signatureType, 'markets', 'get', input.market, '--output', 'json'],
      { privateKey: input.privateKey }
    );
    const token = this.resolveTokenIdForOutcome(marketJson, input.outcome, input.market);
    const run = await this.runPolymarketCommand(
      [
        '--signature-type',
        signatureType,
        'clob',
        'create-order',
        '--token',
        token,
        '--side',
        'buy',
        '--price',
        String(input.price),
        '--size',
        String(input.size),
        '--output',
        'json'
      ],
      { privateKey: input.privateKey }
    );
    const data = this.parseJson(run.stdout, { action: 'buy' });
    const obj = asObject(data);
    return {
      provider_order_id: String(obj.id ?? obj.order_id ?? obj.orderId ?? ''),
      provider_status: String(obj.status ?? 'submitted'),
      data,
      raw: { elapsed_ms: run.elapsedMs, credential_source: 'stdin_pipe' }
    };
  }

  async sell(input: SellInput): Promise<AdapterResult> {
    const runtime = this.resolveRuntime();
    if (!runtime.modern) {
      throw new AppError('ERR_POLYMARKET_FAILED', 'predict sell requires modern polymarket CLI');
    }
    const signatureType = await this.detectSignatureType(input.privateKey);
    const base = ['--signature-type', signatureType, 'clob'] as string[];
    const opts = { privateKey: input.privateKey };
    // market-order is the correct subcommand for selling shares at market price
    const candidates = [
      [...base, 'market-order', '--token', input.positionId, '--side', 'sell', '--amount', String(input.size), '--output', 'json'],
      [...base, 'create-order', '--token', input.positionId, '--side', 'sell', '--price', '0.01', '--size', String(input.size), '--output', 'json']
    ];

    let last: unknown;
    for (const args of candidates) {
      try {
        const run = await this.runPolymarketCommand(args, opts);
        const data = this.parseJson(run.stdout, { action: 'sell' });
        const obj = asObject(data);
        return {
          provider_order_id: String(obj.id ?? obj.order_id ?? obj.orderId ?? ''),
          provider_status: String(obj.status ?? 'submitted'),
          data,
          raw: { elapsed_ms: run.elapsedMs, credential_source: 'stdin_pipe' }
        };
      } catch (err) {
        last = err;
      }
    }
    throw (last as Error) ?? new AppError('ERR_POLYMARKET_FAILED', 'predict sell failed');
  }

  async positions(input: PositionsInput): Promise<AdapterResult> {
    const runtime = this.resolveRuntime();
    const args = runtime.modern
      ? ['data', 'positions', input.walletAddress, '--output', 'json']
      : ['positions', '--json'];
    const run = await this.runPolymarketCommand(args);
    const data = this.parseJson(run.stdout, { action: 'positions', args });
    return { data, raw: { elapsed_ms: run.elapsedMs } };
  }

  async orders(input: OrdersInput): Promise<AdapterResult> {
    const runtime = this.resolveRuntime();
    if (!runtime.modern) {
      throw new AppError('ERR_POLYMARKET_FAILED', 'predict orders requires modern polymarket CLI');
    }
    const signatureType = await this.detectSignatureType(input.privateKey);
    const run = await this.runPolymarketCommand(
      ['--signature-type', signatureType, 'clob', 'orders', '--output', 'json'],
      { privateKey: input.privateKey }
    );
    const data = this.parseJson(run.stdout, { action: 'orders' });
    return { data, raw: { elapsed_ms: run.elapsedMs, credential_source: 'stdin_pipe' } };
  }

  async cancelOrder(input: CancelOrderInput): Promise<AdapterResult> {
    const runtime = this.resolveRuntime();
    if (!runtime.modern) {
      throw new AppError('ERR_POLYMARKET_FAILED', 'predict cancel requires modern polymarket CLI');
    }
    const signatureType = await this.detectSignatureType(input.privateKey);
    const run = await this.runPolymarketCommand(
      ['--signature-type', signatureType, 'clob', 'cancel', input.orderId, '--output', 'json'],
      { privateKey: input.privateKey }
    );
    const data = this.parseJson(run.stdout, { action: 'cancelOrder' });
    return { data, raw: { elapsed_ms: run.elapsedMs, credential_source: 'stdin_pipe' } };
  }

  async approveCheck(input: ApproveCheckInput): Promise<AdapterResult> {
    const runtime = this.resolveRuntime();
    if (!runtime.modern) {
      throw new AppError('ERR_POLYMARKET_FAILED', 'predict approve-check requires modern polymarket CLI');
    }
    const signatureType = await this.detectSignatureType(input.privateKey);
    const run = await this.runPolymarketCommand(
      ['--signature-type', signatureType, 'approve', 'check', '--output', 'json'],
      { privateKey: input.privateKey }
    );
    const data = this.parseJson(run.stdout, { action: 'approveCheck' });
    return { data, raw: { elapsed_ms: run.elapsedMs, credential_source: 'stdin_pipe' } };
  }

  async approveSet(input: ApproveSetInput): Promise<AdapterResult> {
    const runtime = this.resolveRuntime();
    if (!runtime.modern) {
      throw new AppError('ERR_POLYMARKET_FAILED', 'predict approve-set requires modern polymarket CLI');
    }
    const signatureType = await this.detectSignatureType(input.privateKey);
    const run = await this.runPolymarketCommand(
      ['--signature-type', signatureType, 'approve', 'set', '--output', 'json'],
      { privateKey: input.privateKey, timeoutMs: 120_000 }
    );
    const data = this.parseJson(run.stdout, { action: 'approveSet' });
    return { data, raw: { elapsed_ms: run.elapsedMs, credential_source: 'stdin_pipe' } };
  }

  async updateBalance(input: UpdateBalanceInput): Promise<AdapterResult> {
    const runtime = this.resolveRuntime();
    if (!runtime.modern) {
      throw new AppError('ERR_POLYMARKET_FAILED', 'predict update-balance requires modern polymarket CLI');
    }
    const signatureType = await this.detectSignatureType(input.privateKey);
    const run = await this.runPolymarketCommand(
      ['--signature-type', signatureType, 'clob', 'update-balance', '--asset-type', 'collateral', '--output', 'json'],
      { privateKey: input.privateKey }
    );
    const data = this.parseJson(run.stdout, { action: 'updateBalance' });
    return { data, raw: { elapsed_ms: run.elapsedMs, credential_source: 'stdin_pipe' } };
  }

  async ctfSplit(input: CtfSplitInput): Promise<AdapterResult> {
    const runtime = this.resolveRuntime();
    if (!runtime.modern) {
      throw new AppError('ERR_POLYMARKET_FAILED', 'ctf split requires modern polymarket CLI');
    }
    const signatureType = await this.detectSignatureType(input.privateKey);
    const run = await this.runPolymarketCommand(
      ['--signature-type', signatureType, 'ctf', 'split', '--condition', input.condition, '--amount', String(input.amount), '--output', 'json'],
      { privateKey: input.privateKey, timeoutMs: 120_000 }
    );
    const data = this.parseJson(run.stdout, { action: 'ctfSplit' });
    return { data, raw: { elapsed_ms: run.elapsedMs, credential_source: 'stdin_pipe' } };
  }

  async ctfMerge(input: CtfMergeInput): Promise<AdapterResult> {
    const runtime = this.resolveRuntime();
    if (!runtime.modern) {
      throw new AppError('ERR_POLYMARKET_FAILED', 'ctf merge requires modern polymarket CLI');
    }
    const signatureType = await this.detectSignatureType(input.privateKey);
    const run = await this.runPolymarketCommand(
      ['--signature-type', signatureType, 'ctf', 'merge', '--condition', input.condition, '--amount', String(input.amount), '--output', 'json'],
      { privateKey: input.privateKey, timeoutMs: 120_000 }
    );
    const data = this.parseJson(run.stdout, { action: 'ctfMerge' });
    return { data, raw: { elapsed_ms: run.elapsedMs, credential_source: 'stdin_pipe' } };
  }

  async ctfRedeem(input: CtfRedeemInput): Promise<AdapterResult> {
    const runtime = this.resolveRuntime();
    if (!runtime.modern) {
      throw new AppError('ERR_POLYMARKET_FAILED', 'ctf redeem requires modern polymarket CLI');
    }
    const signatureType = await this.detectSignatureType(input.privateKey);
    const run = await this.runPolymarketCommand(
      ['--signature-type', signatureType, 'ctf', 'redeem', '--condition', input.condition, '--output', 'json'],
      { privateKey: input.privateKey, timeoutMs: 120_000 }
    );
    const data = this.parseJson(run.stdout, { action: 'ctfRedeem' });
    return { data, raw: { elapsed_ms: run.elapsedMs, credential_source: 'stdin_pipe' } };
  }

  async bridgeDeposit(input: BridgeDepositInput): Promise<AdapterResult> {
    const runtime = this.resolveRuntime();
    if (!runtime.modern) {
      throw new AppError('ERR_POLYMARKET_FAILED', 'bridge deposit requires modern polymarket CLI');
    }
    const run = await this.runPolymarketCommand(
      ['bridge', 'deposit', input.walletAddress, '--output', 'json']
    );
    const data = this.parseJson(run.stdout, { action: 'bridgeDeposit' });
    return { data, raw: { elapsed_ms: run.elapsedMs } };
  }

  private resolveRuntime(): Runtime {
    if (this.runtimeCache) return this.runtimeCache;
    const candidates: Array<'polymarket-cli' | 'polymarket'> = ['polymarket-cli', 'polymarket'];
    for (const binary of candidates) {
      const res = this.spawnSyncImpl(binary, ['--help'], { encoding: 'utf8' });
      if (res.status === 0) {
        const help = `${res.stdout || ''}\n${res.stderr || ''}`;
        const modern = /markets\s+search|clob\s+create-order|Polymarket CLI/i.test(help);
        this.runtimeCache = { binary, modern };
        this.checkCliVersion(binary);
        return this.runtimeCache;
      }
    }
    throw new AppError('ERR_POLYMARKET_CLI_NOT_FOUND', 'polymarket-cli not found in PATH', {
      install: POLYMARKET_INSTALL_GUIDE
    });
  }

  private checkCliVersion(binary: string): void {
    try {
      const res = this.spawnSyncImpl(binary, ['--version'], { encoding: 'utf8' });
      const output = `${res.stdout || ''} ${res.stderr || ''}`.trim();
      const match = output.match(/(\d+\.\d+\.\d+)/);
      if (match) {
        const [major, minor] = match[1].split('.').map(Number);
        if (major === 0 && minor < 1) {
          // Version warning suppressed — best-effort check, no stderr output in JSON mode
        }
      }
    } catch { /* version check is best-effort */ }
  }

  private parseJson(stdout: string, context: Record<string, unknown>): unknown {
    try {
      return JSON.parse(stdout);
    } catch {
      throw new AppError('ERR_POLYMARKET_FAILED', 'Invalid polymarket JSON output', {
        ...context,
        stdout: safeSummary(stdout)
      });
    }
  }

  private async runPolymarketJson(args: string[], opts?: { privateKey?: string }): Promise<Record<string, unknown>> {
    const run = await this.runPolymarketCommand(args, opts);
    return asObject(this.parseJson(run.stdout, { args }));
  }

  private resolveTokenIdForOutcome(
    marketJson: Record<string, unknown>,
    outcome: 'yes' | 'no',
    market: string
  ): string {
    const outcomesRaw = marketJson.outcomes;
    const tokensRaw = marketJson.clobTokenIds;
    const outcomes =
      typeof outcomesRaw === 'string' ? (JSON.parse(outcomesRaw) as string[]) : Array.isArray(outcomesRaw) ? outcomesRaw : [];
    const tokens =
      typeof tokensRaw === 'string' ? (JSON.parse(tokensRaw) as string[]) : Array.isArray(tokensRaw) ? tokensRaw : [];
    const yesIdx = outcomes.findIndex((x) => String(x).toLowerCase() === 'yes');
    const noIdx = outcomes.findIndex((x) => String(x).toLowerCase() === 'no');
    const token = outcome === 'yes' ? tokens[yesIdx] : tokens[noIdx];
    if (!token) {
      throw new AppError('ERR_MARKET_NOT_FOUND', `market not found or invalid outcome mapping: ${market}`);
    }
    return String(token);
  }

  private async detectSignatureType(privateKey: string): Promise<'proxy' | 'eoa'> {
    const keyHash = crypto.createHash('sha256').update(privateKey).digest('hex').slice(0, 16);
    const cached = this.signatureTypeCache.get(keyHash);
    if (cached) return cached;
    const attempts: Array<'proxy' | 'eoa'> = ['eoa', 'proxy'];
    for (const sig of attempts) {
      try {
        await this.runPolymarketCommand(['--signature-type', sig, 'wallet', 'show', '--output', 'json'], { privateKey });
        this.signatureTypeCache.set(keyHash, sig);
        return sig;
      } catch {
        continue;
      }
    }
    throw new AppError('ERR_POLYMARKET_FAILED', 'Unable to authenticate polymarket signature type');
  }

  private runPolymarketCommand(args: string[], opts?: { privateKey?: string; timeoutMs?: number }): Promise<RunResult> {
    const runtime = this.resolveRuntime();
    const started = Date.now();
    const privateKey = opts?.privateKey;
    const effectiveTimeout = opts?.timeoutMs ?? this.timeoutMs;
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        if (privateKey) {
          // S4: Pass key via stdin pipe — NOT in spawn env — to avoid /proc/[pid]/environ exposure.
          // Shell wrapper reads key from stdin, exports as env, then exec's the real binary.
          child = this.spawnImpl('sh', ['-c', STDIN_KEY_WRAPPER, '--', runtime.binary, ...args], {
            env: safeEnv(),
            stdio: ['pipe', 'pipe', 'pipe']
          });
          child.stdin!.write(privateKey + '\n');
          child.stdin!.end();
        } else {
          child = this.spawnImpl(runtime.binary, args, {
            env: safeEnv(),
            stdio: ['pipe', 'pipe', 'pipe']
          });
          child.stdin?.end();
        }
      } catch (error) {
        reject(this.mapSpawnError(error));
        return;
      }

      let stdout = '';
      let stderr = '';
      const MAX_OUTPUT = 5 * 1024 * 1024; // L-7: 5MB cap
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already exited */ }
        }, 2000);
        reject(
          new AppError('ERR_RPC_UNAVAILABLE', `polymarket command timeout after ${effectiveTimeout}ms`, {
            args
          })
        );
      }, effectiveTimeout);

      child.stdout?.on('data', (buf: Buffer | string) => {
        if (stdout.length < MAX_OUTPUT) stdout += buf.toString().slice(0, MAX_OUTPUT - stdout.length);
      });
      child.stderr?.on('data', (buf: Buffer | string) => {
        if (stderr.length < MAX_OUTPUT) stderr += buf.toString().slice(0, MAX_OUTPUT - stderr.length);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(this.mapSpawnError(error));
      });
      child.on('close', (exitCode, signal) => {
        clearTimeout(timer);
        const elapsedMs = Date.now() - started;
        const result: RunResult = {
          exitCode: exitCode ?? -1,
          signal,
          stdout,
          stderr,
          elapsedMs
        };
        if ((exitCode ?? 1) !== 0) {
          reject(classifyCliFailure(stderr, stdout));
          return;
        }
        resolve(result);
      });
    });
  }

  private mapSpawnError(error: unknown): AppError {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') {
      return new AppError('ERR_POLYMARKET_CLI_NOT_FOUND', 'polymarket-cli not found in PATH', {
        install: POLYMARKET_INSTALL_GUIDE
      });
    }
    return new AppError('ERR_POLYMARKET_FAILED', 'Failed to start polymarket command', {
      message: err?.message || String(error)
    });
  }
}

