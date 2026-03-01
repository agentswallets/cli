import crypto from 'node:crypto';
import { AppError, recoveryHintForCode } from './errors.js';
import { exitCodeForError } from './errors.js';
import { mapRpcError, setRpcTimeout } from './rpc.js';
import { redactSecrets } from '../util/redact.js';
import { touchSession } from './session.js';
import type { AppErrorCode } from './types.js';

type JsonMeta = {
  request_id: string;
  [key: string]: unknown;
};

function buildMeta(requestId?: string, extraMeta?: Record<string, unknown>): JsonMeta {
  return {
    request_id: requestId || process.env.AW_REQUEST_ID || `req_${crypto.randomUUID().replace(/-/g, '')}`,
    ...(extraMeta || {})
  };
}

type PublicErrorCode =
  | 'INSUFFICIENT_BALANCE'
  | 'WALLET_NOT_FOUND'
  | 'MARKET_NOT_FOUND'
  | 'INVALID_AMOUNT'
  | 'DAILY_LIMIT_EXCEEDED'
  | 'PER_TX_LIMIT_EXCEEDED'
  | 'TX_COUNT_LIMIT_EXCEEDED'
  | 'INVALID_PARAMS'
  | 'NOT_INITIALIZED'
  | 'UNAUTHORIZED'
  | 'AUTH_FAILED'
  | 'NETWORK_ERROR'
  | 'INTERNAL_ERROR';

function toPublicErrorCode(code: string): PublicErrorCode {
  const map: Record<string, PublicErrorCode> = {
    ERR_INSUFFICIENT_FUNDS: 'INSUFFICIENT_BALANCE',
    ERR_INVALID_PARAMS: 'INVALID_PARAMS',
    ERR_WALLET_NOT_FOUND: 'WALLET_NOT_FOUND',
    ERR_MARKET_NOT_FOUND: 'MARKET_NOT_FOUND',
    ERR_INVALID_AMOUNT: 'INVALID_AMOUNT',
    ERR_NEED_UNLOCK: 'UNAUTHORIZED',
    ERR_RPC_UNAVAILABLE: 'NETWORK_ERROR',
    ERR_POLYMARKET_CLI_NOT_FOUND: 'NETWORK_ERROR',
    ERR_POLYMARKET_FAILED: 'NETWORK_ERROR',
    ERR_POLYMARKET_TIMEOUT: 'NETWORK_ERROR',
    ERR_POLYMARKET_AUTH: 'UNAUTHORIZED',
    ERR_AUTH_FAILED: 'AUTH_FAILED',
    ERR_INTERNAL: 'INTERNAL_ERROR',
    ERR_TX_FAILED: 'INTERNAL_ERROR',
    ERR_NOT_INITIALIZED: 'NOT_INITIALIZED',
    ERR_TX_COUNT_LIMIT_EXCEEDED: 'TX_COUNT_LIMIT_EXCEEDED',
    ERR_PER_TX_LIMIT_EXCEEDED: 'PER_TX_LIMIT_EXCEEDED',
    ERR_APPROVAL_THRESHOLD_EXCEEDED: 'PER_TX_LIMIT_EXCEEDED',
    ERR_DAILY_LIMIT_EXCEEDED: 'DAILY_LIMIT_EXCEEDED',
    ERR_TOKEN_NOT_ALLOWED: 'INVALID_PARAMS',
    ERR_ADDRESS_NOT_ALLOWED: 'INVALID_PARAMS'
  };
  return map[code] || 'INTERNAL_ERROR';
}

export function jsonOk<T>(
  data: T,
  requestId?: string,
  extraMeta?: Record<string, unknown>
): { ok: true; data: T; error: null; meta: JsonMeta } {
  return { ok: true, data, error: null, meta: buildMeta(requestId, extraMeta) };
}

