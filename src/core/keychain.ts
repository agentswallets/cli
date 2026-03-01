import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';

const SERVICE = 'agentswallets';
const ACCOUNT = 'master-password';

type KeychainBackend = {
  available(): boolean;
  get(): string | null;
  set(secret: string): void;
  remove(): void;
};

function macosBackend(): KeychainBackend {
  return {
    available() {
      try {
        execFileSync('security', ['help'], { stdio: 'pipe', timeout: 3000 });
        return true;
      } catch {
        return false;
      }
    },
    get() {
      try {
        const out = execFileSync(
          'security',
          ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'],
          { stdio: 'pipe', timeout: 5000 }
        );
        return out.toString().trim() || null;
      } catch {
        return null;
      }
    },
    /**
     * @security macOS `security` CLI does not support stdin for the -w flag.
     * The password is briefly visible in the process argument list (/proc, ps).
     * This is a known platform limitation with no workaround in Node.js.
     * Exposure window is <100ms. Linux `secret-tool` and Windows use stdin.
     * Risk accepted: local-only CLI, requires physical/root access to exploit.
     */
    set(secret: string) {
      // Delete first to avoid "already exists" errors
      try {
        execFileSync(
          'security',
          ['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT],
          { stdio: 'pipe', timeout: 5000 }
        );
      } catch { /* ok if not found */ }
      execFileSync(
        'security',
        ['add-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w', secret],
        { stdio: 'pipe', timeout: 5000 }
      );
    },
    remove() {
      try {
        execFileSync(
          'security',
          ['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT],
          { stdio: 'pipe', timeout: 5000 }
        );
      } catch { /* ok if not found */ }
    }
  };
}

function linuxBackend(): KeychainBackend {
  return {
    available() {
      try {
        execFileSync('secret-tool', ['--version'], { stdio: 'pipe', timeout: 3000 });
        return true;
      } catch {
        return false;
      }
    },
    get() {
      try {
        const out = execFileSync(
          'secret-tool',
          ['lookup', 'service', SERVICE, 'account', ACCOUNT],
          { stdio: 'pipe', timeout: 5000 }
        );
        return out.toString().trim() || null;
      } catch {
        return null;
      }
    },
    set(secret: string) {
      execFileSync(
        'secret-tool',
        ['store', '--label', `${SERVICE} master password`, 'service', SERVICE, 'account', ACCOUNT],
        { input: secret, stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
      );
    },
    remove() {
      try {
        execFileSync(
          'secret-tool',
          ['clear', 'service', SERVICE, 'account', ACCOUNT],
          { stdio: 'pipe', timeout: 5000 }
        );
      } catch { /* ok if not found */ }
    }
  };
}

function windowsBackend(): KeychainBackend {
  return {
    available() {
      try {
        execFileSync('powershell', ['-NoProfile', '-Command', 'echo ok'], { stdio: 'pipe', timeout: 3000 });
        return true;
      } catch {
        return false;
      }
    },
    get() {
      try {
        // Read DPAPI-protected credential file
        const script = `
$path = Join-Path $env:APPDATA 'agentswallets' 'credential.dat'
if (Test-Path $path) {
  $encrypted = Get-Content -Path $path -ErrorAction SilentlyContinue
  if ($encrypted) {
    $secStr = $encrypted | ConvertTo-SecureString -ErrorAction Stop
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secStr)
    try { [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }
}`;
        const out = execFileSync('powershell', ['-NoProfile', '-Command', script], {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000
        });
        return out.toString().trim() || null;
      } catch {
        return null;
      }
    },
    /**
     * @security Windows `cmdkey` CLI does not support stdin for the credential password.
     * The password is briefly visible in the process argument list.
     * This is a known platform limitation, similar to macOS `security` CLI.
     * Exposure window is <100ms. Risk accepted: local-only CLI.
     */
    set(secret: string) {
      // Pass secret via stdin to PowerShell, which writes the credential using DPAPI
      const script = `
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$pass = [Console]::In.ReadLine()
$secStr = ConvertTo-SecureString $pass -AsPlainText -Force
$encrypted = ConvertFrom-SecureString $secStr
$dir = Join-Path $env:APPDATA 'agentswallets'
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
Set-Content -Path (Join-Path $dir 'credential.dat') -Value $encrypted -Force`;
      execFileSync('powershell', ['-NoProfile', '-Command', script], {
        input: secret,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000
      });
    },
    remove() {
      try {
        const script = `
$path = Join-Path $env:APPDATA 'agentswallets' 'credential.dat'
if (Test-Path $path) { Remove-Item -Path $path -Force }`;
        execFileSync('powershell', ['-NoProfile', '-Command', script], {
          stdio: 'pipe',
          timeout: 5000
        });
      } catch { /* ok if not found */ }
    }
  };
}

function getBackend(): KeychainBackend | null {
  const os = platform();
  if (os === 'darwin') return macosBackend();
  if (os === 'linux') return linuxBackend();
  if (os === 'win32') return windowsBackend();
  return null;
}

export function keychainAvailable(): boolean {
  const backend = getBackend();
  if (!backend) return false;
  return backend.available();
}

export function keychainGet(): string | null {
  const backend = getBackend();
  if (!backend) return null;
  return backend.get();
}

export function keychainSet(secret: string): void {
  const backend = getBackend();
  if (!backend) throw new Error('No keychain backend available for this platform');
  backend.set(secret);
}

export function keychainRemove(): void {
  const backend = getBackend();
  if (!backend) throw new Error('No keychain backend available for this platform');
  backend.remove();
}
