import { ClobClient, Chain, Side, OrderType, SignatureType, AssetType } from '@polymarket/clob-client';
import type { ApiKeyCreds, OrderResponse } from '@polymarket/clob-client';
import { BuilderConfig } from '@polymarket/builder-signing-sdk';
import { Wallet as EthersV5Wallet } from '@ethersproject/wallet';
import { Wallet as EthersV6Wallet, JsonRpcProvider, Contract } from 'ethers';
import { AppError } from '../errors.js';
import {
  EMBEDDED_POLY_BUILDER_API_KEY,
  EMBEDDED_POLY_BUILDER_SECRET,
  EMBEDDED_POLY_BUILDER_PASSPHRASE,
} from './embedded-keys.js';
import type {
  PolymarketAdapter,
  AdapterResult,
  SearchMarketsInput,
  BuyInput,
  SellInput,
  PositionsInput,
  OrdersInput,
  CancelOrderInput,
  ApproveCheckInput,
  ApproveSetInput,
  UpdateBalanceInput,
  CtfSplitInput,
  CtfMergeInput,
  CtfRedeemInput,
  BridgeDepositInput,
} from './adapter.js';

/* ── URLs ─────────────────────────────────────────── */
const CLOB_URL = 'https://clob.polymarket.com';
const GAMMA_URL = 'https://gamma-api.polymarket.com';
const DATA_URL = 'https://data-api.polymarket.com';
const REQUEST_TIMEOUT_MS = 30_000;

/* ── Polygon contract addresses (Polymarket docs) ── */
const EXCHANGE_ADDRESS = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
const NEG_RISK_EXCHANGE_ADDRESS = '0xC5d563A36AE78145C45a50134d48A1215220f80a';
const NEG_RISK_ADAPTER_ADDRESS = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const USDC_E_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const POLYGON_RPC = 'https://polygon.drpc.org';

const MAX_UINT256 = '115792089237316195423570985008687907853269984665640564039457584007913129639935';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];
const ERC1155_ABI = [
  'function setApprovalForAll(address operator, bool approved)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
];
const CTF_EXCHANGE_ABI = [
  'function splitPosition(bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)',
  'function mergePositions(bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)',
  'function redeemPositions(bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)',
];

/* ── Builder config ────────────────────────────────── */
function getBuilderConfig(): BuilderConfig | undefined {
  const key = process.env.POLY_BUILDER_API_KEY || EMBEDDED_POLY_BUILDER_API_KEY;
  const secret = process.env.POLY_BUILDER_SECRET || EMBEDDED_POLY_BUILDER_SECRET;
  const passphrase = process.env.POLY_BUILDER_PASSPHRASE || EMBEDDED_POLY_BUILDER_PASSPHRASE;
  if (!key || !secret || !passphrase) return undefined;
  return new BuilderConfig({ localBuilderCreds: { key, secret, passphrase } });
}

