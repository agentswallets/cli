import { HDNodeWallet, Wallet } from 'ethers';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { Keypair } from '@solana/web3.js';
import { type ChainKey, CHAINS, getAllChainKeys, getChain, getDefaultChainKey, getSupportedChainsSummary, isSolanaChain, resolveChainKey } from '../core/chains.js';
import { getHomeDir } from '../core/config.js';
import { assertInitialized } from '../core/db.js';
import { decryptSecretAsBuffer, encryptSecret, verifyMasterPassword } from '../core/crypto.js';
import { AppError } from '../core/errors.js';
import { getSetting } from '../core/settings.js';
import { isSessionValid } from '../core/session.js';
import { fetchNativeTokenPrice } from '../core/price.js';
import { walletBalance } from '../core/tx-service.js';
import { getWalletById, insertWallet, listWallets, listWalletsInternal } from '../core/wallet-store.js';
import { confirmAction, getMasterPassword } from '../util/agent-input.js';
import { logAudit } from '../core/audit-service.js';

const WALLET_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export async function walletCreateCommand(name: string): Promise<{
  name: string;
  key_type: 'hd';
  evm_address: string;
  solana_address: string;
  default_chain: string;
  supported_chains: Array<{ name: string; native_token: string; tokens: string[] }>;
  hint: string;
}> {
  assertInitialized();
  if (!name) throw new AppError('ERR_INVALID_PARAMS', '--name is required');
  if (!WALLET_NAME_RE.test(name)) {
    throw new AppError('ERR_INVALID_PARAMS', 'Wallet name must be 1-64 chars of [a-zA-Z0-9_-]');
  }

  const chain = getChain(getDefaultChainKey());

  // Always verify password — even when session is valid, a wrong password
  // would encrypt the new wallet's key with an unrecoverable password.
  const password = await getMasterPassword('Master password: ');

  const salt = getSetting('master_password_salt');
  const expected = getSetting('master_password_verifier');
  const kdfRaw = getSetting('master_password_kdf_params');
  if (!salt || !expected) throw new AppError('ERR_NOT_INITIALIZED', 'Not initialized');
  if (!verifyMasterPassword(password, salt, expected, kdfRaw)) {
    throw new AppError('ERR_AUTH_FAILED', 'Invalid master password');
  }

  // Generate 24-word BIP-39 mnemonic
  const mnemonic = bip39.generateMnemonic(256);
  const seed = bip39.mnemonicToSeedSync(mnemonic);

  let solDerivedKey: Buffer | null = null;
  let solSecretKey: Uint8Array | null = null;
  try {
    // EVM derivation: m/44'/60'/0'/0/0
    const hdNode = HDNodeWallet.fromSeed(seed);
    const evmWallet = hdNode.derivePath("m/44'/60'/0'/0/0");

    // Solana derivation: m/44'/501'/0'/0' (Ed25519)
    const solDerived = derivePath("m/44'/501'/0'/0'", seed.toString('hex'));
    solDerivedKey = solDerived.key;
    const solanaKeypair = Keypair.fromSeed(solDerivedKey);
    solSecretKey = solanaKeypair.secretKey;
    const solanaAddress = solanaKeypair.publicKey.toBase58();

    // Encrypt secrets
    const encryptedMnemonic = encryptSecret(mnemonic, password);
    const encryptedEvmKey = encryptSecret(evmWallet.privateKey, password);
    const encryptedSolanaKey = encryptSecret(Buffer.from(solSecretKey).toString('hex'), password);

    const row = insertWallet(name, evmWallet.address, encryptedEvmKey, {
      key_type: 'hd',
      encrypted_mnemonic: encryptedMnemonic,
      encrypted_solana_key: encryptedSolanaKey,
      solana_address: solanaAddress,
    });

    logAudit({ wallet_id: row.id, action: 'wallet.create', request: { name, key_type: 'hd' }, decision: 'ok', chain_name: chain.name, chain_id: chain.chainId });
    return {
      name: row.name,
      key_type: 'hd',
      evm_address: row.address,
      solana_address: solanaAddress,
      default_chain: chain.name,
      supported_chains: getSupportedChainsSummary(),
      hint: 'EVM chains share one address. Solana has a separate address. Use --chain to switch.',
    };
  } finally {
    // Zero-fill sensitive key material
    seed.fill(0);
    solDerivedKey?.fill(0);
    solSecretKey?.fill(0);
  }
}

export function walletListCommand(): { wallets: Array<{ name: string; address: string; key_type: string; solana_address: string | null; created_at: string }>; home_dir: string; hint?: string } {
  assertInitialized();
  const wallets = listWallets();
  return wallets.length === 0
    ? { wallets, home_dir: getHomeDir(), hint: 'No wallets found. Create one with: aw wallet create --name <name>' }
    : { wallets, home_dir: getHomeDir() };
}

