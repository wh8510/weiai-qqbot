import fs from 'node:fs';
import YAML from 'yaml';
import type { ModelPreset, ProviderPreset, Store } from '../store.js';

export interface CatalogFile {
  version: number;
  verifiedAt?: string;
  providers: ProviderPreset[];
}

export interface Capabilities {
  vision: boolean;
  file: boolean;
  audio: boolean;
  video: boolean;
  json: boolean;
  tools: boolean;
  reasoning: boolean;
  streaming: boolean;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function loadCatalog(file: string): CatalogFile {
  if (!fs.existsSync(file)) {
    return { version: 1, providers: [] };
  }
  const doc = YAML.parse(fs.readFileSync(file, 'utf8')) as CatalogFile;
  if (!doc || !Array.isArray(doc.providers)) throw new Error(`模型目录格式错误: ${file}`);
  return doc;
}

export function seedCatalog(store: Store, file: string, demo: boolean): CatalogFile {
  const catalog = loadCatalog(file);
  const tx = store.db.transaction(() => {
    for (const provider of catalog.providers) {
      if (!provider.id || !provider.name || !provider.kind || !provider.baseUrl) continue;
      store.upsertProviderPreset(provider);
      for (const model of provider.models ?? []) {
        if (!model.id) continue;
        store.upsertModelPreset(provider.id, model);
      }
    }

    // Default role bindings: one cheap, vision-capable model does everything
    // until the user deliberately assigns other roles.
    const defaultRef = demo ? 'demo:demo-model' : 'deepseek:deepseek-flash';
    const existing = store.getRoleBindings();
    if (existing.length === 0) {
      for (const role of ['chat', 'vision', 'memory', 'classifier'] as const) {
        store.setRoleBinding(role, defaultRef);
      }
      store.setRoleBinding('embedding', null);
    }

    if (demo) {
      const provider = store.getProvider('demo');
      if (provider) store.setProviderEnabled('demo', true);
    }
  });
  tx();
  return catalog;
}

export function modelCapabilities(model: any): Capabilities {
  const input = new Set<string>(parseJson(model.input_json, ['text']));
  const features = new Set<string>(parseJson(model.features_json, []));
  const probe = parseJson<Record<string, any>>(model.probe_json, {});
  const override = parseJson<Record<string, any>>(model.capabilities_override_json, {});

  const base: Capabilities = {
    vision: input.has('image'),
    file: input.has('file'),
    audio: input.has('audio'),
    video: input.has('video'),
    json: features.has('json'),
    tools: features.has('tools'),
    reasoning: features.has('reasoning'),
    streaming: features.has('streaming'),
  };

  for (const key of Object.keys(base) as Array<keyof Capabilities>) {
    if (typeof probe[key] === 'boolean') base[key] = probe[key];
    if (typeof override[key] === 'boolean') base[key] = override[key];
  }
  return base;
}

export function modelLabel(model: any): string {
  return model?.display_name || model?.model_id || 'unknown';
}

export function modelRef(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

export function parseModelRef(ref: string | null | undefined): { providerId: string; modelId: string } | null {
  if (!ref) return null;
  const idx = ref.indexOf(':');
  if (idx <= 0) return null;
  return { providerId: ref.slice(0, idx), modelId: ref.slice(idx + 1) };
}

export function findModelByRef(store: Store, ref: string | null | undefined): any | null {
  const parsed = parseModelRef(ref);
  if (!parsed) return null;
  return store.getModel(`${parsed.providerId}:${parsed.modelId}`) ?? null;
}

export function inputModalities(model: any): string[] {
  return parseJson(model.input_json, ['text']);
}

export function featureList(model: any): string[] {
  return parseJson(model.features_json, []);
}

export function catalogSummary(store: Store): any[] {
  return store.listProviders().map((p) => ({
    ...p,
    api_key_enc: undefined,
    hasKey: Boolean(p.api_key_enc),
    models: store.listModels(p.id).map((m) => ({
      ...m,
      capabilities: modelCapabilities(m),
      input: inputModalities(m),
      features: featureList(m),
      pricing: parseJson(m.pricing_json, null),
    })),
  }));
}
