# Error codes

All error codes use the `ERR_` prefix for consistent machine parsing.

## Exit codes

| Code | Category | Agent action |
|------|----------|-------------|
| `0` | Success | Continue |
| `1` | Business error | Read error, adjust params |
| `2` | System error | Retry or alert |
| `3` | Auth error | Run `aw unlock` |

## Business errors (exit 1)

| Code | Recovery hint |
|------|--------------|
| `ERR_INVALID_PARAMS` | Check command arguments and input requirements. |
| `ERR_NOT_INITIALIZED` | Run `aw init` to initialize. |
| `ERR_WALLET_NOT_FOUND` | Check wallet name with `aw wallet list`. |
| `ERR_INSUFFICIENT_FUNDS` | Top up wallet. Check balance with `aw wallet balance <name>`. |
| `ERR_DAILY_LIMIT_EXCEEDED` | Wait for daily reset (UTC midnight) or raise limit with `aw policy set`. |
| `ERR_PER_TX_LIMIT_EXCEEDED` | Reduce amount or raise per-tx limit with `aw policy set`. |
| `ERR_TX_COUNT_LIMIT_EXCEEDED` | Wait for daily reset or raise `max_tx_per_day`. |
| `ERR_APPROVAL_THRESHOLD_EXCEEDED` | Reduce amount below the approval threshold. |
| `ERR_TOKEN_NOT_ALLOWED` | Token not in allowlist. Update with `aw policy set`. |
| `ERR_ADDRESS_NOT_ALLOWED` | Address not in allowlist. Update with `aw policy set`. |

## Auth errors (exit 3)

| Code | Recovery hint |
|------|--------------|
| `ERR_NEED_UNLOCK` | Run `aw unlock` to start a session. |
| `ERR_AUTH_FAILED` | Check master password. Run `aw unlock` to retry. |
| `ERR_POLYMARKET_AUTH` | Set POLYMARKET_PRIVATE_KEY or check Polymarket credentials. |

## System errors (exit 2)

| Code | Recovery hint |
|------|--------------|
| `ERR_RPC_UNAVAILABLE` | Check network or set `AW_RPC_URL`. |
| `ERR_TX_FAILED` | Transaction reverted on-chain. Check params and retry. |
| `ERR_POLYMARKET_CLI_NOT_FOUND` | Install polymarket-cli and ensure it is in PATH. |
| `ERR_POLYMARKET_FAILED` | Polymarket CLI returned an error. Check logs. |
| `ERR_POLYMARKET_TIMEOUT` | Polymarket CLI timed out. Retry. |
| `ERR_INTERNAL` | Unexpected internal error. |

## JSON error envelope

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "ERR_INSUFFICIENT_FUNDS",
    "message": "Need 10 USDC, have 2.3",
    "details": {
      "required": "10",
      "available": "2.3",
      "token": "USDC"
    },
    "recovery_hint": "Top up wallet. Check balance with `aw wallet balance <name>`."
  },
  "meta": {
    "request_id": "req_xxx"
  }
}
```

### Fields

- `code` — machine-readable error code (see tables above)
- `message` — human-readable description (may change between versions, do not parse)
- `details` — optional structured context for the error
- `recovery_hint` — actionable next step for automated agents
