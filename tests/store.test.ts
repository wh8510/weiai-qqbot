import { describe, expect, it } from 'vitest';
import { makeStore } from './helpers.js';
import { modelCapabilities } from '../src/models/catalog.js';

describe('store encryption and sessions', () => {
  it('encrypts messages at rest and decrypts them for the app', () => {
    const store = makeStore();
    const session = store.getOrCreateSession('999', 'private', '10001');
    const id = store.addMessage({
      sessionId: session.id,
      accountId: '999',
      direction: 'in',
      senderId: '10001',
      senderName: '测试',
      text: '我喜欢橘猫',
      segments: [{ type: 'text', data: { text: '我喜欢橘猫' } }],
    });
    const raw = store.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as any;
    expect(raw.text_enc).not.toContain('橘猫');
    expect(raw.segments_enc).not.toContain('橘猫');
    const messages = store.listMessages(session.id);
    expect(messages[0].text).toBe('我喜欢橘猫');
  });

  it('encrypts provider API keys and never returns them in catalog summaries', () => {
    const store = makeStore();
    store.upsertProviderPreset({ id: 'p', name: 'P', kind: 'openai', baseUrl: 'https://x.test/v1', models: [] });
    store.setProviderKey('p', 'sk-secret');
    expect(store.getProvider('p')?.api_key_enc).not.toContain('sk-secret');
    expect(store.getProviderApiKey('p')).toBe('sk-secret');
  });

  it('deduplicates facts by normalized hash', () => {
    const store = makeStore();
    const session = store.getOrCreateSession('999', 'private', '10001');
    store.upsertFact({ sessionId: session.id, subject: '用户', predicate: '喜欢', object: '猫' });
    store.upsertFact({ sessionId: session.id, subject: '用户', predicate: '喜欢', object: '猫' });
    expect(store.listFacts(session.id)).toHaveLength(1);
  });

  it('resolves capabilities from catalog and probe overrides', () => {
    const store = makeStore();
    store.upsertProviderPreset({ id: 'p', name: 'P', kind: 'openai', baseUrl: 'https://x.test/v1', models: [] });
    store.upsertModelPreset('p', { id: 'vision', input: ['text', 'image'], features: ['json'] });
    const model = store.getModel('p:vision')!;
    expect(modelCapabilities(model).vision).toBe(true);
    store.saveProbe(model.id, { vision: false });
    expect(modelCapabilities(store.getModel(model.id)!).vision).toBe(false);
    store.setCapabilitiesOverride(model.id, { vision: true });
    expect(modelCapabilities(store.getModel(model.id)!).vision).toBe(true);
  });

  it('tracks budget reservations atomically', () => {
    const store = makeStore();
    expect(store.reserveBudget({ date: '2026-10-25', scope: 'global', key: 'all', cost: 1, tokens: 100, capCost: 2, capTokens: 1000 })).toBe(true);
    expect(store.reserveBudget({ date: '2026-10-25', scope: 'global', key: 'all', cost: 2, tokens: 100, capCost: 2, capTokens: 1000 })).toBe(false);
    store.releaseBudget('2026-10-25', 'global', 'all', 1, 100);
    expect(store.todayBudget('2026-10-25').cost).toBe(0);
  });
});