export function walletAddressCommand(walletId: string, chainOpt?: string): { name: string; address: string; chain?: string } {
  assertInitialized();
  const wallet = getWalletById(walletId);
  if (chainOpt) {
    const chainKey = resolveChainKey(chainOpt);
    if (isSolanaChain(chainKey)) {
      if (!wallet.solana_address) {
        throw new AppError('ERR_INVALID_PARAMS', 'This wallet does not support Solana. Create a new wallet to use Solana.');
      }
      return { name: wallet.name, address: wallet.solana_address, chain: 'Solana' };
    }
  }
  return { name: wallet.name, address: wallet.address };
}

export function walletInfoCommand(
  walletId: string
): {
  name: string; address: string; key_type: string; solana_address: string | null; created_at: string;
  default_chain: string; supported_chains: Array<{ name: string; native_token: string; tokens: string[] }>;
} {
  assertInitialized();
  const wallet = getWalletById(walletId);
  return {
    name: wallet.name,
    address: wallet.address,
    key_type: wallet.key_type ?? 'legacy',
    solana_address: wallet.solana_address ?? null,
    created_at: wallet.created_at,
    default_chain: getChain(getDefaultChainKey()).name,
    supported_chains: getSupportedChainsSummary(),
  };
}

/** Determine display decimals: native tokens get 4, stablecoins get 2, SOL gets 6. */
function displayDecimals(symbol: string, _tokenDecimals: number): number {
  // Stablecoins (USDC, USDT, USDC.e, etc.) → 2 decimal places
  if (/^USD/i.test(symbol)) return 2;
  // SOL → 6 decimal places (smaller unit value than EVM native)
  if (symbol === 'SOL') return 6;
  // Other native tokens → 4 decimal places
  return 4;
}

type ChainBalanceResult = {
  chain: string;
  address: string;
  balances: Record<string, string>;
  balances_number: Record<string, number>;
  native_usd_price?: number;
  native_usd_value?: number;
};

/** Format raw balance + price into the standard display shape. */
function formatChainBalance(
  rawBalances: Record<string, string>,
  address: string,
  chain: import('../core/chains.js').ChainConfig,
  nativePrice: number | null,
): ChainBalanceResult {
  const balances: Record<string, string> = {};
  const balancesNumber: Record<string, number> = {};
  const nativeToken = chain.tokens.find(t => t.address === null)!;

  for (const token of chain.tokens) {
    const raw = parseFloat(rawBalances[token.symbol]);
    const decimals = displayDecimals(token.symbol, token.decimals);
    balancesNumber[token.symbol] = raw;

    if (token.address === null && nativePrice !== null) {
      balances[token.symbol] = `${raw.toFixed(decimals)} ($${(raw * nativePrice).toFixed(2)})`;
    } else {
      balances[token.symbol] = raw.toFixed(decimals);
    }
  }

  const nativeAmount = balancesNumber[nativeToken.symbol];

  return {
    chain: chain.name,
    address,
    balances,
    balances_number: balancesNumber,
    ...(nativePrice !== null ? { native_usd_price: nativePrice, native_usd_value: parseFloat((nativeAmount * nativePrice).toFixed(2)) } : {}),
  };
}

export async function walletBalanceCommand(walletId: string, chainOpt?: string): Promise<{
  name: string;
  address: string;
  chain: string;
  balances: Record<string, string>;
  balances_number: Record<string, number>;
  native_usd_price?: number;
  native_usd_value?: number;
}> {
  assertInitialized();
  const chainKey = resolveChainKey(chainOpt);
  const chain = getChain(chainKey);

  const [result, nativePrice] = await Promise.all([
    walletBalance(walletId, chainKey),
    fetchNativeTokenPrice(chain.coinpaprikaNativeId),
  ]);

  const formatted = formatChainBalance(result.balances, result.address, chain, nativePrice);
  return { name: result.name, ...formatted };
}

export async function walletBalanceAllCommand(chainOpt?: string): Promise<{
  wallets: Array<{
    name: string;
    address: string;
    chain: string;
    balances: Record<string, string>;
    balances_number: Record<string, number>;
    native_usd_price?: number;
    native_usd_value?: number;
  }>;
}> {
  assertInitialized();
  const chainKey = resolveChainKey(chainOpt);
  const chain = getChain(chainKey);

  let walletRows = listWalletsInternal();
  if (walletRows.length === 0) {
    return { wallets: [] };
  }

  // Skip legacy wallets that don't support Solana
  if (isSolanaChain(chainKey)) {
    walletRows = walletRows.filter(w => w.solana_address);
    if (walletRows.length === 0) return { wallets: [] };
  }

  const [nativePrice, ...rawBalances] = await Promise.all([
    fetchNativeTokenPrice(chain.coinpaprikaNativeId),
    ...walletRows.map(w => walletBalance(w.id, chainKey)),
  ]);

  const results = rawBalances.map((bal) => {
    const formatted = formatChainBalance(bal.balances, bal.address, chain, nativePrice);
    return { name: bal.name, ...formatted };
  });

  return { wallets: results };
}

