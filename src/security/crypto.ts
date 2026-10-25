import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const KEY_BYTES = 32;
const HKDF_SALT = Buffer.from('onebot-companion-v1');

export interface KeySet {
  master: Buffer;
  db: Buffer;
  field: Buffer;
  session: Buffer;
  fingerprint: string;
}

function parseKeyMaterial(raw: string): Buffer {
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  try {
    const buf = Buffer.from(value, 'base64');
    if (buf.length === KEY_BYTES) return buf;
  } catch {
    // fall through
  }
  // Allow a passphrase, but derive a proper 32-byte key from it.
  return crypto.scryptSync(value, 'onebot-companion-master', KEY_BYTES);
}

function hardenFile(file: string): void {
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows does not implement POSIX modes.
  }
  if (process.platform === 'win32') {
    try {
      const user = os.userInfo().username;
      execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${user}:F`], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      // Best effort; the file is still under the app data directory.
    }
  }
}

export function loadMasterKey(file: string): { key: Buffer; created: boolean } {
  const envKey = process.env.BOT_MASTER_KEY;
  if (envKey && envKey.trim()) {
    const key = parseKeyMaterial(envKey);
    if (key.length !== KEY_BYTES) throw new Error('BOT_MASTER_KEY 必须是 32 字节（base64/hex）');
    return { key, created: false };
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const key = parseKeyMaterial(raw);
    if (key.length !== KEY_BYTES) throw new Error(`主密钥文件损坏: ${file}`);
    hardenFile(file);
    return { key, created: false };
  }

  const key = crypto.randomBytes(KEY_BYTES);
  fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  hardenFile(file);
  return { key, created: true };
}

export function deriveKeys(master: Buffer): KeySet {
  const derive = (info: string) =>
    Buffer.from(crypto.hkdfSync('sha256', master, HKDF_SALT, Buffer.from(info), KEY_BYTES));
  return {
    master,
    db: derive('database'),
    field: derive('field-encryption'),
    session: derive('session-signing'),
    fingerprint: crypto.createHash('sha256').update(master).digest('hex').slice(0, 16),
  };
}

export function encryptField(plaintext: string, key: Buffer, aad = ''): string {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptField(payload: string, key: Buffer, aad = ''): string {
  if (!payload) return '';
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('无法识别的密文格式');
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ciphertext = Buffer.from(parts[3], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function sha256Hex(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function randomPassword(length = 20): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
