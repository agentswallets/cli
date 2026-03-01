import { describe, expect, it, vi } from 'vitest';
import { redactSecrets } from '../src/util/redact.js';

describe('no-key-leak: redactSecrets coverage', () => {
  it('redacts private_key field value in JSON', () => {
    const key = '0x' + 'a'.repeat(64);
    const json = JSON.stringify({ private_key: key });
    const redacted = redactSecrets(json);
    expect(redacted).not.toContain(key);
    expect(redacted).toContain('[REDACTED]');
  });

  it('redacts secret field value in JSON', () => {
    const json = JSON.stringify({ secret: 'super_secret_value_123' });
    const redacted = redactSecrets(json);
    expect(redacted).not.toContain('super_secret_value_123');
    expect(redacted).toContain('[REDACTED]');
  });

  it('redacts mnemonic field value in JSON', () => {
    const json = JSON.stringify({ mnemonic: 'abandon abandon abandon' });
    const redacted = redactSecrets(json);
    expect(redacted).not.toContain('abandon abandon abandon');
    expect(redacted).toContain('[REDACTED]');
  });

  it('redacts passphrase field value in JSON', () => {
    const json = JSON.stringify({ passphrase: 'my_pass' });
    const redacted = redactSecrets(json);
    expect(redacted).not.toContain('my_pass');
    expect(redacted).toContain('[REDACTED]');
  });

  it('redacts seed field value in JSON', () => {
    const json = JSON.stringify({ seed: 'abc123seed' });
    const redacted = redactSecrets(json);
    expect(redacted).not.toContain('abc123seed');
    expect(redacted).toContain('[REDACTED]');
  });

  it('redacts PRIVATE_KEY=... pattern', () => {
    const text = 'PRIVATE_KEY=0xdeadbeef1234567890';
    const redacted = redactSecrets(text);
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).not.toContain('0xdeadbeef1234567890');
  });

  it('redacts POLYMARKET_PRIVATE_KEY=... pattern', () => {
    const text = 'POLYMARKET_PRIVATE_KEY="somesecretvalue"';
    const redacted = redactSecrets(text);
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).not.toContain('somesecretvalue');
  });

  it('does NOT redact tx_hash (not a sensitive field)', () => {
    const hash = '0x' + 'ab'.repeat(32);
    const json = JSON.stringify({ tx_hash: hash, status: 'confirmed' });
    const redacted = redactSecrets(json);
    expect(redacted).toContain(hash);
  });

  it('does NOT redact entry_hash / prev_hash (audit log fields)', () => {
    const entryHash = 'c'.repeat(64);
    const prevHash = 'd'.repeat(64);
    const json = JSON.stringify({ entry_hash: entryHash, prev_hash: prevHash });
    const redacted = redactSecrets(json);
    expect(redacted).toContain(entryHash);
    expect(redacted).toContain(prevHash);
  });

  it('does NOT redact conditionId (Polymarket field)', () => {
    const conditionId = '0x' + 'ef'.repeat(32);
    const json = JSON.stringify({ conditionId, question: 'Will X happen?' });
    const redacted = redactSecrets(json);
    expect(redacted).toContain(conditionId);
  });

  it('does NOT redact order_id (Polymarket field)', () => {
    const orderId = 'a1b2c3'.repeat(10) + 'a1b2';
    const json = JSON.stringify({ order_id: orderId });
    const redacted = redactSecrets(json);
    expect(redacted).toContain(orderId);
  });

  it('does not redact short hex strings', () => {
    const shortHex = '0x1234abcd';
    expect(redactSecrets(shortHex)).toBe(shortHex);
  });

  it('redacts private_key embedded in JSON while preserving address', () => {
    const key = '0x' + 'ff'.repeat(32);
    const json = JSON.stringify({ private_key: key, address: '0x1234' });
    const redacted = redactSecrets(json);
    expect(redacted).not.toContain(key);
    expect(redacted).toContain('[REDACTED]');
    // address should survive
    expect(redacted).toContain('0x1234');
  });
});

describe('no-key-leak: audit log redaction', () => {
  it('request_json is redacted when containing private_key field', () => {
    const key = '0x' + 'ab'.repeat(32);
    const request = { walletId: 'w_1', private_key: key };
    const requestJson = redactSecrets(JSON.stringify(request));
    expect(requestJson).not.toContain(key);
    expect(requestJson).toContain('[REDACTED]');
  });

  it('result_json is redacted when containing private_key field', () => {
    const key = '0x' + 'cd'.repeat(32);
    const result = { private_key: key, address: '0x999' };
    const resultJson = redactSecrets(JSON.stringify(result));
    expect(resultJson).not.toContain(key);
    expect(resultJson).toContain('[REDACTED]');
  });
});

describe('no-key-leak: walletExportKeyCommand return value redaction', () => {
  it('redactSecrets catches the private_key field if serialized', () => {
    const key = '0x' + 'ee'.repeat(32);
    const returnValue = {
      name: 'w_test',
      address: '0xabc',
      private_key: key,
      warning: 'Do not log'
    };
    const serialized = JSON.stringify(returnValue);
    const redacted = redactSecrets(serialized);
    expect(redacted).not.toContain(key);
    expect(redacted).toContain('[REDACTED]');
    // Other fields should survive
    expect(redacted).toContain('w_test');
    expect(redacted).toContain('Do not log');
  });
});
