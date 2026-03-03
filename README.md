# AgentsWallets CLI

Secure local wallet CLI for AI agents. Multi-chain EVM + Solana.

- Private keys never leave the local machine (AES-256-GCM encrypted at rest)
- HD wallet: one mnemonic, EVM + Solana addresses
- Policy engine enforces per-tx limits, daily limits, token allowlists
- All output is structured JSON for agent consumption
- Polymarket prediction market integration built-in

## Supported chains

| Chain | Native token | Stablecoins | Chain ID |
|-------|-------------|-------------|----------|
| Ethereum | ETH | USDC, USDT | 1 |
| BNB Chain | BNB | USDC, USDT | 56 |
| Base | ETH | USDC | 8453 |
| Polygon | POL | USDC, USDC.e, USDT | 137 |
| Arbitrum | ETH | USDC, USDT | 42161 |
| Solana | SOL | USDC, USDT | — |

## Install

```bash
npm install -g @agentswallets/cli
```

Requires Node.js >= 20.

## Quick start

```bash
aw init
aw unlock
aw wallet create --name alice
aw wallet balance --wallet alice                    # All chains
aw wallet balance --wallet alice --chain ethereum   # Single chain
aw send --wallet alice --to 0x... --amount 1 --token USDC --chain ethereum
```

## Agent mode

```bash
export AW_NON_INTERACTIVE=1
export AW_JSON=1
export AW_MASTER_PASSWORD='your-password'

aw unlock --json
aw wallet list --json
aw send --wallet alice --to 0x... --amount 1 --token USDC --chain base --json
```

- `AW_NON_INTERACTIVE=1` — disable interactive prompts
- `AW_JSON=1` — force structured JSON output
- `AW_MASTER_PASSWORD` — provide password without prompt (cached in-process, cleared from env after first read)
- `AW_MASTER_PASSWORD_ENV` — safer alternative: name of env var holding the password (e.g. `MY_SECRET`)

## Commands

### Setup

```bash
aw init                              # Initialize data store
aw unlock                            # Start authenticated session
aw unlock --single                   # Single-op session (auto-locks after one write)
aw lock                              # End session
aw health                            # Check system status (default chain)
aw health --chain solana             # Check Solana RPC connectivity
```

### Wallet

```bash
aw wallet create --name <name>       # Create HD wallet (EVM + Solana)
aw wallet list                       # List all wallets
aw wallet info --wallet <name>       # Wallet details (addresses for all chains)
aw wallet balance --wallet <name>                   # All chains
aw wallet balance --wallet <name> --chain ethereum  # Single chain
aw wallet balance --all                             # All wallets, all chains
aw wallet deposit-address --wallet <name>                  # EVM address
aw wallet deposit-address --wallet <name> --chain solana   # Solana address
aw wallet drain --wallet <name> --to 0x... --chain polygon          # Drain all tokens
aw wallet drain --wallet <name> --to 0x... --chain polygon --dry-run  # Preview
```

### Transfers

```bash
aw send \
  --wallet alice \
  --to 0x... \
  --amount 10 \
  --token USDC \
  --chain ethereum \
  --dry-run                          # Validate without sending
```

The `--chain` flag accepts names (`ethereum`, `base`, `solana`), aliases (`eth`, `bsc`, `arb`, `sol`), or chain IDs (`1`, `137`, `8453`).

Idempotency keys are auto-generated. Pass `--idempotency-key <key>` for explicit retry safety.

### Policy

```bash
aw policy show --wallet alice
aw policy set --wallet alice \
  --limit-daily 500 \
  --limit-per-tx 100 \
  --max-tx-per-day 20 \
  --allowed-tokens ETH,USDC \
  --allowed-addresses 0x...,0x... \
  --require-approval-above 200
```

### Prediction markets (Polymarket)

Prediction commands operate on Polygon only. Requires [polymarket-cli](https://github.com/Polymarket/cli) installed separately.

```bash
aw predict markets -q "bitcoin" --limit 10
aw predict buy --wallet alice --market <id> --outcome yes --size 10 --price 0.4
aw predict sell --wallet alice --position <id> --size 5
aw predict positions --wallet alice
aw predict orders --wallet alice
aw predict cancel --wallet alice --order-id <id>
aw predict approve-check --wallet alice
aw predict approve-set --wallet alice
aw predict update-balance --wallet alice
aw predict ctf-split --wallet alice --condition <id> --amount 10
aw predict ctf-merge --wallet alice --condition <id> --amount 10
aw predict ctf-redeem --wallet alice --condition <id>
aw predict bridge-deposit --wallet alice
```

### Transaction history

```bash
aw tx list --wallet alice --limit 50
aw tx status <tx_id>
```

### Audit log

```bash
aw audit list --wallet alice --limit 50
aw audit list --wallet alice --action tx.send
```

### Keychain (macOS)

```bash
aw keychain status                   # Check keychain availability
aw keychain save                     # Store password in OS keychain
aw keychain remove                   # Remove from keychain
```

## JSON contract

All `--json` output goes to **stdout** (both success and error). stderr is reserved for human-readable warnings only.

**Success:**
```json
{
  "ok": true,
  "data": { ... },
  "error": null,
  "meta": { "request_id": "req_xxx" }
}
```

**Error:**
```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "ERR_INSUFFICIENT_FUNDS",
    "message": "Need 10 USDC, have 2.3",
    "details": { "required": "10", "available": "2.3", "token": "USDC" },
    "recovery_hint": "Top up wallet. Check balance with `aw wallet balance <name>`."
  },
  "meta": { "request_id": "req_xxx" }
}
```

## Exit codes

| Code | Meaning | Agent action |
|------|---------|-------------|
| `0` | Success | Continue |
| `1` | Business error (bad input, policy violation) | Read error, adjust params |
| `2` | System error (network, internal) | Retry or alert |
| `3` | Auth error (session expired) | Run `aw unlock` |

## Environment variables

| Variable | Description |
|----------|-------------|
| `AW_JSON` | Force JSON output (`1`) |
| `AW_NON_INTERACTIVE` | Disable prompts (`1`) |
| `AW_MASTER_PASSWORD` | Master password (cached in-process, cleared from env after first read) |
| `AW_MASTER_PASSWORD_ENV` | Name of env var holding the password (safer indirection) |
| `AW_RPC_URL_ETHEREUM` | Custom Ethereum RPC URL(s), comma-separated |
| `AW_RPC_URL_BNB` | Custom BNB Chain RPC URL(s) |
| `AW_RPC_URL_BASE` | Custom Base RPC URL(s) |
| `AW_RPC_URL_POLYGON` | Custom Polygon RPC URL(s) |
| `AW_RPC_URL_ARBITRUM` | Custom Arbitrum RPC URL(s) |
| `AW_RPC_URL_SOLANA` | Custom Solana RPC URL |
| `AW_SESSION_TTL_MINUTES` | Session timeout (default: 15, max: 15) |
| `AW_ALLOW_EXPORT` | Enable `wallet export-key` (`1`) |
| `AGENTSWALLETS_HOME` | Custom data directory (default: `~/.agentswallets`) |

## Security

- Master password is verified via scrypt-derived key
- HD wallet: BIP-39 mnemonic encrypted with AES-256-GCM, never exposed in CLI output
- EVM keys derived via m/44'/60'/0'/0/0, Solana via m/44'/501'/0'/0'
- Session tokens are time-limited with automatic sliding-window renewal
- Policy engine runs pre-flight checks before every transaction
- All sensitive operations are recorded in the audit log

## License

[ISC](LICENSE)
