import { Wallet } from 'ethers';
import { CHAIN_ID, CHAIN_NAME } from '../core/constants.js';
import { getHomeDir } from '../core/config.js';
import { assertInitialized } from '../core/db.js';
import { decryptSecretAsBuffer, encryptSecret, verifyMasterPassword } from '../core/crypto.js';
import { AppError } from '../core/errors.js';
import { getSetting } from '../core/settings.js';
import { isSessionValid } from '../core/session.js';
import { fetchPolUsdPrice } from '../core/price.js';
import { walletBalance } from '../core/tx-service.js';
import { getWalletById, insertWallet, listWallets, listWalletsInternal } from '../core/wallet-store.js';
import { confirmAction, getMasterPassword } from '../util/agent-input.js';
import { logAudit } from '../core/audit-service.js';

const WALLET_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export async function walletCreateCommand(name: string): Promise<{ name: string; address: string; chain: string; chain_id: number }> {
  assertInitialized();
  if (!name) throw new AppError('ERR_INVALID_PARAMS', '--name is required');
  if (!WALLET_NAME_RE.test(name)) {
    throw new AppError('ERR_INVALID_PARAMS', 'Wallet name must be 1-64 chars of [a-zA-Z0-9_-]');
  }

  // If session is already unlocked, get password silently (keychain/env) — skip verification.
  // Password is still needed to encrypt the new wallet's private key.
  const sessionValid = isSessionValid();
  const password = await getMasterPassword(sessionValid ? 'Master password (for encrypt): ' : 'Master password: ');

  if (!sessionValid) {
    const salt = getSetting('master_password_salt');
    const expected = getSetting('master_password_verifier');
    const kdfRaw = getSetting('master_password_kdf_params');
    if (!salt || !expected) throw new AppError('ERR_NOT_INITIALIZED', 'Not initialized');
    if (!verifyMasterPassword(password, salt, expected, kdfRaw)) {
      throw new AppError('ERR_AUTH_FAILED', 'Invalid master password');
    }
  }

  const wallet = Wallet.createRandom();
  const encrypted = encryptSecret(wallet.privateKey, password);
  const row = insertWallet(name, wallet.address, encrypted);
  logAudit({ wallet_id: row.id, action: 'wallet.create', request: { name }, decision: 'ok' });
  return { name: row.name, address: row.address, chain: CHAIN_NAME, chain_id: CHAIN_ID };
}

export function walletListCommand(): { wallets: Array<{ name: string; address: string; created_at: string }>; home_dir: string; hint?: string } {
  assertInitialized();
  const wallets = listWallets();
  return wallets.length === 0
    ? { wallets, home_dir: getHomeDir(), hint: 'No wallets found. Create one with: aw wallet create --name <name>' }
    : { wallets, home_dir: getHomeDir() };
}

export function walletAddressCommand(walletId: string): { name: string; address: string } {
  assertInitialized();
  const wallet = getWalletById(walletId);
  return { name: wallet.name, address: wallet.address };
}

export function walletInfoCommand(
  walletId: string
): { name: string; address: string; created_at: string } {
  assertInitialized();
  const wallet = getWalletById(walletId);
  return {
    name: wallet.name,
    address: wallet.address,
    created_at: wallet.created_at
  };
}

export async function walletBalanceCommand(walletId: string): Promise<{
  name: string;
  address: string;
  chain: string;
  chain_id: number;
  balances: { POL: string; USDC: string; 'USDC.e': string };
  balances_number: { POL: number; USDC: number; 'USDC.e': number };
  pol_usd_price?: number;
  pol_usd_value?: number;
}> {
  assertInitialized();
  const [result, polPrice] = await Promise.all([walletBalance(walletId), fetchPolUsdPrice()]);
  const polAmount = parseFloat(result.balances.POL);
  const polShort = polAmount.toFixed(4);
  const usdcShort = parseFloat(result.balances.USDC).toFixed(2);
  const usdceShort = parseFloat(result.balances['USDC.e']).toFixed(2);

  let polDisplay = polShort;
  if (polPrice !== null) {
    polDisplay = `${polShort} ($${(polAmount * polPrice).toFixed(2)})`;
  }

  return {
    name: result.name,
    address: result.address,
    chain: CHAIN_NAME,
    chain_id: result.chain_id,
    balances: { POL: polDisplay, USDC: usdcShort, 'USDC.e': usdceShort },
    balances_number: {
      POL: polAmount,
      USDC: parseFloat(result.balances.USDC),
      'USDC.e': parseFloat(result.balances['USDC.e'])
    },
    ...(polPrice !== null ? { pol_usd_price: polPrice, pol_usd_value: parseFloat((polAmount * polPrice).toFixed(2)) } : {})
  };
}

