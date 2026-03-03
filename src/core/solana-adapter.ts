import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { getChain, resolveToken } from './chains.js';
import { getSolanaConnection } from './solana-provider.js';
import type { ChainAdapter } from './chain-adapter.js';

export class SolanaAdapter implements ChainAdapter {
  async getBalances(address: string): Promise<Record<string, string>> {
    const chain = getChain('solana');
    const connection = getSolanaConnection();
    const pubkey = new PublicKey(address);

    const balances: Record<string, string> = {};

    // SOL balance
    const lamports = await connection.getBalance(pubkey);
    balances['SOL'] = (lamports / LAMPORTS_PER_SOL).toString();

    // SPL token balances
    for (const token of chain.tokens) {
      if (token.address === null) continue; // already handled SOL
      try {
        const mint = new PublicKey(token.address);
        const ata = await getAssociatedTokenAddress(mint, pubkey);
        const account = await getAccount(connection, ata);
        const divisor = 10 ** token.decimals;
        balances[token.symbol] = (Number(account.amount) / divisor).toString();
      } catch (err: unknown) {
        // TokenAccountNotFoundError — no ATA means zero balance
        balances[token.symbol] = '0';
      }
    }

    return balances;
  }

  async send(params: {
    privateKey: Buffer;
    to: string;
    token: string;
    amount: string;
  }): Promise<{ txHash: string; status: string }> {
    const chain = getChain('solana');
    const tokenInfo = resolveToken(chain, params.token);
    const connection = getSolanaConnection();

    const keypair = Keypair.fromSecretKey(Buffer.from(params.privateKey.toString('utf8'), 'hex'));
    const toPubkey = new PublicKey(params.to);

    let signature: string;

    if (tokenInfo.address === null) {
      // SOL transfer
      const lamports = Math.round(parseFloat(params.amount) * LAMPORTS_PER_SOL);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey,
          lamports,
        })
      );
      signature = await sendAndConfirmTransaction(connection, tx, [keypair], { commitment: 'confirmed' });
    } else {
      // SPL Token transfer
      const mint = new PublicKey(tokenInfo.address);
      const fromAta = await getAssociatedTokenAddress(mint, keypair.publicKey);

      // getOrCreateAssociatedTokenAccount creates the ATA if it doesn't exist (payer = sender)
      const toAta = await getOrCreateAssociatedTokenAccount(
        connection,
        keypair,
        mint,
        toPubkey
      );

      const rawAmount = BigInt(Math.round(parseFloat(params.amount) * (10 ** tokenInfo.decimals)));
      const tx = new Transaction().add(
        createTransferInstruction(
          fromAta,
          toAta.address,
          keypair.publicKey,
          rawAmount,
          [],
          TOKEN_PROGRAM_ID
        )
      );
      signature = await sendAndConfirmTransaction(connection, tx, [keypair], { commitment: 'confirmed' });
    }

    return { txHash: signature, status: 'confirmed' };
  }

  async waitForConfirmation(txHash: string, timeoutMs: number): Promise<{ status: string }> {
    const connection = getSolanaConnection();
    try {
      const latestBlockhash = await connection.getLatestBlockhash();
      const result = await connection.confirmTransaction(
        { signature: txHash, ...latestBlockhash },
        'confirmed'
      );
      if (result.value.err) {
        return { status: 'failed' };
      }
      return { status: 'confirmed' };
    } catch {
      return { status: 'broadcasted' };
    }
  }
}

let instance: SolanaAdapter | null = null;

export function getSolanaAdapter(): SolanaAdapter {
  if (!instance) {
    instance = new SolanaAdapter();
  }
  return instance;
}
