import Database from 'better-sqlite3';
import { migrate } from '../src/db/migrations.js';
import { deriveKeys } from '../src/security/crypto.js';
import { Store } from '../src/store.js';

export function makeStore(): Store {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  const keys = deriveKeys(Buffer.alloc(32, 7));
  return new Store(db, keys);
}

export function seedDemo(store: Store): void {
  store.upsertProviderPreset({
    id: 'demo',
    name: 'Demo',
    kind: 'mock',
    baseUrl: 'mock://demo',
    models: [],
  });
  store.setProviderEnabled('demo', true);
  store.setProviderKey('demo', 'demo');
  store.upsertModelPreset('demo', {
    id: 'demo-model',
    name: 'Demo Model',
    context: 32768,
    maxOutput: 1024,
    input: ['text', 'image'],
    features: ['json'],
    pricing: { currency: 'CNY', input: 0, output: 0 },
  });
  for (const role of ['chat', 'vision', 'memory', 'classifier'] as const) {
    store.setRoleBinding(role, 'demo:demo-model');
  }
  const personaId = store.createPersona({
    name: '小满',
    systemPrompt: '你是一个普通的网友，说话短、口语化。只输出 JSON 回复计划。',
    noVisionLines: '我看不到图，你跟我说说。',
    styleExamples: '对方：在吗\n你：在',
  });
  store.setSetting('active_persona_id', personaId);
}
