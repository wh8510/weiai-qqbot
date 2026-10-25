import { describe, expect, it } from 'vitest';
import { decryptField, deriveKeys, encryptField, randomPassword, safeEqual } from '../src/security/crypto.js';

const keys = deriveKeys(Buffer.alloc(32, 3));

describe('field encryption', () => {
  it('round-trips with AAD', () => {
    const cipher = encryptField('sk-secret-123', keys.field, 'providers:x:api_key');
    expect(cipher).not.toContain('sk-secret');
    expect(decryptField(cipher, keys.field, 'providers:x:api_key')).toBe('sk-secret-123');
  });

  it('rejects a different AAD', () => {
    const cipher = encryptField('hello', keys.field, 'a');
    expect(() => decryptField(cipher, keys.field, 'b')).toThrow();
  });

  it('rejects a tampered ciphertext', () => {
    const cipher = encryptField('hello', keys.field, 'a');
    const parts = cipher.split('.');
    parts[3] = `${parts[3].slice(0, -2)}xx`;
    expect(() => decryptField(parts.join('.'), keys.field, 'a')).toThrow();
  });
});

describe('misc crypto', () => {
  it('generates distinct passwords with reasonable length', () => {
    const a = randomPassword(20);
    const b = randomPassword(20);
    expect(a).toHaveLength(20);
    expect(a).not.toBe(b);
    expect(safeEqual(a, a)).toBe(true);
    expect(safeEqual(a, b)).toBe(false);
  });
});
