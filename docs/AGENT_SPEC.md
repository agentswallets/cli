# AgentsWallets CLI Agent Spec (MVP Locked)

## Top-level commands

```bash
aw init
aw unlock
aw lock
aw wallet
aw send
aw predict
aw tx
aw policy
aw audit
aw health
```

No hidden or alternative top-level command groups.

## Machine output rules

- All commands support `--json`.
- Non-TTY defaults to JSON mode automatically.
- `--output human` explicitly forces human-readable output even in non-TTY.
- In JSON mode:
  - `stdout`: all JSON output — both success and error (single line, via `process.stdout.write`)
  - All third-party noise (ethers warnings, etc.) is suppressed.
- Process always exits deterministically after command completion.

## Global options

All commands accept these common options:

- `--json` — Output as JSON
- `--output <human|json>` — Explicit output format
- `--non-interactive` — Disable interactive prompts
- `--request-id <id>` — Request id for tracing (also `AW_REQUEST_ID` env var)
- `--timeout <ms>` — RPC timeout in milliseconds (default: 30000)

## JSON envelope

Success:

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "meta": {
    "request_id": "req_xxx"
  }
}
```

Failure:

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "ERR_NEED_UNLOCK",
    "message": "Session expired or invalid",
    "details": {},
    "recovery_hint": "Run `aw unlock` to start a session."
  },
  "meta": {
    "request_id": "req_xxx"
  }
}
```

The `recovery_hint` field is included on error responses when an actionable recovery step exists. Agents can use this to self-recover without human intervention.

## Exit code contract

- `0`: success
- `1`: business error (bad input, policy violation)
- `2`: system error (RPC down, internal failure)
- `3`: authentication error (session expired, wrong password — agent can self-recover via `aw unlock`)

## Non-interactive contract

Use:

```bash
export AW_NON_INTERACTIVE=1
export AW_JSON=1
export AW_MASTER_PASSWORD=...
```

Sensitive commands require a valid `aw unlock` session.

## Session model

`aw unlock` creates two files:
- `session.json` — contains token hash + expiry (15-minute TTL)
- `session-token` — contains the raw token

Token verification is **required** (not optional):
- Session file must exist and not be expired
- Token must be present (from `AW_UNLOCK_TOKEN`, `AW_UNLOCK_TOKEN_FILE`, or the default `session-token` file)
- Token hash must match the session file

`aw lock` clears both session files immediately.

Environment variables:
- `AW_UNLOCK_TOKEN` — direct token value
- `AW_UNLOCK_TOKEN_FILE` — path to token file (must be under `$AGENTSWALLETS_HOME`)

## Idempotency contract

Supported write commands:

- `aw send --idempotency-key ...`
- `aw predict buy --idempotency-key ...`
- `aw predict sell --idempotency-key ...`

`--idempotency-key` is optional — a UUID is auto-generated if omitted.
Reusing the same key must return the same business result and must not duplicate writes.
Key reservation, policy check, and pending record creation are performed atomically in a single IMMEDIATE transaction (no TOCTOU).

## Operation identity contract

- `tx_id`: internal operation id (primary id for `aw tx status`)
- `tx_hash`: chain transaction hash (if on-chain)
- `provider_order_id`: third-party order id (for predict operations)

On-chain transactions use a three-phase write model:
1. INSERT `pending` operation before broadcasting
2. UPDATE to `broadcasted` after successful chain submission
3. UPDATE to `failed` if chain submission fails

This ensures no data loss even if the process crashes after chain broadcast.

## Policy behavior (MVP)

- No approval queue in MVP.
- Limit violations are rejected directly:
  - `ERR_DAILY_LIMIT_EXCEEDED`
  - `ERR_PER_TX_LIMIT_EXCEEDED`
  - `ERR_TX_COUNT_LIMIT_EXCEEDED`
- `require_approval_above` threshold is enforced (rejects with `ERR_APPROVAL_THRESHOLD_EXCEEDED` if amount exceeds threshold).
- Spending amounts use integer micro-units internally to avoid floating-point precision issues.
- Sell operations skip spend limits (daily/per-tx/approval) but still enforce rate limits (max_tx_per_day) and allowlists.

## Policy commands

Two equivalent entry points (same behavior):

