import { randomBetween } from '../util/time.js';

export interface ReplyPlan {
  silent: boolean;
  bubbles: string[];
  sticker: string;
  quote: boolean;
  voice: boolean;
  mood: string;
}

const DEFAULT_PLAN: ReplyPlan = {
  silent: false,
  bubbles: [],
  sticker: '',
  quote: false,
  voice: false,
  mood: 'neutral',
};

function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractJson(text: string): any | null {
  const cleaned = stripFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function cleanBubble(input: string): string {
  let text = String(input ?? '');
  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+[.)]\s+/gm, '');
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/^["“]|["”]$/g, '');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

export function splitLongBubble(text: string, max = 80): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const slice = rest.slice(0, max);
    const idx = Math.max(
      slice.lastIndexOf('。'),
      slice.lastIndexOf('！'),
      slice.lastIndexOf('？'),
      slice.lastIndexOf('，'),
      slice.lastIndexOf(' '),
    );
    const cut = idx > max * 0.4 ? idx + 1 : max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

export function normalizePlan(raw: string): ReplyPlan {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') {
    const fallback = cleanBubble(raw);
    return { ...DEFAULT_PLAN, bubbles: fallback ? splitLongBubble(fallback).slice(0, 4) : [] };
  }

  if (parsed.silent === true) return { ...DEFAULT_PLAN, silent: true };
  const source = Array.isArray(parsed.bubbles)
    ? parsed.bubbles
    : typeof parsed.bubbles === 'string'
      ? [parsed.bubbles]
      : typeof parsed.text === 'string'
        ? [parsed.text]
        : [];
  const bubbles: string[] = [];
  for (const item of source) {
    const text = cleanBubble(typeof item === 'string' ? item : item?.text ?? '');
    if (!text) continue;
    for (const piece of splitLongBubble(text)) {
      if (bubbles.length >= 4) break;
      if (piece) bubbles.push(piece);
    }
    if (bubbles.length >= 4) break;
  }

  return {
    silent: false,
    bubbles,
    sticker: typeof parsed.sticker === 'string' ? parsed.sticker.trim().slice(0, 20) : '',
    quote: parsed.quote === true,
    voice: parsed.voice === true,
    mood: typeof parsed.mood === 'string' ? parsed.mood.slice(0, 20) : 'neutral',
  };
}

export interface TimedBubble {
  text: string;
  delayMs: number;
}

export function timeBubbles(bubbles: string[]): TimedBubble[] {
  let cursor = randomBetween(700, 2400);
  const out: TimedBubble[] = [];
  for (const text of bubbles) {
    const typing = Math.min(4500, 500 + text.length * 55) + randomBetween(0, 500);
    cursor += typing;
    out.push({ text, delayMs: Math.round(cursor) });
    cursor += randomBetween(250, 900);
  }
  return out;
}
