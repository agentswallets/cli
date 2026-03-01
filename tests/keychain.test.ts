import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock child_process at module level
const mockExecFileSync = vi.fn();
vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args)
}));

// Mock os.platform
let mockPlatform = 'darwin';
vi.mock('node:os', () => ({
  platform: () => mockPlatform
}));

describe('keychain', () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
    vi.resetModules();
  });

  describe('macOS', () => {
    it('keychainAvailable returns true when security command works', async () => {
      mockPlatform = 'darwin';
      mockExecFileSync.mockReturnValue(Buffer.from(''));
      const { keychainAvailable } = await import('../src/core/keychain.js');
      expect(keychainAvailable()).toBe(true);
      expect(mockExecFileSync).toHaveBeenCalledWith('security', ['help'], expect.any(Object));
    });

    it('keychainAvailable returns false when security command fails', async () => {
      mockPlatform = 'darwin';
      mockExecFileSync.mockImplementation(() => { throw new Error('not found'); });
      const { keychainAvailable } = await import('../src/core/keychain.js');
      expect(keychainAvailable()).toBe(false);
    });

    it('keychainGet returns password from keychain', async () => {
      mockPlatform = 'darwin';
      mockExecFileSync.mockReturnValue(Buffer.from('my-secret-password\n'));
      const { keychainGet } = await import('../src/core/keychain.js');
      expect(keychainGet()).toBe('my-secret-password');
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'security',
        ['find-generic-password', '-s', 'agentswallets', '-a', 'master-password', '-w'],
        expect.any(Object)
      );
    });

    it('keychainGet returns null when not found', async () => {
      mockPlatform = 'darwin';
      mockExecFileSync.mockImplementation(() => { throw new Error('not found'); });
      const { keychainGet } = await import('../src/core/keychain.js');
      expect(keychainGet()).toBeNull();
    });

    it('keychainSet calls add-generic-password', async () => {
      mockPlatform = 'darwin';
      mockExecFileSync.mockReturnValue(Buffer.from(''));
      const { keychainSet } = await import('../src/core/keychain.js');
      keychainSet('test-pw');
      // Should call delete first, then add
      const calls = mockExecFileSync.mock.calls;
      const addCall = calls.find((c: unknown[]) => (c[1] as string[]).includes('add-generic-password'));
      expect(addCall).toBeTruthy();
      expect(addCall![1]).toContain('-w');
      expect(addCall![1]).toContain('test-pw');
    });

    it('keychainRemove calls delete-generic-password', async () => {
      mockPlatform = 'darwin';
      mockExecFileSync.mockReturnValue(Buffer.from(''));
      const { keychainRemove } = await import('../src/core/keychain.js');
      keychainRemove();
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'security',
        ['delete-generic-password', '-s', 'agentswallets', '-a', 'master-password'],
        expect.any(Object)
      );
    });
  });

  describe('linux', () => {
    it('keychainAvailable returns true when secret-tool exists', async () => {
      mockPlatform = 'linux';
      mockExecFileSync.mockReturnValue(Buffer.from(''));
      const { keychainAvailable } = await import('../src/core/keychain.js');
      expect(keychainAvailable()).toBe(true);
      expect(mockExecFileSync).toHaveBeenCalledWith('secret-tool', ['--version'], expect.any(Object));
    });

    it('keychainGet calls secret-tool lookup', async () => {
      mockPlatform = 'linux';
      mockExecFileSync.mockReturnValue(Buffer.from('linux-pw\n'));
      const { keychainGet } = await import('../src/core/keychain.js');
      expect(keychainGet()).toBe('linux-pw');
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'secret-tool',
        ['lookup', 'service', 'agentswallets', 'account', 'master-password'],
        expect.any(Object)
      );
    });
  });

  describe('unsupported platform', () => {
    it('keychainAvailable returns false on unsupported OS', async () => {
      mockPlatform = 'freebsd';
      const { keychainAvailable } = await import('../src/core/keychain.js');
      expect(keychainAvailable()).toBe(false);
    });

    it('keychainGet returns null on unsupported OS', async () => {
      mockPlatform = 'freebsd';
      const { keychainGet } = await import('../src/core/keychain.js');
      expect(keychainGet()).toBeNull();
    });
  });
});