export async function walletBalanceAllCommand(): Promise<{
  wallets: Array<{
    name: string;
    address: string;
    chain: string;
    chain_id: number;
    balances: { POL: string; USDC: string; 'USDC.e': string };
    balances_number: { POL: number; USDC: number; 'USDC.e': number };
    pol_usd_price?: number;
    pol_usd_value?: number;
  }>;
}> {
  assertInitialized();
  const walletRows = listWalletsInternal();
  if (walletRows.length === 0) {
    return { wallets: [] };
  }
  const [polPrice, ...balances] = await Promise.all([
    fetchPolUsdPrice(),
    ...walletRows.map(w => walletBalance(w.id))
  ]);
  const results = balances.map((bal) => {
    const polAmount = parseFloat(bal.balances.POL);
    const polShort = polAmount.toFixed(4);
    const usdcShort = parseFloat(bal.balances.USDC).toFixed(2);
    const usdceShort = parseFloat(bal.balances['USDC.e']).toFixed(2);
    let polDisplay = polShort;
    if (polPrice !== null) {
      polDisplay = `${polShort} ($${(polAmount * (polPrice as number)).toFixed(2)})`;
    }
    return {
      name: bal.name,
      address: bal.address,
      chain: CHAIN_NAME,
      chain_id: bal.chain_id,
      balances: { POL: polDisplay, USDC: usdcShort, 'USDC.e': usdceShort },
      balances_number: {
        POL: polAmount,
        USDC: parseFloat(bal.balances.USDC),
        'USDC.e': parseFloat(bal.balances['USDC.e'])
      },
      ...(polPrice !== null ? { pol_usd_price: polPrice as number, pol_usd_value: parseFloat((polAmount * (polPrice as number)).toFixed(2)) } : {})
    };
  });
  return { wallets: results };
}

export async function walletExportKeyCommand(walletId: string, yes = false, dangerExport = false): Promise<{
  name: string;
  address: string;
  private_key: string;
  warning: string;
}> {
  assertInitialized();
  // Gate 1: env var — production deployments never set this
  const allowExport = (process.env.AW_ALLOW_EXPORT || '').trim();
  if (allowExport !== '1') {
    throw new AppError('ERR_INVALID_PARAMS', 'export-key requires AW_ALLOW_EXPORT=1 environment variable');
  }
  // Gate 2: CLI flag — explicit per-invocation intent
  if (!dangerExport) {
    throw new AppError('ERR_INVALID_PARAMS', 'export-key requires --danger-export flag to confirm.');
  }
  const allowed = await confirmAction(
    `Export private key for wallet ${walletId}. This is sensitive. Continue? (y/n): `,
    yes
  );
  if (!allowed) throw new AppError('ERR_INVALID_PARAMS', 'Export cancelled by user');

  const wallet = getWalletById(walletId);
  const password = await getMasterPassword('Master password for export: ');

  // P0-2: Verify password before attempting decrypt — gives clean error + enables audit
  const salt = getSetting('master_password_salt');
  const expected = getSetting('master_password_verifier');
  const kdfRaw = getSetting('master_password_kdf_params');
  if (!salt || !expected) throw new AppError('ERR_NOT_INITIALIZED', 'Not initialized');
  if (!verifyMasterPassword(password, salt, expected, kdfRaw)) {
    logAudit({ wallet_id: walletId, action: 'wallet.export_key', request: { walletId }, decision: 'denied', error_code: 'ERR_AUTH_FAILED' });
    throw new AppError('ERR_AUTH_FAILED', 'Invalid master password');
  }

  let pkBuf: Buffer | null = null;
  try {
    pkBuf = decryptSecretAsBuffer(wallet.encrypted_private_key, password);
    const privateKey = pkBuf.toString('utf8');
    logAudit({ wallet_id: walletId, action: 'wallet.export_key', request: { walletId }, decision: 'ok' });
    return {
      name: wallet.name,
      address: wallet.address,
      private_key: privateKey,
      warning: 'Private key returned in response. Do not log or persist this value.'
    };
  } finally {
    pkBuf?.fill(0);
  }
}
