import fs from 'node:fs';
import path from 'node:path';
import type { ModelRow, ProviderRow, Store } from '../store.js';
import { config } from '../config.js';
import { chat, ProviderError } from './provider.js';
import { featureList } from './catalog.js';
import { estimateCost, parsePricing } from './pricing.js';

export interface ProbeResult {
  text: boolean;
  json: boolean | null;
  vision: boolean | null;
  tools: boolean | null;
  at: number;
  latencyMs: number;
  errors: string[];
}

function testImage(): { mimeType: string; dataBase64: string } | null {
  const file = path.join(config.assetsDir, 'vision-probe.png');
  if (!fs.existsSync(file)) return null;
  return { mimeType: 'image/png', dataBase64: fs.readFileSync(file).toString('base64') };
}

function saysA7(text: string): boolean {
  return text.replace(/[\s,，。.!！:：]/g, '').toUpperCase().includes('A7');
}

export async function probeModel(input: {
  store: Store;
  provider: ProviderRow;
  model: ModelRow;
  apiKey: string;
}): Promise<ProbeResult> {
  const { store, provider, model, apiKey } = input;
  const started = Date.now();
  const errors: string[] = [];
  const result: ProbeResult = {
    text: false,
    json: null,
    vision: null,
    tools: null,
    at: Date.now(),
    latencyMs: 0,
    errors,
  };

  const call = async (messages: any[], extra: { json?: boolean; maxTokens?: number; purpose: string; timeoutMs?: number }) => {
    return chat({
      provider,
      model,
      apiKey,
      messages,
      json: extra.json,
      temperature: 0,
      maxTokens: extra.maxTokens ?? 24,
      purpose: extra.purpose,
      timeoutMs: extra.timeoutMs ?? 45_000,
    });
  };

  try {
    const text = await call(
      [
        { role: 'system', content: 'You are a connectivity probe. Follow the instruction exactly.' },
        { role: 'user', content: 'Reply with exactly: OK' },
      ],
      { purpose: 'probe-text', maxTokens: 8 },
    );
    result.text = text.text.toUpperCase().includes('OK');
    if (!result.text) errors.push(`文本探测返回: ${text.text.slice(0, 80)}`);
  } catch (err) {
    errors.push(`文本: ${(err as Error).message}`);
    if (err instanceof ProviderError && [401, 403, 404].includes(err.status)) {
      result.latencyMs = Date.now() - started;
      store.saveProbe(model.id, result);
      return result;
    }
  }

  if (featureList(model).includes('json')) {
    try {
      const json = await call(
        [
          { role: 'system', content: 'Return only a JSON object. No markdown.' },
          { role: 'user', content: 'Return exactly {"ok":true}' },
        ],
        { purpose: 'probe-json', json: true, maxTokens: 30 },
      );
      const parsed = JSON.parse(json.text.trim());
      result.json = parsed?.ok === true;
      if (!result.json) errors.push(`JSON 探测返回: ${json.text.slice(0, 80)}`);
    } catch (err) {
      result.json = false;
      errors.push(`JSON: ${(err as Error).message}`);
    }
  } else {
    result.json = false;
  }

  const image = testImage();
  if (image) {
    try {
      const vision = await call(
        [
          {
            role: 'system',
            content: 'You are a vision probe. Look at the image and answer with only the two characters shown at the bottom.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: '图里底部的两个字符是什么？只回答这两个字符。' },
              { type: 'image', mimeType: image.mimeType, dataBase64: image.dataBase64 },
            ],
          },
        ],
        { purpose: 'probe-vision', maxTokens: 256, timeoutMs: 60_000 },
      );
      result.vision = saysA7(vision.text);
      if (!result.vision) errors.push(`视觉探测返回: ${vision.text.slice(0, 80)}`);
    } catch (err) {
      if (err instanceof ProviderError && [400, 404, 415, 422].includes(err.status)) {
        result.vision = false;
      } else {
        result.vision = null;
        errors.push(`视觉: ${(err as Error).message}`);
      }
    }
  }

  result.latencyMs = Date.now() - started;
  store.saveProbe(model.id, result);
  return result;
}

export function probeSummary(model: ModelRow): any {
  if (!model.probe_json) return null;
  try {
    return JSON.parse(model.probe_json);
  } catch {
    return null;
  }
}
