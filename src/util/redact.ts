export function summarize(text: string, max = 500): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

/** Redact path segments and query params that look like API keys in URLs.
 *  Handles comma-separated multi-RPC strings (e.g. "url1,url2,url3"). */
export function redactUrl(url: string): string {
  // Handle comma-separated URLs (common for multi-RPC configs).
  // Only split on commas followed by http(s) to avoid breaking query params with commas.
  if (/,https?:\/\//.test(url)) {
    return url.split(/,(?=https?:\/\/)/).map(u => redactUrl(u.trim())).join(',');
  }
  try {
    const u = new URL(url);
    // Redact path segments that look like API keys (e.g. /v2/<hex-or-alnum-key>)
    u.pathname = u.pathname.replace(
      /\/v\d+\/[a-zA-Z0-9_-]{8,}$/,
      (match) => match.replace(/\/[^/]+$/, '/***')
    );
    // Redact common API key query params
    for (const key of u.searchParams.keys()) {
      if (/^(api[_-]?key|key|token|secret|auth)$/i.test(key)) {
        u.searchParams.set(key, '***');
      }
    }
    return u.toString();
  } catch {
    // Not a valid URL — fall back to regex redaction
    return url.replace(/\/v\d+\/[a-zA-Z0-9_-]{8,}/g, (m) => m.replace(/\/[^/]+$/, '/***'));
  }
}

/** Sensitive JSON field names — values of these keys are redacted. */
const SENSITIVE_FIELD_RE = /(?:private_key|secret|passphrase|mnemonic|seed)/i;

/** Match standalone hex private keys: 0x + 64 hex chars NOT inside a JSON key-value context.
 *  We only redact these when preceded by a sensitive field name to avoid false positives
 *  on tx hashes, conditionIds, and other 0x-prefixed 32-byte values. */
const HEX_PRIVKEY_IN_CONTEXT_RE = /(private.key|secret|mnemonic|seed)\s*[:=]\s*["']?(0x[a-fA-F0-9]{64})["']?/gi;

export function redactSecrets(text: string): string {
  return text
    // Context-aware: redact values of sensitive JSON fields (e.g. "private_key":"0xabc...")
    .replace(/"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g, (match, key: string, _value: string) => {
      if (SENSITIVE_FIELD_RE.test(key)) {
        return `"${key}":"[REDACTED]"`;
      }
      return match;
    })
    // Env var assignment pattern: PRIVATE_KEY=xxx / POLYMARKET_PRIVATE_KEY=xxx
    .replace(/(PRIVATE_KEY|POLYMARKET_PRIVATE_KEY)\s*[:=]\s*["']?[^"'\s]+["']?/gi, '$1=[REDACTED]')
    // Hex private keys in context (e.g. private_key=0x... or secret: 0x...)
    .replace(HEX_PRIVKEY_IN_CONTEXT_RE, '$1=[REDACTED]')
    // URL redaction (API keys in path/query)
    .replace(/https?:\/\/[^\s"']+/g, (url) => redactUrl(url));
}

export function safeSummary(text: string, max = 500): string {
  return summarize(redactSecrets(text), max);
}
