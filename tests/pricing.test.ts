import { describe, expect, it } from 'vitest';
import { estimateCost, estimateTokens, isPeakNow } from '../src/models/pricing.js';
import { makeStore } from './helpers.js';

describe('pricing', () => {
  it('estimates mixed Chinese/English tokens', () => {
    expect(estimateTokens('你好世界')).toBe(4);
    expect(estimateTokens('hello world')).toBeGreaterThan(1);
  });

  it('computes native and CNY cost', () => {
    const store = makeStore();
    const result = estimateCost({
      store,
      pricing: { currency: 'USD', input: 2, output: 10 },
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    });
    expect(result.native).toBe(12);
    expect(result.cny).toBeCloseTo(86.4, 5);
    expect(result.estimated).toBe(false);
  });

  it('returns estimated when pricing is missing', () => {
    const store = makeStore();
    const result = estimateCost({ store, pricing: null, promptTokens: 100, completionTokens: 100 });
    expect(result.estimated).toBe(true);
    expect(result.cny).toBe(0);
  });

  it('detects a weekday peak window in Asia/Shanghai', () => {
    const peak = new Date('2026-10-26T02:00:00.000Z'); // 10:00 Beijing, Monday
    expect(isPeakNow('Asia/Shanghai', peak)).toBe(true);
    const off = new Date('2026-10-25T02:00:00.000Z'); // Sunday
    expect(isPeakNow('Asia/Shanghai', off)).toBe(false);
  });
});
