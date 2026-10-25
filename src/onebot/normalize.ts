import type { OneBotSegment } from './types.js';

function unescapeCQ(value: string): string {
  return value
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&#44;/g, ',')
    .replace(/&amp;/g, '&');
}

function parseCQParams(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx)] = unescapeCQ(part.slice(idx + 1));
  }
  return out;
}

export function parseCQString(message: string): OneBotSegment[] {
  const out: OneBotSegment[] = [];
  const regex = /\[CQ:([a-zA-Z0-9_.-]+)((?:,[^\]]*)?)\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(message))) {
    if (match.index > last) {
      out.push({ type: 'text', data: { text: unescapeCQ(message.slice(last, match.index)) } });
    }
    out.push({ type: match[1], data: parseCQParams(match[2] ?? '') });
    last = regex.lastIndex;
  }
  if (last < message.length) out.push({ type: 'text', data: { text: unescapeCQ(message.slice(last)) } });
  return out.length ? out : [{ type: 'text', data: { text: message } }];
}

export function normalizeSegments(message: OneBotSegment[] | string | undefined | null): OneBotSegment[] {
  if (!message) return [];
  if (typeof message === 'string') return parseCQString(message);
  return message.map((segment) => ({ type: segment.type, data: segment.data ?? {} }));
}

export function segmentsToPlainText(segments: OneBotSegment[], selfId = ''): string {
  const parts: string[] = [];
  for (const segment of segments) {
    switch (segment.type) {
      case 'text':
        parts.push(String(segment.data.text ?? ''));
        break;
      case 'at':
        parts.push(segment.data.qq === 'all' ? '@全体成员' : `@${segment.data.qq ?? ''}`);
        break;
      case 'image':
        parts.push(segment.data.summary ? `[图片:${segment.data.summary}]` : '[图片]');
        break;
      case 'face':
        parts.push('[表情]');
        break;
      case 'mface':
        parts.push(`[表情包${segment.data.summary ? `:${segment.data.summary}` : ''}]`);
        break;
      case 'record':
        parts.push('[语音]');
        break;
      case 'video':
        parts.push('[视频]');
        break;
      case 'file':
        parts.push(`[文件${segment.data.name ? `:${segment.data.name}` : ''}]`);
        break;
      case 'json':
        parts.push('[卡片]');
        break;
      case 'forward':
        parts.push('[聊天记录]');
        break;
      case 'reply':
        break;
      case 'poke':
        parts.push('[戳一戳]');
        break;
      default:
        break;
    }
  }
  return parts.join('').trim();
}

export function isMentioned(segments: OneBotSegment[], selfId: string, aliases: string[] = []): boolean {
  for (const segment of segments) {
    if (segment.type === 'at' && String(segment.data.qq) === String(selfId)) return true;
  }
  const text = segmentsToPlainText(segments);
  return aliases.some((alias) => alias && text.includes(alias));
}

export function isReplyToBot(segments: OneBotSegment[], botMessageIds: Set<string>): boolean {
  return segments.some((s) => s.type === 'reply' && botMessageIds.has(String(s.data.id ?? '')));
}

export function imageSegments(segments: OneBotSegment[]): OneBotSegment[] {
  return segments.filter((s) => s.type === 'image');
}

export function firstReplyId(segments: OneBotSegment[]): string | null {
  const reply = segments.find((s) => s.type === 'reply');
  return reply ? String(reply.data.id ?? '') : null;
}

export function segmentsToSendable(segments: OneBotSegment[]): any[] {
  return segments.map((s) => ({ type: s.type, data: s.data }));
}

export function buildTextSegment(text: string): OneBotSegment {
  return { type: 'text', data: { text } };
}

export function buildReplySegment(id: string): OneBotSegment {
  return { type: 'reply', data: { id } };
}

export function buildImageSegment(base64: string, name = 'image.png'): OneBotSegment {
  return { type: 'image', data: { file: `base64://${base64}`, name } };
}

export function buildRecordSegment(base64: string, name = 'voice.silk'): OneBotSegment {
  return { type: 'record', data: { file: `base64://${base64}`, name } };
}
