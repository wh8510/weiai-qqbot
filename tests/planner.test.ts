import { describe, expect, it } from 'vitest';
import { cleanBubble, normalizePlan, splitLongBubble } from '../src/chat/planner.js';

describe('reply planner', () => {
  it('parses a normal JSON plan', () => {
    const plan = normalizePlan('{"silent":false,"bubbles":["在呢","怎么啦"],"sticker":"开心","quote":true}');
    expect(plan.silent).toBe(false);
    expect(plan.bubbles).toEqual(['在呢', '怎么啦']);
    expect(plan.sticker).toBe('开心');
    expect(plan.quote).toBe(true);
  });

  it('handles fenced JSON', () => {
    const plan = normalizePlan('```json\n{"bubbles":["嗯"]}\n```');
    expect(plan.bubbles).toEqual(['嗯']);
  });

  it('turns plain text into a bubble', () => {
    const plan = normalizePlan('**今天** 有点累');
    expect(plan.bubbles[0]).toBe('今天 有点累');
  });

  it('honours silent', () => {
    expect(normalizePlan('{"silent":true,"bubbles":["x"]}').silent).toBe(true);
  });

  it('strips markdown and list prefixes', () => {
    expect(cleanBubble('## 标题\n- 第一点\n- 第二点')).toBe('标题 第一点 第二点');
  });

  it('splits long bubbles at punctuation', () => {
    const parts = splitLongBubble('这是一段很长的话，'.repeat(10), 30);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 31)).toBe(true);
  });

  it('caps at four bubbles', () => {
    const plan = normalizePlan('{"bubbles":["1","2","3","4","5","6"]}');
    expect(plan.bubbles).toHaveLength(4);
  });
});