- `aw policy show alice` / `aw wallet settings alice` — show current policy
- `aw policy set alice` / `aw wallet settings-set alice` — update limits

Agents should prefer `aw policy show/set` as the canonical commands.

## Wallet balance output

`aw wallet balance <wallet> --json` returns:

- `data.balances.POL` — native token
- `data.balances.USDC` — native USDC (CCTP, contract `0x3c49...`)
- `data.balances['USDC.e']` — legacy bridged USDC.e (contract `0x2791...`)

Key set is fixed: `{ POL, USDC, USDC.e }`.

`data.balances_number` contains the same balances as numeric values (not strings) for easier arithmetic.

## Wallet name constraints

Wallet names must match `[a-zA-Z0-9_-]{1,64}`.

## Private key export

`aw wallet export-key <wallet>` returns the private key directly in the JSON response (`data.private_key`).
No plaintext key is written to disk. The key only exists in the response payload.
Command is always registered but requires `AW_ALLOW_EXPORT=1` at runtime — otherwise returns a clear error.

## Predict session requirements

- `predict markets` — no unlock required (public data)
- `predict positions` — no unlock required (reads public on-chain data by wallet address)
- `predict buy` — requires `aw unlock` (signs transactions with private key)
- `predict sell` — requires `aw unlock` (signs transactions with private key)
- `predict orders` — requires `aw unlock` (authenticates with private key)

## Predict sell semantics

