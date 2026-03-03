import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { requireSolanaAddress, requireChainAddress } from '../src/util/validate.js';

describe('requireSolanaAddress', () => {
  it('accepts valid Solana address', () => {
    const keypair = Keypair.generate();
    const address = keypair.publicKey.toBase58();
    expect(requireSolanaAddress(address)).toBe(address);
  });

  it('rejects empty string', () => {
    expect(() => requireSolanaAddress('')).toThrow(/Invalid Solana address/);
  });

  it('rejects EVM address', () => {
    expect(() => requireSolanaAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toThrow(/Invalid Solana address/);
  });

  it('rejects random garbage', () => {
    expect(() => requireSolanaAddress('not-an-address')).toThrow(/Invalid Solana address/);
  });
});

describe('requireChainAddress', () => {
  it('routes to EVM validation for evm chain type', () => {
    // Valid EVM address
    expect(requireChainAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'evm')).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('routes to Solana validation for solana chain type', () => {
    const keypair = Keypair.generate();
    const address = keypair.publicKey.toBase58();
    expect(requireChainAddress(address, 'solana')).toBe(address);
  });

  it('rejects Solana address for evm chain type', () => {
    const keypair = Keypair.generate();
    expect(() => requireChainAddress(keypair.publicKey.toBase58(), 'evm')).toThrow(/Invalid address/);
  });

  it('rejects EVM address for solana chain type', () => {
    expect(() => requireChainAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'solana')).toThrow(/Invalid Solana address/);
  });
});
