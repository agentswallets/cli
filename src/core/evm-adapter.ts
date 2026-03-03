import { Contract, Wallet, formatEther, formatUnits, parseEther, parseUnits } from 'ethers';
import type { ChainKey } from './chains.js';
import { getChain, resolveToken } from './chains.js';
import { getProvider, verifyChainId } from './rpc.js';
import type { ChainAdapter } from './chain-adapter.js';

export class EvmAdapter implements ChainAdapter {
  constructor(private chainKey: ChainKey) {}

  async getBalances(address: string): Promise<Record<string, string>> {
    const chain = getChain(this.chainKey);
    await verifyChainId(this.chainKey);
    const provider = getProvider(this.chainKey);

    const queries = chain.tokens.map(token => {
      if (token.address === null) {
        return provider.getBalance(address);
      }
      return new Contract(
        token.address,
        ['function balanceOf(address) view returns (uint256)'],
        provider
      ).balanceOf(address);
    });

    const rawResults = await Promise.all(queries);

    const balances: Record<string, string> = {};
    chain.tokens.forEach((token, i) => {
      if (token.address === null) {
        balances[token.symbol] = formatEther(rawResults[i]);
      } else {
        balances[token.symbol] = formatUnits(rawResults[i], token.decimals);
      }
    });

    return balances;
  }

  async send(params: {
    privateKey: Buffer;
    to: string;
    token: string;
    amount: string;
  }): Promise<{ txHash: string; status: string }> {
    const chain = getChain(this.chainKey);
    const tokenInfo = resolveToken(chain, params.token);
    await verifyChainId(this.chainKey);

    const signer = new Wallet(params.privateKey.toString('utf8'), getProvider(this.chainKey));
    let txHash = '';

    if (tokenInfo.address === null) {
      const tx = await signer.sendTransaction({ to: params.to, value: parseEther(params.amount) });
      txHash = tx.hash;
    } else {
      const contract = new Contract(tokenInfo.address, ['function transfer(address to, uint256 amount) returns (bool)'], signer);
      const tx = await contract.transfer(params.to, parseUnits(params.amount, tokenInfo.decimals));
      txHash = tx.hash;
    }

    return { txHash, status: 'broadcasted' };
  }

  async waitForConfirmation(txHash: string, timeoutMs: number): Promise<{ status: string }> {
    const provider = getProvider(this.chainKey);
    try {
      const receipt = await provider.waitForTransaction(txHash, 1, timeoutMs);
      if (receipt) {
        return { status: receipt.status === 1 ? 'confirmed' : 'failed' };
      }
    } catch {
      // Timeout or network error — keep broadcasted
    }
    return { status: 'broadcasted' };
  }
}

const adapters = new Map<ChainKey, EvmAdapter>();

export function getEvmAdapter(chainKey: ChainKey): EvmAdapter {
  let adapter = adapters.get(chainKey);
  if (!adapter) {
    adapter = new EvmAdapter(chainKey);
    adapters.set(chainKey, adapter);
  }
  return adapter;
}
