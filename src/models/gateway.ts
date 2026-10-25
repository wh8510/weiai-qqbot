import type { ModelRole, ModelRow, ProviderRow, Store } from '../store.js';
import { modelCapabilities, parseModelRef } from './catalog.js';
import { chat, ProviderError, type ChatMessage, type ChatResponse } from './provider.js';
import { estimateCost, estimateMessagesTokens, parsePricing } from './pricing.js';
import { logger } from '../logger.js';

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export class NoModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoModelError';
  }
}

export interface ResolvedModel {
  ref: string;
  provider: ProviderRow;
  model: ModelRow;
  apiKey: string;
  capabilities: ReturnType<typeof modelCapabilities>;
}

export interface CallOptions {
  sessionId?: string | null;
  purpose: string;
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  allowBudgetOverride?: boolean;
  capabilityPath?: string;
}

export interface CallResult {
  text: string;
  usage: ChatResponse['usage'];
  latencyMs: number;
  model: ModelRow;
  provider: ProviderRow;
  ref: string;
  costCny: number;
  costNative: number;
  currency: string;
  capabilities: ReturnType<typeof modelCapabilities>;
}

export function dateKey(timezone: string, date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function resolveModelRef(store: Store, ref: string | null | undefined): ResolvedModel | null {
  const parsed = parseModelRef(ref);
  if (!parsed) return null;
  const provider = store.getProvider(parsed.providerId);
  if (!provider || !provider.enabled) return null;
  const model = store.getModel(`${parsed.providerId}:${parsed.modelId}`);
  if (!model || model.status === 'deprecated') return null;
  const apiKey = provider.kind === 'mock' ? 'mock' : store.getProviderApiKey(provider.id);
  if (provider.kind !== 'mock' && !apiKey) return null;
  return {
    ref: `${provider.id}:${model.model_id}`,
    provider,
    model,
    apiKey,
    capabilities: modelCapabilities(model),
  };
}

export function resolveRoleCandidates(store: Store, role: ModelRole): ResolvedModel[] {
  const binding = store.getRoleBinding(role);
  if (!binding) return [];
  const refs = [binding.model_ref, ...(JSON.parse(binding.fallback_refs_json || '[]') as string[])].filter(Boolean) as string[];
  const out: ResolvedModel[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const resolved = resolveModelRef(store, ref);
    if (resolved) out.push(resolved);
  }
  return out;
}

export function resolveRole(store: Store, role: ModelRole): ResolvedModel | null {
  return resolveRoleCandidates(store, role)[0] ?? null;
}

export function describeMissingModel(store: Store, role: ModelRole): string {
  const binding = store.getRoleBinding(role);
  if (!binding?.model_ref) return `尚未为「${role}」绑定模型`;
  const parsed = parseModelRef(binding.model_ref);
  if (!parsed) return `「${role}」的模型引用无效`;
  const provider = store.getProvider(parsed.providerId);
  if (!provider) return `找不到 Provider ${parsed.providerId}`;
  if (!provider.enabled) return `Provider ${provider.name} 尚未启用`;
  if (provider.kind !== 'mock' && !store.providerHasKey(provider.id)) return `Provider ${provider.name} 尚未配置 API Key`;
  const model = store.getModel(binding.model_ref);
  if (!model) return `找不到模型 ${binding.model_ref}`;
  if (model.status === 'deprecated') return `模型 ${model.display_name} 已下线，请更换`;
  return `模型 ${binding.model_ref} 当前不可用`;
}

function budgetCaps(store: Store) {
  return {
    dailyCny: store.getSettingInt('budget.daily_cny', 1000) / 100,
    sessionCny: store.getSettingInt('budget.session_cny', 200) / 100,
    dailyTokens: store.getSettingInt('budget.daily_tokens', 2_000_000),
    dailyCalls: store.getSettingInt('budget.daily_calls', 500),
  };
}

export function checkBudget(store: Store, input: { sessionId?: string | null; cost: number; tokens: number; calls?: number; timezone: string }): { ok: boolean; reason?: string } {
  if (store.getSettingBool('budget.enabled', true) === false) return { ok: true };
  const date = dateKey(input.timezone);
  const caps = budgetCaps(store);
  const global = store.getBudgetRow(date, 'global', 'all');
  const spentCost = (global?.spent_cost ?? 0) + (global?.reserved_cost ?? 0);
  const spentTokens = (global?.spent_tokens ?? 0) + (global?.reserved_tokens ?? 0);
  if (caps.dailyCny > 0 && spentCost + input.cost > caps.dailyCny) {
    return { ok: false, reason: `今日全局预算已用完（¥${caps.dailyCny.toFixed(2)}）` };
  }
  if (caps.dailyTokens > 0 && spentTokens + input.tokens > caps.dailyTokens) {
    return { ok: false, reason: '今日全局 token 上限已用完' };
  }
  const callRow = store.getBudgetRow(date, 'global', 'calls');
  const calls = (callRow?.spent_tokens ?? 0) + (callRow?.reserved_tokens ?? 0);
  if (caps.dailyCalls > 0 && calls + (input.calls ?? 1) > caps.dailyCalls) {
    return { ok: false, reason: '今日模型调用次数上限已用完' };
  }
  if (input.sessionId) {
    const s = store.getBudgetRow(date, 'session', input.sessionId);
    const sessionCost = (s?.spent_cost ?? 0) + (s?.reserved_cost ?? 0);
    if (caps.sessionCny > 0 && sessionCost + input.cost > caps.sessionCny) {
      return { ok: false, reason: '本会话今日预算已用完' };
    }
  }
  return { ok: true };
}

function reserve(store: Store, sessionId: string | null | undefined, cost: number, tokens: number, timezone: string): boolean {
  const date = dateKey(timezone);
  const caps = budgetCaps(store);
  const globalOk = store.reserveBudget({
    date,
    scope: 'global',
    key: 'all',
    cost,
    tokens,
    capCost: caps.dailyCny,
    capTokens: caps.dailyTokens,
  });
  if (!globalOk) return false;
  store.reserveBudget({
    date,
    scope: 'global',
    key: 'calls',
    cost: 0,
    tokens: 1,
    capCost: 0,
    capTokens: caps.dailyCalls,
  });
  if (sessionId) {
    const sessionOk = store.reserveBudget({
      date,
      scope: 'session',
      key: sessionId,
      cost,
      tokens,
      capCost: caps.sessionCny,
      capTokens: 0,
    });
    if (!sessionOk) {
      store.releaseBudget(date, 'global', 'all', cost, tokens);
      store.releaseBudget(date, 'global', 'calls', 0, 1);
      return false;
    }
  }
  return true;
}

function settle(
  store: Store,
  sessionId: string | null | undefined,
  reservedCost: number,
  reservedTokens: number,
  actualCost: number,
  actualTokens: number,
  timezone: string,
): void {
  const date = dateKey(timezone);
  store.settleBudget({
    date,
    scope: 'global',
    key: 'all',
    reservedCost,
    reservedTokens,
    actualCost,
    actualTokens,
  });
  store.settleBudget({
    date,
    scope: 'global',
    key: 'calls',
    reservedCost: 0,
    reservedTokens: 1,
    actualCost: 0,
    actualTokens: 1,
  });
  if (sessionId) {
    store.settleBudget({
      date,
      scope: 'session',
      key: sessionId,
      reservedCost,
      reservedTokens,
      actualCost,
      actualTokens,
    });
  }
}

export async function callRole(
  store: Store,
  role: ModelRole,
  messages: ChatMessage[],
  options: CallOptions,
  timezone: string,
): Promise<CallResult> {
  const candidates = resolveRoleCandidates(store, role);
  if (candidates.length === 0) throw new NoModelError(describeMissingModel(store, role));

  let lastError: unknown = null;
  for (const candidate of candidates) {
    // A vision-capable call must never silently fall back to a text-only model.
    if (options.purpose === 'vision' && !candidate.capabilities.vision) continue;

    const estimatedPrompt = estimateMessagesTokens(messages);
    const maxTokens = Math.min(options.maxTokens ?? 1200, candidate.model.max_output || 1024);
    const pricing = parsePricing(candidate.model.pricing_json);
    const estimated = estimateCost({
      store,
      pricing,
      promptTokens: estimatedPrompt,
      completionTokens: maxTokens,
      timezone,
    });
    const reserveCost = Math.max(0, estimated.cny * 1.15);
    const reserveTokens = estimatedPrompt + maxTokens;
    const isFree = candidate.provider.kind === 'mock';
    const budgetEnabled = store.getSettingBool('budget.enabled', true);

    let reserved = false;
    if (!isFree && budgetEnabled) {
      const budget = checkBudget(store, {
        sessionId: options.sessionId,
        cost: reserveCost,
        tokens: reserveTokens,
        timezone,
      });
      if (!budget.ok) {
        lastError = new BudgetExceededError(budget.reason ?? '预算不足');
        continue;
      }
      reserved = reserve(store, options.sessionId, reserveCost, reserveTokens, timezone);
      if (!reserved) {
        lastError = new BudgetExceededError('预算预留失败');
        continue;
      }
    }

    try {
      const response = await chat({
        provider: candidate.provider,
        model: candidate.model,
        apiKey: candidate.apiKey,
        messages,
        temperature: options.temperature,
        maxTokens,
        json: options.json,
        purpose: options.purpose,
        timeoutMs: options.timeoutMs,
        estimatedPromptTokens: estimatedPrompt,
      });
      if (!response.text.trim()) throw new ProviderError('模型返回空内容', 0, '', true);

      const actual = estimateCost({
        store,
        pricing,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        cachedTokens: response.usage.cachedTokens,
        imageTokens: response.usage.imageTokens,
        timezone,
      });

      if (reserved) {
        settle(store, options.sessionId, reserveCost, reserveTokens, actual.cny, response.usage.promptTokens + response.usage.completionTokens, timezone);
      }

      store.recordUsage({
        ts: Date.now(),
        session_id: options.sessionId ?? null,
        provider_id: candidate.provider.id,
        model_id: candidate.model.model_id,
        purpose: options.purpose,
        prompt_tokens: response.usage.promptTokens,
        completion_tokens: response.usage.completionTokens,
        cached_tokens: response.usage.cachedTokens,
        reasoning_tokens: response.usage.reasoningTokens,
        image_tokens: response.usage.imageTokens,
        cost: actual.cny,
        cost_native: actual.native,
        currency: actual.currency,
        latency_ms: response.latencyMs,
        estimated: response.usage.estimated || actual.estimated,
        capability_path: options.capabilityPath ?? 'direct',
      });

      return {
        text: response.text,
        usage: response.usage,
        latencyMs: response.latencyMs,
        model: candidate.model,
        provider: candidate.provider,
        ref: candidate.ref,
        costCny: actual.cny,
        costNative: actual.native,
        currency: actual.currency,
        capabilities: candidate.capabilities,
      };
    } catch (err) {
      if (reserved) {
        store.releaseBudget(
          dateKey(timezone),
          'global',
          'all',
          reserveCost,
          reserveTokens,
        );
        store.releaseBudget(dateKey(timezone), 'global', 'calls', 0, 1);
        if (options.sessionId) {
          store.releaseBudget(dateKey(timezone), 'session', options.sessionId, reserveCost, reserveTokens);
        }
      }
      lastError = err;
      logger.warn(
        { err: (err as Error).message, provider: candidate.provider.id, model: candidate.model.model_id, role },
        '模型调用失败',
      );
      if (err instanceof ProviderError && !err.retryable && err.status !== 429) {
        // Auth / bad request: trying another model is usually pointless.
        throw err;
      }
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new NoModelError('没有可用的模型');
}
