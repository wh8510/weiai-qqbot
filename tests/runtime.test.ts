import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { ChatRuntime } from '../src/chat/runtime.js';
import { buildContext } from '../src/chat/context.js';
import { makeStore, seedDemo } from './helpers.js';

function fakeGateway() {
  return {
    getStatus: () => ({ connected: false, mode: 'none', selfId: '999', nickname: '', lastEventAt: null, lastConnectedAt: null, lastError: '', eventCount: 0 }),
    sendSegments: async () => ({ message_id: 1 }),
  } as any;
}

const config = {
  timezone: 'Asia/Shanghai',
  dataDir: 'data-test',
  server: { host: '127.0.0.1', port: 0, publicUrl: '', trustProxy: false },
  security: {},
  onebot: {},
  demo: true,
} as any;

describe('chat runtime (demo model)', () => {
  it('generates a reply through the mock provider', async () => {
    const store = makeStore();
    seedDemo(store);
    const runtime = new ChatRuntime(store, fakeGateway(), config, new EventEmitter());
    const result = await runtime.debugChat({ text: '你好呀' });
    expect(result.bubbles.length).toBeGreaterThan(0);
    expect(result.bubbles.join('')).toContain('在');
    expect(result.costCny).toBe(0);
  });

  it('keeps persona/flavour for a tired message', async () => {
    const store = makeStore();
    seedDemo(store);
    const runtime = new ChatRuntime(store, fakeGateway(), config, new EventEmitter());
    const result = await runtime.debugChat({ text: '今天好累' });
    expect(result.bubbles.join(' ')).toMatch(/怎么了|加班/);
  });
});

describe('context builder capability paths', () => {
  it('tells a text-only model it cannot see images', () => {
    const store = makeStore();
    seedDemo(store);
    const session = store.getOrCreateSession('999', 'private', '10001');
    const persona = store.getActivePersona();
    const model = store.getModel('demo:demo-model')!;
    const built = buildContext({
      store,
      session,
      persona,
      capabilities: { vision: false, file: false, audio: false, video: false, json: true, tools: false, reasoning: false, streaming: false },
      model,
      incoming: [{ senderId: '10001', senderName: '你', text: '看看这个' }],
      images: [{ mimeType: 'image/png', dataBase64: 'aaaa' }],
      mentioned: true,
      replyToBot: false,
      timezone: 'Asia/Shanghai',
      platform: 'Linux',
      voiceAvailable: false,
      stickersAvailable: false,
    });
    expect(built.imagePath).toBe('no-vision');
    expect(built.system).toContain('不要声称自己看到了图片');
    const last = built.messages[built.messages.length - 1];
    expect(Array.isArray(last.content)).toBe(true);
    expect((last.content as any[]).some((p) => p.type === 'image')).toBe(false);
  });

  it('passes images directly when the model supports vision', () => {
    const store = makeStore();
    seedDemo(store);
    const session = store.getOrCreateSession('999', 'private', '10001');
    const built = buildContext({
      store,
      session,
      persona: store.getActivePersona(),
      capabilities: { vision: true, file: false, audio: false, video: false, json: true, tools: false, reasoning: false, streaming: false },
      model: store.getModel('demo:demo-model')!,
      incoming: [{ senderId: '10001', senderName: '你', text: '看看这个' }],
      images: [{ mimeType: 'image/png', dataBase64: 'aaaa' }],
      mentioned: true,
      replyToBot: false,
      timezone: 'Asia/Shanghai',
      platform: 'Windows',
      voiceAvailable: true,
      stickersAvailable: true,
    });
    expect(built.imagePath).toBe('direct');
    const last = built.messages[built.messages.length - 1];
    expect((last.content as any[]).some((p) => p.type === 'image')).toBe(true);
  });

  it('uses a vision fallback description instead of pretending', () => {
    const store = makeStore();
    seedDemo(store);
    const session = store.getOrCreateSession('999', 'private', '10001');
    const built = buildContext({
      store,
      session,
      persona: store.getActivePersona(),
      capabilities: { vision: false, file: false, audio: false, video: false, json: true, tools: false, reasoning: false, streaming: false },
      model: store.getModel('demo:demo-model')!,
      incoming: [{ senderId: '10001', senderName: '你', text: '看看这个' }],
      images: [{ mimeType: 'image/png', dataBase64: 'aaaa', description: '一只橘猫趴在键盘上' }],
      mentioned: true,
      replyToBot: false,
      timezone: 'Asia/Shanghai',
      platform: 'Windows',
      voiceAvailable: false,
      stickersAvailable: false,
    });
    expect(built.imagePath).toBe('vision-fallback');
    const last = built.messages[built.messages.length - 1];
    const text = (last.content as any[]).find((p) => p.type === 'text')?.text ?? '';
    expect(text).toContain('一只橘猫');
    expect(text).toContain('不要提及旁路模型');
  });
});
