import { describe, expect, it } from 'vitest';
import { isMentioned, normalizeSegments, parseCQString, segmentsToPlainText } from '../src/onebot/normalize.js';

describe('OneBot message normalization', () => {
  it('parses CQ strings', () => {
    const segments = parseCQString('[CQ:at,qq=123] 你好 [CQ:image,file=abc.jpg]');
    expect(segments[0]).toMatchObject({ type: 'at', data: { qq: '123' } });
    expect(segments.some((s) => s.type === 'image')).toBe(true);
  });

  it('normalizes arrays and renders plain text', () => {
    const segments = normalizeSegments([
      { type: 'text', data: { text: '看这个' } },
      { type: 'image', data: { summary: '猫猫' } },
      { type: 'face', data: { id: '1' } },
    ]);
    expect(segmentsToPlainText(segments)).toBe('看这个[图片:猫猫][表情]');
  });

  it('detects mention by at or alias', () => {
    expect(isMentioned([{ type: 'at', data: { qq: '999' } }], '999')).toBe(true);
    expect(isMentioned([{ type: 'text', data: { text: '小满在吗' } }], '999', ['小满'])).toBe(true);
    expect(isMentioned([{ type: 'text', data: { text: '大家好' } }], '999', ['小满'])).toBe(false);
  });
});
