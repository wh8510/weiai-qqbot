import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { Store } from '../store.js';
import type { OneBotSegment } from '../onebot/types.js';
import { callRole } from '../models/gateway.js';

const MAX_BYTES = 12 * 1024 * 1024;

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
  }
  return true;
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) throw new Error('不允许访问本机地址');
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('不允许访问内网地址');
    return;
  }
  const records = await dns.lookup(hostname, { all: true });
  if (records.length === 0) throw new Error('域名解析失败');
  for (const record of records) {
    if (isPrivateIp(record.address)) throw new Error(`域名解析到内网地址: ${record.address}`);
  }
}

function mimeFromBuffer(buffer: Buffer, fallback = 'image/jpeg'): string {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return fallback;
}

function extensionFor(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

export async function downloadImage(url: string): Promise<{ buffer: Buffer; mime: string }> {
  let current = url;
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const parsed = new URL(current);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只允许 http/https 图片');
    await assertPublicHost(parsed.hostname);
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: { 'user-agent': 'OneBotCompanion/0.1' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('图片重定向缺少 Location');
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error(`图片下载失败: HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_BYTES) throw new Error('图片超过 12MB 限制');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error('图片超过 12MB 限制');
    const mime = response.headers.get('content-type')?.split(';')[0] || mimeFromBuffer(buffer);
    return { buffer, mime: mime.startsWith('image/') ? mime : mimeFromBuffer(buffer) };
  }
  throw new Error('图片重定向次数过多');
}

export async function saveImage(store: Store, buffer: Buffer, mime: string, kind = 'image'): Promise<{ id: string; sha256: string; path: string }> {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const ext = extensionFor(mime);
  const file = path.join(config.dataDir, 'media', `${sha256}.${ext}`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buffer);
  const id = store.upsertMedia({ sha256, path: file, mime, size: buffer.length, kind });
  return { id, sha256, path: file };
}

export async function segmentToImage(store: Store, segment: OneBotSegment): Promise<{ buffer: Buffer; mime: string; sha256: string } | null> {
  const data = segment.data ?? {};
  const source = String(data.url ?? data.file ?? '');
  try {
    if (source.startsWith('base64://')) {
      const buffer = Buffer.from(source.slice('base64://'.length), 'base64');
      return { buffer, mime: mimeFromBuffer(buffer), sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
    }
    if (/^https?:\/\//i.test(source)) {
      const { buffer, mime } = await downloadImage(source);
      const saved = await saveImage(store, buffer, mime);
      return { buffer, mime, sha256: saved.sha256 };
    }
    // Never read arbitrary local paths from a remote event.
    return null;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, '图片处理失败');
    return null;
  }
}

export async function describeImage(input: {
  store: Store;
  buffer: Buffer;
  mime: string;
  sha256: string;
  timezone: string;
  sessionId: string;
  hint?: string;
}): Promise<{ description: string; costCny: number } | null> {
  const cached = input.store.getMediaDescription(input.sha256);
  if (cached) return { description: cached, costCny: 0 };

  const base64 = input.buffer.toString('base64');
  const messages: any[] = [
    {
      role: 'system',
      content:
        '你是图像理解模块。用中文简洁描述图片：画面主体、文字、情绪/梗。不要编造，不要评价用户。最多 120 字。',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: input.hint || '描述这张图片，供聊天对象理解。' },
        { type: 'image', mimeType: input.mime, dataBase64: base64 },
      ],
    },
  ];

  try {
    const result = await callRole(input.store, 'vision', messages, {
      sessionId: input.sessionId,
      purpose: 'vision',
      maxTokens: 220,
      temperature: 0.2,
      capabilityPath: 'vision-fallback',
    }, input.timezone);
    const description = result.text.trim().slice(0, 500);
    if (description) input.store.setMediaDescription(input.sha256, description);
    return { description, costCny: result.costCny };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, '视觉旁路失败');
    return null;
  }
}