`aw predict sell` always means selling an existing position (`--position`), not placing an opposite buy.
The `size` parameter represents an upper-bound spending estimate (each outcome share ≤ $1).
Sell operations are exempt from daily/per-tx spend limits (you're liquidating, not spending).

## Audit log

`aw audit list --wallet <wallet>` returns recent audit entries.

Options:

- `--action <action>` — filter by action (e.g. `tx.send`, `predict.buy`)
- `--limit <n>` — max entries (default 50, must be positive integer)

Each audit entry includes `prev_hash` and `entry_hash` forming a SHA-256 hash chain for tamper detection.

## Health check

`aw health --json` returns system readiness status. No unlock required.

Output fields:

- `version` — CLI version string
- `chain_id` — configured chain ID (137 for Polygon)
- `db.ok` — database initialized and accessible
- `session.ok` — valid unlock session exists
- `rpc.ok` — RPC endpoint reachable and on correct chain
- `rpc.url` — RPC endpoint (API keys redacted)
- `polymarket_cli.ok` — polymarket CLI binary found in PATH

The `rpc.url` field always redacts API keys (e.g. `/v2/***`). Error messages are sanitized via `safeSummary()` to prevent secret leakage.

Set `AW_HEALTH_VERBOSE=1` to include full diagnostic details in error responses.

Polymarket CLI detection tries `polymarket-cli` first, then `polymarket` (matching the runtime adapter).

## RPC security

- Non-localhost `http://` RPC URLs are rejected. Use HTTPS.
- Localhost URLs (`127.0.0.1`, `::1`, `localhost`) are allowed over HTTP for development.
- RPC timeout defaults to 30 seconds. Override with `--timeout <ms>`.

## Command Requirements Matrix

| Command | Init required | Unlock required | Master password | Idempotency key | Confirm |
|---------|:---:|:---:|:---:|:---:|:---:|
| `aw init` | — | — | yes (create) | — | — |
| `aw unlock` | yes | — | yes | — | — |
| `aw lock` | yes | — | — | — | — |
| `aw wallet create` | yes | — | yes | — | — |
| `aw wallet list` | yes | — | — | — | — |
| `aw wallet address` | yes | — | — | — | — |
| `aw wallet info` | yes | — | — | — | — |
| `aw wallet balance` | yes | — | — | — | — |
| `aw wallet export-key` | yes | — | yes | — | yes |
| `aw send` / `aw tx send` | yes | yes | yes | yes | — |
| `aw tx history` | yes | yes | — | — | — |
| `aw tx status` | yes | yes | — | — | — |
| `aw predict markets` | yes | — | — | — | — |
| `aw predict positions` | yes | — | — | — | — |
| `aw predict buy` | yes | yes | yes | yes | — |
| `aw predict sell` | yes | yes | yes | yes | — |
| `aw predict orders` | yes | yes | yes | — | — |
| `aw policy show` | yes | yes | — | — | — |
| `aw policy set` | yes | yes | — | — | — |
| `aw audit list` | yes | yes | — | — | — |
| `aw health` | — | — | — | — | — |

## CLI aliases

- `aw tx send` is an alias for `aw send`
- `aw wallet settings` is an alias for `aw policy show`
- `aw wallet settings-set` is an alias for `aw policy set`
- `aw predict markets` accepts `-q, --query` (not `--q`)

## Wallet resolution

Wallet identifiers are resolved in this order:
- `0x` + 42 chars → address lookup (case insensitive)
- `0x` + other length → error ("Invalid wallet address")
- UUID format → id lookup (backward compatible)
- Anything else → name lookup

All `--wallet` flags and positional `[wallet]` arguments accept name, address, or UUID.
Output never exposes internal UUIDs — only `name` and `address` are returned.

## Workflow Guides

### Getting Started

```bash
aw init --json
aw unlock --json
aw wallet create --name alice --json
aw wallet list --json
aw wallet balance alice --json
aw send --wallet alice --to 0x742d... --amount 0.001 --token POL --json
```

### Prediction Market Flow

```bash
# 1. Check & set approvals (one-time per wallet)
aw predict approve-check --wallet alice --json
aw predict approve-set --wallet alice --json

# 2. Search markets
aw predict markets -q "trump" --limit 10 --json

# 3. Buy outcome
aw predict buy --wallet alice --market <market_id> --outcome yes --size 10 --price 0.4 --json

# 4. Monitor positions
aw predict positions --wallet alice --json
aw predict orders --wallet alice --json

# 5. Sell or cancel
aw predict sell --wallet alice --position <position_id> --size 5 --json
aw predict cancel --wallet alice --order-id <order_id> --json
```

### Policy Management

```bash
# View current policy
aw policy show alice --json

# Set limits
aw policy set alice --limit-daily 500 --limit-per-tx 100 --json
aw policy set alice --allowed-tokens POL,USDC --max-tx-per-day 50 --json

# Verify: send exceeding limit is rejected
aw send --wallet alice --to 0x... --amount 200 --token USDC --dry-run --json
```

### Session Management

```bash
# Start session
aw unlock --json

# Operations...
aw wallet balance alice --json
aw send --wallet alice --to 0x... --amount 1 --token POL --json

# On ERR_NEED_UNLOCK: re-run aw unlock --json
# End session
aw lock --json
```

### Idempotency

- `--idempotency-key` is optional on `send`, `predict buy`, `predict sell`
- If omitted, a UUID is auto-generated
- If provided, reusing the same key returns the same result (no duplicate writes)
- Use explicit keys when you need retry safety across process restarts

### Error Recovery Matrix

| Error code | Exit | Agent action |
|------------|------|-------------|
| `ERR_NOT_INITIALIZED` | 1 | `aw init --json` |
| `ERR_NEED_UNLOCK` | 3 | `aw unlock --json` |
| `ERR_AUTH_FAILED` | 3 | Check password, `aw unlock --json` |
| `ERR_WALLET_NOT_FOUND` | 1 | `aw wallet list --json`, verify name |
| `ERR_INSUFFICIENT_FUNDS` | 1 | `aw wallet balance <name> --json`, top up |
| `ERR_DAILY_LIMIT_EXCEEDED` | 1 | Wait UTC midnight or `aw policy set <name> --limit-daily <n>` |
| `ERR_PER_TX_LIMIT_EXCEEDED` | 1 | Reduce amount or `aw policy set <name> --limit-per-tx <n>` |
| `ERR_TX_COUNT_LIMIT_EXCEEDED` | 1 | Wait UTC midnight or `aw policy set <name> --max-tx-per-day <n>` |
| `ERR_TOKEN_NOT_ALLOWED` | 1 | `aw policy set <name> --allowed-tokens POL,USDC,USDC.e` |
| `ERR_ADDRESS_NOT_ALLOWED` | 1 | `aw policy set <name> --allowed-addresses <addr>` |
| `ERR_RPC_UNAVAILABLE` | 2 | Check network, set `AW_RPC_URL`, retry |
| `ERR_POLYMARKET_CLI_NOT_FOUND` | 2 | Install polymarket-cli |
| `ERR_INVALID_PARAMS` | 1 | Check command arguments |
