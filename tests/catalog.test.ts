import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { loadCatalog, modelCapabilities } from '../src/models/catalog.js';
import { makeStore } from './helpers.js';

describe('bundled model catalog', () => {
  it('parses the YAML and contains current DeepSeek entries', () => {
    const catalog = loadCatalog(path.resolve('catalog/providers.yaml'));
    expect(catalog.providers.length).toBeGreaterThan(5);
    const deepseek = catalog.providers.find((p) => p.id === 'deepseek');
    expect(deepseek).toBeTruthy();
    const flash = deepseek!.models?.find((m) => m.id === 'deepseek-flash');
    expect(flash?.input).toContain('image');
    const pro = deepseek!.models?.find((m) => m.id === 'deepseek-v4-pro');
    expect(pro?.input).not.toContain('image');
  });

  it('resolves catalog-declared vision before a probe exists', () => {
    const store = makeStore();
    store.upsertProviderPreset({ id: 'p', name: 'P', kind: 'openai', baseUrl: 'https://x.test/v1', models: [] });
    store.upsertModelPreset('p', { id: 'm', input: ['text', 'image'], features: ['json', 'tools'] });
    const caps = modelCapabilities(store.getModel('p:m')!);
    expect(caps.vision).toBe(true);
    expect(caps.json).toBe(true);
    expect(caps.tools).toBe(true);
  });
});
