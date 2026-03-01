# AgentsWallets CLI

Secure local wallet CLI for AI agents on Polygon.

- Private keys never leave the local machine (AES-256-GCM encrypted at rest)
- Policy engine enforces per-tx limits, daily limits, token allowlists
- All output is structured JSON for agent consumption
- Polymarket prediction market integration built-in

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
aw wallet balance --wallet alice
aw send --wallet alice --to 0x... --amount 1 --token USDC
```

## Agent mode

```bash
export AW_NON_INTERACTIVE=1
export AW_JSON=1
export AW_MASTER_PASSWORD='your-password'

aw unlock --json
aw wallet list --json
aw send --wallet alice --to 0x... --amount 1 --token USDC --json
```

- `AW_NON_INTERACTIVE=1` — disable interactive prompts
- `AW_JSON=1` — force structured JSON output
- `AW_MASTER_PASSWORD` — provide password without prompt

## Commands

### Setup

```bash
aw init                              # Initialize data store
aw unlock                            # Start authenticated session
aw lock                              # End session
aw health                            # Check system status
```

### Wallet

```bash
aw wallet create --name <name>       # Create new wallet
aw wallet list                       # List all wallets
aw wallet info --wallet <name>       # Wallet details
aw wallet balance --wallet <name>    # Check balances (POL, USDC, USDC.e)
aw wallet balance --all              # All wallets at once
aw wallet deposit-address --wallet <name>  # Get deposit address
```

### Transfers

```bash
aw send \
  --wallet alice \
  --to 0x... \
  --amount 10 \
  --token USDC \
  --dry-run                          # Validate without sending
```

Idempotency keys are auto-generated. Pass `--idempotency-key <key>` for explicit retry safety.

### Policy

```bash
aw policy show --wallet alice
aw policy set --wallet alice \
  --limit-daily 500 \
  --limit-per-tx 100 \
  --max-tx-per-day 20 \
  --allowed-tokens POL,USDC,USDC.e \
  --allowed-addresses 0x...,0x...
```

### Prediction markets (Polymarket)

Requires [polymarket-cli](https://github.com/Polymarket/cli) installed separately.

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

All commands output a consistent JSON envelope:

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
| `AW_MASTER_PASSWORD` | Master password for non-interactive unlock |
| `AW_RPC_URL` | Custom Polygon RPC URL(s), comma-separated |
| `AW_SESSION_TTL_MINUTES` | Session timeout (default: 15, max: 15) |
| `AW_ALLOW_EXPORT` | Enable `wallet export-key` (`1`) |
| `AGENTSWALLETS_HOME` | Custom data directory (default: `~/.agentswallets`) |

## Security

- Master password is verified via scrypt-derived key
- Private keys are AES-256-GCM encrypted, never exposed in CLI output
- Session tokens are time-limited with automatic sliding-window renewal
- Policy engine runs pre-flight checks before every transaction
- All sensitive operations are recorded in the audit log

## License

[ISC](LICENSE)