function redactDetails(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = redactSecrets(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map(item =>
        typeof item === 'string' ? redactSecrets(item)
        : item !== null && typeof item === 'object' ? redactDetails(item as Record<string, unknown>)
        : item
      );
    } else if (value !== null && typeof value === 'object') {
      result[key] = redactDetails(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function jsonError(
  code: AppErrorCode,
  message: string,
  details?: Record<string, unknown>,
  requestId?: string,
  extraMeta?: Record<string, unknown>
): {
  ok: false;
  data: null;
  error: { code: PublicErrorCode; message: string; details: Record<string, unknown>; recovery_hint?: string };
  meta: JsonMeta;
} {
  return {
    ok: false,
    data: null,
    error: {
      code: toPublicErrorCode(code),
      message: redactSecrets(message),
      details: details ? redactDetails(details) : {},
      recovery_hint: recoveryHintForCode(code)
    },
    meta: buildMeta(requestId, extraMeta)
  };
}

/** Format data as human-readable key-value pairs instead of raw JSON. */
function formatHuman(data: unknown, prefix = ''): string {
  if (data === null || data === undefined) return '';
  if (typeof data !== 'object') return String(data);
  if (Array.isArray(data)) {
    if (data.length === 0) return '(none)';
    // Array of objects → table-like output
    if (typeof data[0] === 'object' && data[0] !== null) {
      return data.map((item, i) => formatHuman(item, `[${i}] `)).join('\n---\n');
    }
    return data.join(', ');
  }
  const entries = Object.entries(data as Record<string, unknown>);
  const lines: string[] = [];
  for (const [key, value] of entries) {
    const label = prefix + key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // Nested object: flatten with dot notation
      for (const [subKey, subVal] of Object.entries(value as Record<string, unknown>)) {
        if (subVal !== null && typeof subVal === 'object' && !Array.isArray(subVal)) {
          for (const [subSubKey, subSubVal] of Object.entries(subVal as Record<string, unknown>)) {
            lines.push(`  ${label}.${subKey}.${subSubKey}: ${subSubVal}`);
          }
        } else if (Array.isArray(subVal)) {
          lines.push(`  ${label}.${subKey}: ${subVal.length === 0 ? '(none)' : subVal.join(', ')}`);
        } else {
          lines.push(`  ${label}.${subKey}: ${subVal}`);
        }
      }
    } else if (Array.isArray(value)) {
      lines.push(`  ${label}: ${value.length === 0 ? '(none)' : value.join(', ')}`);
    } else {
      lines.push(`  ${label}: ${value}`);
    }
  }
  return lines.join('\n');
}

export function wantsJsonOutput(opts: { json?: boolean; output?: string }): boolean {
  const envJson = (process.env.AW_JSON || '').trim().toLowerCase();
  const outputArg = (opts.output || '').trim().toLowerCase();

  // Validate --output value when explicitly provided
  if (outputArg && outputArg !== 'human' && outputArg !== 'json') {
    throw new AppError('ERR_INVALID_PARAMS', '--output must be human|json');
  }

  // U-1: Check --output from process.argv (handles cases where Commander doesn't pass opts.output)
  const outputIdx = process.argv.indexOf('--output');
  const argvOutputVal = outputIdx >= 0 ? process.argv[outputIdx + 1] : undefined;

  // U-2: Explicit --output human wins over everything (from opts or argv)
  if (outputArg === 'human' || argvOutputVal === 'human') return false;

  const argvOutputJson = argvOutputVal === 'json';

  const nonTty = !process.stdout.isTTY;
  return Boolean(opts.json || outputArg === 'json' || argvOutputJson || nonTty || ['1', 'true', 'yes', 'on'].includes(envJson));
}

export async function runCommand<T>(
  opts: { json?: boolean; output?: string; requestId?: string; meta?: Record<string, unknown>; timeout?: string; skipRedact?: boolean },
  fn: () => Promise<T> | T
): Promise<void> {
  if (opts.timeout) {
    const ms = Number(opts.timeout);
    if (ms > 0) setRpcTimeout(ms);
  }
  const requestId = opts.requestId || process.env.AW_REQUEST_ID;
  const jsonMode = wantsJsonOutput(opts);
  try {
    const data = await fn();
    touchSession();
    if (jsonMode) {
      const raw = JSON.stringify(jsonOk(data, requestId, opts.meta));
      process.stdout.write((opts.skipRedact ? raw : redactSecrets(raw)) + '\n');
      return;
    }
    if (typeof data === 'string') {
      console.log(opts.skipRedact ? data : redactSecrets(data));
      return;
    }
    console.log(opts.skipRedact ? formatHuman(data) : redactSecrets(formatHuman(data)));
  } catch (error) {
    let appError: AppError;
    if (error instanceof AppError) {
      appError = error;
    } else {
      try {
        mapRpcError(error);
        appError = new AppError('ERR_INTERNAL', 'Internal error', { cause: String(error) });
      } catch (mapped) {
        appError =
          mapped instanceof AppError
            ? mapped
            : new AppError('ERR_INTERNAL', 'Internal error', { cause: String(error) });
      }
    }
    if (jsonMode) {
      process.stdout.write(JSON.stringify(jsonError(appError.code, appError.message, appError.details, requestId, opts.meta)) + '\n');
    } else {
      console.error(`[${appError.code}] ${redactSecrets(appError.message)}`);
      if (appError.details && Object.keys(appError.details).length > 0) {
        console.error(JSON.stringify(redactDetails(appError.details), null, 2));
      }
    }
    process.exitCode = exitCodeForError(appError.code);
  }
}
