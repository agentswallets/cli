import { AppError } from '../core/errors.js';
import { keychainGet } from '../core/keychain.js';
import { wantsJsonOutput } from '../core/output.js';
import { ask, askHidden } from './prompt.js';

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function hasArg(flag: string): boolean {
  return process.argv.includes(flag);
}

export function isNonInteractive(): boolean {
  return hasArg('--non-interactive') || isTruthy(process.env.AW_NON_INTERACTIVE) || isTruthy(process.env.CI);
}

let envPasswordWarned = false;

function readPasswordFromEnv(): string | null {
  const direct = process.env.AW_MASTER_PASSWORD;
  if (direct && direct.trim()) {
    delete process.env.AW_MASTER_PASSWORD;
    if (!envPasswordWarned) {
      envPasswordWarned = true;
      if (!wantsJsonOutput({ json: process.argv.includes('--json'), output: undefined })) {
        process.stderr.write('[warn] Using AW_MASTER_PASSWORD from environment. Prefer AW_MASTER_PASSWORD_ENV for indirection.\n');
      }
    }
    return direct.trim();
  }

  const pointer = process.env.AW_MASTER_PASSWORD_ENV;
  if (pointer && pointer.trim()) {
    const indirect = process.env[pointer.trim()];
    if (indirect && indirect.trim()) return indirect.trim();
  }
  return null;
}

export async function getMasterPassword(promptText: string): Promise<string> {
  // Priority: env → keychain → interactive prompt
  const fromEnv = readPasswordFromEnv();
  if (fromEnv) return fromEnv;
  try {
    const fromKeychain = keychainGet();
    if (fromKeychain) return fromKeychain;
  } catch { /* keychain unavailable, continue */ }
  if (isNonInteractive()) {
    throw new AppError(
      'ERR_INVALID_PARAMS',
      'Master password required in non-interactive mode. Set AW_MASTER_PASSWORD or AW_MASTER_PASSWORD_ENV.'
    );
  }
  return askHidden(promptText);
}

export async function getNewMasterPassword(): Promise<string> {
  const fromEnv = readPasswordFromEnv();
  if (fromEnv) {
    const confirm = process.env.AW_MASTER_PASSWORD_CONFIRM?.trim() ?? fromEnv;
    if (fromEnv.length < 8) throw new AppError('ERR_INVALID_PARAMS', 'Password must be at least 8 chars');
    if (fromEnv !== confirm) throw new AppError('ERR_INVALID_PARAMS', 'Passwords do not match');
    return fromEnv;
  }

  if (isNonInteractive()) {
    throw new AppError(
      'ERR_INVALID_PARAMS',
      'Password setup requires AW_MASTER_PASSWORD in non-interactive mode.'
    );
  }

  const p1 = await askHidden('Set master password (min 8 characters): ');
  const p2 = await askHidden('Confirm password: ');
  if (!p1 || !p1.trim() || p1.trim().length < 8) throw new AppError('ERR_INVALID_PARAMS', 'Password must be at least 8 non-space chars');
  if (p1 !== p2) throw new AppError('ERR_INVALID_PARAMS', 'Passwords do not match');
  return p1;
}

export async function confirmAction(question: string, assumeYes = false): Promise<boolean> {
  if (assumeYes || hasArg('--yes') || isTruthy(process.env.AW_AUTO_APPROVE)) return true;
  if (isNonInteractive()) {
    throw new AppError(
      'ERR_INVALID_PARAMS',
      'Confirmation required in non-interactive mode. Pass --yes or set AW_AUTO_APPROVE=1.'
    );
  }
  const answer = await ask(question);
  return ['yes', 'y'].includes(answer.trim().toLowerCase());
}
