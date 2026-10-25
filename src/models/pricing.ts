import type { Store } from '../store.js';

export interface Pricing {
  currency?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  image?: number;
  peak?: Pricing;
}

export interface CostResult {
  native: number;
  cny: number;
  currency: string;
  pricing: Pricing | null;
  estimated: boolean;
}

export function parsePricing(raw: string | null | undefined): Pricing | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Pricing;
  } catch {
    return null;
  }
}

export function isPeakNow(timezone = 'Asia/Shanghai', date = new Date()): boolean {
  // DeepSeek uses Beijing time, weekdays 09:00-12:00 and 14:00-18:00,
  // excluding Chinese public holidays. Holidays are intentionally not
  // hardcoded; the catalog can override the pricing if accuracy matters.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const minutes = hour * 60 + minute;
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60);
}

export function activePricing(pricing: Pricing | null, timezone = 'Asia/Shanghai', date = new Date()): Pricing | null {
  if (!pricing) return null;
  if (pricing.peak && isPeakNow(timezone, date)) return { ...pricing, ...pricing.peak, peak: undefined };
  return pricing;
}

export function fxToCny(store: Store, currency: string): number {
  if (!currency || currency === 'CNY') return 1;
  if (currency === 'USD') return store.getSettingInt('fx.usd_cny', 720) / 100;
  return Number(store.getSetting(`fx.${currency.toLowerCase()}_cny`, '1')) || 1;
}

export function estimateCost(input: {
  store: Store;
  pricing: Pricing | null;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  imageTokens?: number;
  timezone?: string;
  at?: Date;
}): CostResult {
  const pricing = activePricing(input.pricing, input.timezone, input.at);
  if (!pricing) {
    return { native: 0, cny: 0, currency: 'CNY', pricing: null, estimated: true };
  }
  const currency = pricing.currency ?? 'CNY';
  const cached = Math.min(input.cachedTokens ?? 0, input.promptTokens);
  const uncached = Math.max(0, input.promptTokens - cached);
  const perMillion =
    (uncached / 1_000_000) * (pricing.input ?? 0) +
    (cached / 1_000_000) * (pricing.cacheRead ?? pricing.input ?? 0) +
    (input.completionTokens / 1_000_000) * (pricing.output ?? 0);
  const native = round6(perMillion);
  return {
    native,
    cny: round6(native * fxToCny(input.store, currency)),
    currency,
    pricing,
    estimated: false,
  };
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Mixed Chinese/English estimate: CJK chars ~1 token each, Latin ~4 chars/token.
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.max(1, Math.ceil(cjk + other / 4));
}

export function estimateMessagesTokens(messages: Array<{ content: any }>): number {
  let total = 0;
  for (const message of messages) {
    if (typeof message.content === 'string') total += estimateTokens(message.content);
    else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part?.type === 'text') total += estimateTokens(part.text ?? '');
        else if (part?.type === 'image_url' || part?.type === 'image') total += 1024;
      }
    }
    total += 4;
  }
  return total;
}

export function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function formatCost(cost: number, currency = 'CNY'): string {
  const symbol = currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : `${currency} `;
  return `${symbol}${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
}