/** Single wallet × all chains (default when no --chain specified). */
export async function walletBalanceAllChainsCommand(walletId: string): Promise<{
  name: string;
  chains: ChainBalanceResult[];
}> {
  assertInitialized();
  const wallet = getWalletById(walletId);
  const allKeys = getAllChainKeys();
  const supportedKeys = wallet.solana_address ? allKeys : allKeys.filter(k => !isSolanaChain(k));

  // Deduplicate price fetches — e.g. ETH/Base/Arbitrum share 'eth-ethereum'
  const priceIdSet = new Set(supportedKeys.map(k => getChain(k).coinpaprikaNativeId));
  const priceIds = [...priceIdSet];
  const priceResults = await Promise.all(priceIds.map(id => fetchNativeTokenPrice(id)));
  const priceMap = new Map<string, number | null>();
  priceIds.forEach((id, i) => priceMap.set(id, priceResults[i]));

  // Fetch balances for all chains concurrently; skip chains whose RPC fails
  const balanceResults = await Promise.all(
    supportedKeys.map(k =>
      walletBalance(wallet.id, k).catch(() => null)
    )
  );

  const chains: ChainBalanceResult[] = [];
  for (let i = 0; i < supportedKeys.length; i++) {
    const bal = balanceResults[i];
    if (!bal) continue; // RPC failed — skip this chain
    const chain = getChain(supportedKeys[i]);
    const nativePrice = priceMap.get(chain.coinpaprikaNativeId) ?? null;
    chains.push(formatChainBalance(bal.balances, bal.address, chain, nativePrice));
  }

  return { name: wallet.name, chains };
}

/** All wallets × all chains (--all without --chain). */
export async function walletBalanceAllWalletsAllChainsCommand(): Promise<{
  wallets: Array<{
    name: string;
    chains: ChainBalanceResult[];
  }>;
}> {
  assertInitialized();
  const walletRows = listWalletsInternal();
  if (walletRows.length === 0) return { wallets: [] };

  // Pre-fetch all unique prices once
  const allPriceIds = new Set(Object.values(CHAINS).map(c => c.coinpaprikaNativeId));
  const priceIds = [...allPriceIds];
  const priceResults = await Promise.all(priceIds.map(id => fetchNativeTokenPrice(id)));
  const priceMap = new Map<string, number | null>();
  priceIds.forEach((id, i) => priceMap.set(id, priceResults[i]));

  const allKeys = getAllChainKeys();

  const wallets = await Promise.all(
    walletRows.map(async (w) => {
      const supportedKeys = w.solana_address ? allKeys : allKeys.filter(k => !isSolanaChain(k));
      const balanceResults = await Promise.all(
        supportedKeys.map(k => walletBalance(w.id, k).catch(() => null))
      );

      const chains: ChainBalanceResult[] = [];
      for (let i = 0; i < supportedKeys.length; i++) {
        const bal = balanceResults[i];
        if (!bal) continue;
        const chain = getChain(supportedKeys[i]);
        const nativePrice = priceMap.get(chain.coinpaprikaNativeId) ?? null;
        chains.push(formatChainBalance(bal.balances, bal.address, chain, nativePrice));
      }

      return { name: w.name, chains };
    })
  );

  return { wallets };
}

export async function walletExportKeyCommand(walletId: string, yes = false, dangerExport = false): Promise<{
  name: string;
  address: string;
  key_type: string;
  private_key?: string;
  mnemonic?: string;
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

  const keyType = wallet.key_type ?? 'legacy';

  if (keyType === 'hd' && wallet.encrypted_mnemonic) {
    // HD wallet — export mnemonic (controls all chains)
    let mnemonicBuf: Buffer | null = null;
    try {
      mnemonicBuf = decryptSecretAsBuffer(wallet.encrypted_mnemonic, password);
      const mnemonic = mnemonicBuf.toString('utf8');
      logAudit({ wallet_id: walletId, action: 'wallet.export_key', request: { walletId, key_type: 'hd' }, decision: 'ok' });
      return {
        name: wallet.name,
        address: wallet.address,
        key_type: 'hd',
        mnemonic,
        warning: 'Mnemonic controls ALL chains (EVM + Solana). Do not log or persist this value.'
      };
    } finally {
      mnemonicBuf?.fill(0);
    }
  }

  // Legacy wallet — export private key
  let pkBuf: Buffer | null = null;
  try {
    pkBuf = decryptSecretAsBuffer(wallet.encrypted_private_key, password);
    const privateKey = pkBuf.toString('utf8');
    logAudit({ wallet_id: walletId, action: 'wallet.export_key', request: { walletId }, decision: 'ok' });
    return {
      name: wallet.name,
      address: wallet.address,
      key_type: 'legacy',
      private_key: privateKey,
      warning: 'Private key returned in response. Do not log or persist this value.'
    };
  } finally {
    pkBuf?.fill(0);
  }
}
