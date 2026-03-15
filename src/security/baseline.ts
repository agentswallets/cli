import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getSetting, setSetting } from '../core/settings.js';
import { AppError } from '../core/errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const BASELINE_FILES: Array<{ key: string; path: string }> = [
  { key: 'security.baseline.package_json', path: join(REPO_ROOT, 'package.json') },
];

function hashFile(filePath: string): string | null {
  try {
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

export function initBaseline(): void {
  for (const { key, path } of BASELINE_FILES) {
    const hash = hashFile(path);
    if (hash !== null) {
      setSetting(key, hash);
    }
  }
}

export function verifyBaseline(): { valid: boolean; mismatches: string[] } {
  const mismatches: string[] = [];

  for (const { key, path } of BASELINE_FILES) {
    const stored = getSetting(key);
    if (stored === null) {
      // No baseline stored yet — skip this entry
      continue;
    }

    const current = hashFile(path);
    if (current === null) {
      mismatches.push(`${path}: unable to read file`);
      continue;
    }

    if (current !== stored) {
      mismatches.push(`${path}: hash mismatch (stored=${stored.slice(0, 12)}… current=${current.slice(0, 12)}…)`);
    }
  }

  return { valid: mismatches.length === 0, mismatches };
}

export function assertBaseline(): void {
  const result = verifyBaseline();
  if (!result.valid) {
    throw new AppError(
      'ERR_BASELINE_TAMPERED',
      'Config baseline verification failed',
      { mismatches: result.mismatches }
    );
  }
}
