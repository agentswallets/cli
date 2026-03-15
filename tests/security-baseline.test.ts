import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const PACKAGE_JSON_PATH = join(REPO_ROOT, 'package.json');

function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

const setSettingMock = vi.fn();
const getSettingMock = vi.fn();

vi.mock('../src/core/settings.js', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
  setSetting: (...args: unknown[]) => setSettingMock(...args),
}));

describe('security baseline', () => {
  it('initBaseline stores hash in settings', async () => {
    setSettingMock.mockClear();
    const { initBaseline } = await import('../src/security/baseline.js');
    initBaseline();
    expect(setSettingMock).toHaveBeenCalledOnce();
    const [key, value] = setSettingMock.mock.calls[0];
    expect(key).toBe('security.baseline.package_json');
    expect(typeof value).toBe('string');
    expect(value).toHaveLength(64);
    expect(value).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifyBaseline returns valid when hashes match', async () => {
    getSettingMock.mockClear();
    const actualHash = hashFile(PACKAGE_JSON_PATH);
    getSettingMock.mockReturnValue(actualHash);
    const { verifyBaseline } = await import('../src/security/baseline.js');
    const result = verifyBaseline();
    expect(result.valid).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it('verifyBaseline returns mismatches when hash differs', async () => {
    getSettingMock.mockClear();
    getSettingMock.mockReturnValue('badhash');
    const { verifyBaseline } = await import('../src/security/baseline.js');
    const result = verifyBaseline();
    expect(result.valid).toBe(false);
    expect(result.mismatches.length).toBeGreaterThan(0);
  });

  it('verifyBaseline skips when no baseline stored', async () => {
    getSettingMock.mockClear();
    getSettingMock.mockReturnValue(null);
    const { verifyBaseline } = await import('../src/security/baseline.js');
    const result = verifyBaseline();
    expect(result.valid).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });
});