/* ── Helpers ───────────────────────────────────────── */
async function jsonFetch<T>(url: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AppError('ERR_POLYMARKET_FAILED', `Polymarket API error (HTTP ${res.status}): ${text}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AppError('ERR_POLYMARKET_TIMEOUT', `Polymarket API request timed out after ${timeoutMs}ms`);
    }
    throw new AppError('ERR_POLYMARKET_FAILED', `Polymarket API request failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

function wrapSdkError(err: unknown, fallbackCode: 'ERR_POLYMARKET_FAILED' | 'ERR_POLYMARKET_AUTH' | 'ERR_POLYMARKET_TIMEOUT'): AppError {
  if (err instanceof AppError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('401') || lower.includes('403')) {
    return new AppError('ERR_POLYMARKET_AUTH', `Polymarket auth failed: ${msg}`);
  }
  if (lower.includes('timeout') || lower.includes('abort')) {
    return new AppError('ERR_POLYMARKET_TIMEOUT', `Polymarket timeout: ${msg}`);
  }
  return new AppError(fallbackCode, msg);
}

/* ── Resolve token ID from CLOB market data ────────── */
function resolveTokenIdFromMarket(market: Record<string, unknown>, outcome: 'yes' | 'no', marketId: string): string {
  // CLOB API returns tokens: [{ token_id, outcome, price }]
  const tokens = market.tokens as Array<{ token_id: string; outcome: string }> | undefined;
  if (Array.isArray(tokens)) {
    const match = tokens.find((t) => t.outcome.toLowerCase() === outcome);
    if (match) return match.token_id;
  }
  throw new AppError('ERR_MARKET_NOT_FOUND', `Could not resolve ${outcome} token for market ${marketId}`);
}

/* ── SDK Adapter ───────────────────────────────────── */
export class SdkPolymarketAdapter implements PolymarketAdapter {
  private builderConfig = getBuilderConfig();
  private l2CredsCache = new Map<string, ApiKeyCreds>();

  /** Read-only CLOB client (no auth). */
  private getReadClient(): ClobClient {
    return new ClobClient(CLOB_URL, Chain.POLYGON);
  }

  /** Authenticated CLOB client for trading operations. */
  private async getAuthClient(privateKey: string): Promise<{ client: ClobClient; address: string }> {
    // ClobClient needs ethers v5 Wallet (has _signTypedData)
    const wallet = new EthersV5Wallet(privateKey);
    const address = await wallet.getAddress();

    // Get or derive L2 API credentials
    let creds = this.l2CredsCache.get(address);
    if (!creds) {
      try {
        const tempClient = new ClobClient(CLOB_URL, Chain.POLYGON, wallet);
        creds = await tempClient.createOrDeriveApiKey();
        this.l2CredsCache.set(address, creds);
      } catch (err) {
        throw new AppError('ERR_POLYMARKET_AUTH', `Failed to derive API credentials: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const client = new ClobClient(
      CLOB_URL,
      Chain.POLYGON,
      wallet,
      creds,
      SignatureType.EOA,
      address,
      undefined,  // geoBlockToken
      false,       // useServerTime
      this.builderConfig,
    );

    return { client, address };
  }

  /** ethers v6 wallet connected to Polygon RPC for on-chain txs. */
  private getOnChainWallet(privateKey: string): EthersV6Wallet {
    const provider = new JsonRpcProvider(POLYGON_RPC);
    return new EthersV6Wallet(privateKey, provider);
  }

  /* ── Read operations ─────────────────────────────── */

  async searchMarkets(input: SearchMarketsInput): Promise<AdapterResult> {
    const params = new URLSearchParams({ title: input.query, limit: String(input.limit), active: 'true' });
    const data = await jsonFetch<unknown>(`${GAMMA_URL}/events?${params}`);
    return { data };
  }

  async positions(input: PositionsInput): Promise<AdapterResult> {
    const data = await jsonFetch<unknown>(`${DATA_URL}/positions?user=${input.walletAddress}`);
    return { data };
  }

  /* ── Auth-required read operations ──────────────── */

  async orders(input: OrdersInput): Promise<AdapterResult> {
    try {
      const { client } = await this.getAuthClient(input.privateKey);
      const data = await client.getOpenOrders();
      return { data };
    } catch (err) {
      throw wrapSdkError(err, 'ERR_POLYMARKET_FAILED');
    }
  }

  /* ── Trading operations ─────────────────────────── */

  async buy(input: BuyInput): Promise<AdapterResult> {
    try {
      const { client } = await this.getAuthClient(input.privateKey);

      // Resolve token ID for the outcome
      const market = (await client.getMarket(input.market)) as Record<string, unknown>;
      const tokenId = resolveTokenIdFromMarket(market, input.outcome, input.market);

      // Get tick size and negRisk (auto-fetched/cached by SDK)
      const tickSize = await client.getTickSize(tokenId);
      const negRisk = await client.getNegRisk(tokenId);

      const result = (await client.createAndPostOrder(
        { tokenID: tokenId, price: input.price, size: input.size, side: Side.BUY },
        { tickSize, negRisk },
        OrderType.GTC,
      )) as OrderResponse;

      return {
        provider_order_id: result.orderID || '',
        provider_status: result.status || (result.success ? 'submitted' : 'failed'),
        data: result,
      };
    } catch (err) {
      throw wrapSdkError(err, 'ERR_POLYMARKET_FAILED');
    }
  }

  async sell(input: SellInput): Promise<AdapterResult> {
    try {
      const { client } = await this.getAuthClient(input.privateKey);

      const tickSize = await client.getTickSize(input.positionId);
      const negRisk = await client.getNegRisk(input.positionId);

      // Market sell: FOK (Fill or Kill)
      const result = (await client.createAndPostMarketOrder(
        { tokenID: input.positionId, amount: input.size, side: Side.SELL },
        { tickSize, negRisk },
        OrderType.FOK,
      )) as OrderResponse;

      return {
        provider_order_id: result.orderID || '',
        provider_status: result.status || (result.success ? 'submitted' : 'failed'),
        data: result,
      };
    } catch (err) {
      throw wrapSdkError(err, 'ERR_POLYMARKET_FAILED');
    }
  }

  async cancelOrder(input: CancelOrderInput): Promise<AdapterResult> {
    try {
      const { client } = await this.getAuthClient(input.privateKey);
      const data = await client.cancelOrder({ orderID: input.orderId });
      return { data };
    } catch (err) {
      throw wrapSdkError(err, 'ERR_POLYMARKET_FAILED');
    }
  }

  /* ── Approval operations (on-chain via ethers v6) ── */

  async approveCheck(input: ApproveCheckInput): Promise<AdapterResult> {
    try {
      const wallet = this.getOnChainWallet(input.privateKey);
      const address = wallet.address;
      const usdce = new Contract(USDC_E_ADDRESS, ERC20_ABI, wallet.provider);
      const ctf = new Contract(CTF_ADDRESS, ERC1155_ABI, wallet.provider);

      const [usdcExchange, usdcNegRisk, ctfExchange, ctfNegRisk, ctfAdapter] = await Promise.all([
        usdce.allowance(address, EXCHANGE_ADDRESS) as Promise<bigint>,
        usdce.allowance(address, NEG_RISK_EXCHANGE_ADDRESS) as Promise<bigint>,
        ctf.isApprovedForAll(address, EXCHANGE_ADDRESS) as Promise<boolean>,
        ctf.isApprovedForAll(address, NEG_RISK_EXCHANGE_ADDRESS) as Promise<boolean>,
        ctf.isApprovedForAll(address, NEG_RISK_ADAPTER_ADDRESS) as Promise<boolean>,
      ]);

      const data = {
        usdc_exchange: usdcExchange > 0n,
        usdc_neg_risk_exchange: usdcNegRisk > 0n,
        ctf_exchange: ctfExchange,
        ctf_neg_risk_exchange: ctfNegRisk,
        ctf_neg_risk_adapter: ctfAdapter,
        all_approved: usdcExchange > 0n && usdcNegRisk > 0n && ctfExchange && ctfNegRisk && ctfAdapter,
      };
      return { data };
    } catch (err) {
      throw wrapSdkError(err, 'ERR_POLYMARKET_FAILED');
    }
  }

  async approveSet(input: ApproveSetInput): Promise<AdapterResult> {
    try {
      const wallet = this.getOnChainWallet(input.privateKey);
      const usdce = new Contract(USDC_E_ADDRESS, ERC20_ABI, wallet);
      const ctf = new Contract(CTF_ADDRESS, ERC1155_ABI, wallet);
      const txHashes: string[] = [];

      // 1. USDC.e → CTF Exchange
      const tx1 = await usdce.approve(EXCHANGE_ADDRESS, MAX_UINT256);
      txHashes.push(tx1.hash);
      await tx1.wait();

      // 2. USDC.e → Neg Risk CTF Exchange
      const tx2 = await usdce.approve(NEG_RISK_EXCHANGE_ADDRESS, MAX_UINT256);
      txHashes.push(tx2.hash);
      await tx2.wait();

      // 3. CTF → CTF Exchange
      const tx3 = await ctf.setApprovalForAll(EXCHANGE_ADDRESS, true);
      txHashes.push(tx3.hash);
      await tx3.wait();

      // 4. CTF → Neg Risk CTF Exchange
      const tx4 = await ctf.setApprovalForAll(NEG_RISK_EXCHANGE_ADDRESS, true);
      txHashes.push(tx4.hash);
      await tx4.wait();

      // 5. CTF → Neg Risk Adapter
      const tx5 = await ctf.setApprovalForAll(NEG_RISK_ADAPTER_ADDRESS, true);
      txHashes.push(tx5.hash);
      await tx5.wait();

      return { data: { approved: true, txs: txHashes.length, tx_hashes: txHashes } };
    } catch (err) {
      throw wrapSdkError(err, 'ERR_POLYMARKET_FAILED');
    }
  }

  async updateBalance(input: UpdateBalanceInput): Promise<AdapterResult> {
    try {
      const { client } = await this.getAuthClient(input.privateKey);
      await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
      const result = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
      return { data: { balance: result.balance, allowance: result.allowance } };
    } catch (err) {
      throw wrapSdkError(err, 'ERR_POLYMARKET_FAILED');
    }
  }

  /* ── CTF operations (on-chain) ──────────────────── */

  async ctfSplit(input: CtfSplitInput): Promise<AdapterResult> {
    try {
      const wallet = this.getOnChainWallet(input.privateKey);
      const ctf = new Contract(CTF_ADDRESS, CTF_EXCHANGE_ABI, wallet);
      const amountWei = BigInt(Math.round(input.amount * 1e6)); // USDC.e has 6 decimals
      const tx = await ctf.splitPosition(
        '0x' + '0'.repeat(64), // parentCollectionId (zero for root)
        input.condition,
        [1, 2], // partition: Yes=1, No=2
        amountWei,
      );
      await tx.wait();
      return { data: { split: true, tx_hash: tx.hash, amount: input.amount } };
    } catch (err) {
      throw wrapSdkError(err, 'ERR_POLYMARKET_FAILED');
    }
  }

  async ctfMerge(input: CtfMergeInput): Promise<AdapterResult> {
    try {
      const wallet = this.getOnChainWallet(input.privateKey);
      const ctf = new Contract(CTF_ADDRESS, CTF_EXCHANGE_ABI, wallet);
      const amountWei = BigInt(Math.round(input.amount * 1e6));
      const tx = await ctf.mergePositions(
        '0x' + '0'.repeat(64),
        input.condition,
        [1, 2],
        amountWei,
      );
      await tx.wait();
      return { data: { merged: true, tx_hash: tx.hash, amount: input.amount } };
    } catch (err) {
      throw wrapSdkError(err, 'ERR_POLYMARKET_FAILED');
    }
  }

  async ctfRedeem(input: CtfRedeemInput): Promise<AdapterResult> {
    try {
      const wallet = this.getOnChainWallet(input.privateKey);
      const ctf = new Contract(CTF_ADDRESS, CTF_EXCHANGE_ABI, wallet);
      const tx = await ctf.redeemPositions(
        '0x' + '0'.repeat(64),
        input.condition,
        [1, 2],
      );
      await tx.wait();
      return { data: { redeemed: true, tx_hash: tx.hash } };
    } catch (err) {
      throw wrapSdkError(err, 'ERR_POLYMARKET_FAILED');
    }
  }

  /* ── Bridge deposit ─────────────────────────────── */

  async bridgeDeposit(input: BridgeDepositInput): Promise<AdapterResult> {
    // Call Polymarket Bridge API to get deposit addresses for all supported chains.
    // Depositing to these addresses auto-converts to USDC.e on Polygon.
    try {
      const res = await jsonFetch('https://bridge.polymarket.com/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: input.walletAddress }),
      });
      return {
        data: {
          ...(res as Record<string, unknown>),
          polygon_address: input.walletAddress,
          usdc_e_address: USDC_E_ADDRESS,
          instructions: 'Send USDC to any deposit address above. Funds auto-convert to USDC.e on Polygon. Or use `aw swap --from USDC --to USDC.e --chain polygon` for on-chain swap.',
        },
      };
    } catch {
      // Fallback if Bridge API is unavailable
      return {
        data: {
          polygon_address: input.walletAddress,
          usdc_e_address: USDC_E_ADDRESS,
          instructions: 'Send USDC.e to your Polygon address, or use `aw swap --from USDC --to USDC.e --chain polygon` to convert native USDC.',
        },
      };
    }
  }
}
