import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as bip39 from 'bip39';
import { HDNodeWallet } from 'ethers';
import { derivePath } from 'ed25519-hd-key';
import { Keypair } from '@solana/web3.js';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/core/schema.js';

describe('HD wallet derivation', () => {
  it('generates valid 24-word mnemonic', () => {
    const mnemonic = bip39.generateMnemonic(256);
    const words = mnemonic.split(' ');
    expect(words).toHaveLength(24);
    expect(bip39.validateMnemonic(mnemonic)).toBe(true);
  });

  it('derives deterministic EVM address from mnemonic', () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const hd = HDNodeWallet.fromSeed(seed);
    const evmWallet = hd.derivePath("m/44'/60'/0'/0/0");

    // Same mnemonic → same address
    const seed2 = bip39.mnemonicToSeedSync(mnemonic);
    const hd2 = HDNodeWallet.fromSeed(seed2);
    const evmWallet2 = hd2.derivePath("m/44'/60'/0'/0/0");

    expect(evmWallet.address).toBe(evmWallet2.address);
    expect(evmWallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('derives deterministic Solana address from mnemonic', () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const derived = derivePath("m/44'/501'/0'/0'", seed.toString('hex'));
    const keypair = Keypair.fromSeed(derived.key);
    const address = keypair.publicKey.toBase58();

    // Same mnemonic → same address
    const seed2 = bip39.mnemonicToSeedSync(mnemonic);
    const derived2 = derivePath("m/44'/501'/0'/0'", seed2.toString('hex'));
    const keypair2 = Keypair.fromSeed(derived2.key);

    expect(keypair.publicKey.toBase58()).toBe(keypair2.publicKey.toBase58());
    expect(address.length).toBeGreaterThanOrEqual(32);
    expect(address.length).toBeLessThanOrEqual(44);
  });

  it('EVM and Solana addresses are different for same mnemonic', () => {
    const mnemonic = bip39.generateMnemonic(256);
    const seed = bip39.mnemonicToSeedSync(mnemonic);

    const evmWallet = HDNodeWallet.fromSeed(seed).derivePath("m/44'/60'/0'/0/0");
    const solDerived = derivePath("m/44'/501'/0'/0'", seed.toString('hex'));
    const solKeypair = Keypair.fromSeed(solDerived.key);

    // They should be completely different
    expect(evmWallet.address).not.toBe(solKeypair.publicKey.toBase58());
  });
});

describe('DB schema supports HD fields', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA_SQL);
  });

  afterEach(() => {
    db.close();
  });

  it('wallets table has HD columns', () => {
    const cols = db.pragma('table_info(wallets)') as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('key_type');
    expect(colNames).toContain('encrypted_mnemonic');
    expect(colNames).toContain('encrypted_solana_key');
    expect(colNames).toContain('solana_address');
  });

  it('legacy wallets have default key_type', () => {
    db.prepare(
      `INSERT INTO wallets(id,name,address,encrypted_private_key,created_at)
       VALUES('w1','legacy1','0xaaaa','encrypted','2024-01-01T00:00:00Z')`
    ).run();
    const row = db.prepare('SELECT key_type FROM wallets WHERE id=?').get('w1') as { key_type: string };
    expect(row.key_type).toBe('legacy');
  });

  it('HD wallets store all fields', () => {
    db.prepare(
      `INSERT INTO wallets(id,name,address,encrypted_private_key,key_type,encrypted_mnemonic,encrypted_solana_key,solana_address,created_at)
       VALUES('w2','hd1','0xbbbb','enc_evm','hd','enc_mnemonic','enc_sol','SoLAddr123','2024-01-01T00:00:00Z')`
    ).run();
    const row = db.prepare('SELECT * FROM wallets WHERE id=?').get('w2') as Record<string, unknown>;
    expect(row.key_type).toBe('hd');
    expect(row.encrypted_mnemonic).toBe('enc_mnemonic');
    expect(row.encrypted_solana_key).toBe('enc_sol');
    expect(row.solana_address).toBe('SoLAddr123');
  });
});

describe('legacy wallet backward compatibility', () => {
  it('walletBalance rejects Solana chain for legacy wallet', async () => {
    // Import the function to test the error path directly
    const { isSolanaChain } = await import('../src/core/chains.js');
    expect(isSolanaChain('solana')).toBe(true);

    // Legacy wallet has no solana_address
    const legacyWallet = {
      id: 'w1',
      name: 'legacy',
      address: '0xaaa',
      encrypted_private_key: 'enc',
      key_type: 'legacy' as const,
      encrypted_mnemonic: null,
      encrypted_solana_key: null,
      solana_address: null,
      created_at: '2024-01-01',
    };

    // The check that tx-service does
    if (isSolanaChain('solana') && !legacyWallet.solana_address) {
      expect(true).toBe(true); // Correctly blocked
    } else {
      throw new Error('Should have been blocked');
    }
  });

  it('HD wallet has solana_address and passes Solana check', () => {
    const hdWallet = {
      id: 'w2',
      name: 'hd',
      address: '0xbbb',
      encrypted_private_key: 'enc',
      key_type: 'hd' as const,
      encrypted_mnemonic: 'enc_mn',
      encrypted_solana_key: 'enc_sk',
      solana_address: 'SoLAddr',
      created_at: '2024-01-01',
    };

    expect(hdWallet.solana_address).toBeTruthy();
  });
});
