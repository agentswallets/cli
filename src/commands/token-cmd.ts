import { assertInitialized } from '../core/db.js';
import { resolveChainKey, getChain } from '../core/chains.js';
import { getOkxCredentials } from '../core/okx/client.js';
import { chainKeyToOkxChainIndex, resolveTokenAddress } from '../core/okx/token-resolver.js';
import { searchTokens, getTokenInfo, getTrendingTokens, getTokenHolders } from '../core/okx/token.js';
import type { TokenSearchResult, TokenInfoResult, TokenTrendingResult, TokenHolderResult } from '../core/okx/types.js';

/**
 * aw token search — search tokens by keyword.
 */
export async function tokenSearchCommand(opts: {
  chain?: string;
  keyword: string;
}): Promise<{ chain: string; results: TokenSearchResult[] }> {
  assertInitialized();

  const chainKey = resolveChainKey(opts.chain);
  const chain = getChain(chainKey);
  const credentials = getOkxCredentials();

  const results = await searchTokens({
    chainId: chainKeyToOkxChainIndex(chainKey),
    keyword: opts.keyword,
    credentials,
  });

  return { chain: chain.name, results };
}

/**
 * aw token info — get token details.
 */
export async function tokenInfoCommand(opts: {
  chain?: string;
  address: string;
}): Promise<{ chain: string; token: TokenInfoResult | null }> {
  assertInitialized();

  const chainKey = resolveChainKey(opts.chain);
  const chain = getChain(chainKey);
  const token = resolveTokenAddress(chainKey, opts.address);
  const credentials = getOkxCredentials();

  const info = await getTokenInfo({
    chainId: chainKeyToOkxChainIndex(chainKey),
    tokenContractAddress: token.address,
    credentials,
  });

  return { chain: chain.name, token: info };
}

/**
 * aw token trending — get trending tokens.
 */
export async function tokenTrendingCommand(opts: {
  chain?: string;
}): Promise<{ chain: string; tokens: TokenTrendingResult[] }> {
  assertInitialized();

  const chainKey = resolveChainKey(opts.chain);
  const chain = getChain(chainKey);
  const credentials = getOkxCredentials();

  const tokens = await getTrendingTokens({
    chainId: chainKeyToOkxChainIndex(chainKey),
    credentials,
  });

  return { chain: chain.name, tokens };
}

/**
 * aw token holders — get top holders for a token.
 */
export async function tokenHoldersCommand(opts: {
  chain?: string;
  address: string;
}): Promise<{ chain: string; token_address: string; holders: TokenHolderResult[] }> {
  assertInitialized();

  const chainKey = resolveChainKey(opts.chain);
  const chain = getChain(chainKey);
  const token = resolveTokenAddress(chainKey, opts.address);
  const credentials = getOkxCredentials();

  const holders = await getTokenHolders({
    chainId: chainKeyToOkxChainIndex(chainKey),
    tokenContractAddress: token.address,
    credentials,
  });

  return { chain: chain.name, token_address: token.address, holders };
}
