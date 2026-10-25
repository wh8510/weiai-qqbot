import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { config, publicConfig } from '../config.js';
import { logger } from '../logger.js';
import { Store } from '../store.js';
import { OneBotGateway } from '../onebot/gateway.js';
import { ChatRuntime } from '../chat/runtime.js';
import { ProactiveScheduler } from '../proactive/scheduler.js';
import { probeModel } from '../models/probe.js';
import { catalogSummary } from '../models/catalog.js';
import { describeMissingModel, resolveRole, resolveRoleCandidates } from '../models/gateway.js';
import { hashPassword, verifyPassword } from '../security/password.js';
import { randomToken, safeEqual, sha256Hex } from '../security/crypto.js';
import { startOfLocalDay } from '../util/time.js';
import { voiceStatus } from '../media/tts.js';
import type { ModelRole } from '../store.js';

const COOKIE = 'companion_session';
const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/login']);

interface WebDeps {
  store: Store;
  gateway: OneBotGateway;
  runtime: ChatRuntime;
  proactive: ProactiveScheduler;
  events: EventEmitter;
}

interface LoginAttempt {
  count: number;
  resetAt: number;
}

function jsonBody(req: FastifyRequest): any {
  return (req.body ?? {}) as any;
}

function bool(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  return value === true || value === 'true' || value === 1 || value === '1';
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export async function createWebServer(deps: WebDeps): Promise<any> {
  const { store, gateway, runtime, proactive, events } = deps;
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: config.server.trustProxy,
    bodyLimit: 8 * 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  const attempts = new Map<string, LoginAttempt>();
  const loginRate = (ip: string): boolean => {
    const now = Date.now();
    const entry = attempts.get(ip);
    if (!entry || entry.resetAt < now) {
      attempts.set(ip, { count: 0, resetAt: now + 15 * 60_000 });
      return true;
    }
    return entry.count < 6;
  };
  const recordFailure = (ip: string): void => {
    const entry = attempts.get(ip) ?? { count: 0, resetAt: Date.now() + 15 * 60_000 };
    entry.count += 1;
    attempts.set(ip, entry);
  };

  const cookieOptions = (req: FastifyRequest) => ({
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.security.forceHttps || config.server.publicUrl.startsWith('https://') || req.protocol === 'https',
    path: '/',
    maxAge: config.security.sessionTtlHours * 3600,
  });

  const issueSession = (req: FastifyRequest, reply: FastifyReply, userId: string, username: string): { csrfToken: string; expiresAt: number } => {
    const token = randomToken(32);
    const csrfToken = randomToken(24);
    const expiresAt = Date.now() + config.security.sessionTtlHours * 3600_000;
    store.createAdminSession({
      userId,
      tokenHash: sha256Hex(token),
      csrfToken,
      expiresAt,
      ip: req.ip,
      userAgent: String(req.headers['user-agent'] ?? ''),
    });
    reply.setCookie(COOKIE, token, cookieOptions(req));
    store.audit(username, 'auth.login', `session issued`, req.ip);
    return { csrfToken, expiresAt };
  };

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const pathname = req.url.split('?')[0];
    if (!pathname.startsWith('/api/')) return;
    if (PUBLIC_PATHS.has(pathname)) return;

    const token = req.cookies?.[COOKIE];
    if (!token) return reply.code(401).send({ error: 'UNAUTHORIZED', message: '请先登录' });
    const session = store.getAdminSession(sha256Hex(token));
    if (!session) {
      reply.clearCookie(COOKIE, { path: '/' });
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: '登录已过期' });
    }
    (req as any).auth = session;

    const method = req.method.toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const csrf = String(req.headers['x-csrf-token'] ?? '');
      if (!csrf || !safeEqual(csrf, String(session.csrf_token))) {
        return reply.code(403).send({ error: 'CSRF', message: 'CSRF 校验失败，请刷新页面' });
      }
    }
    if (session.must_change_password && !['/api/auth/me', '/api/auth/logout', '/api/auth/change-password'].includes(pathname)) {
      return reply.code(403).send({ error: 'PASSWORD_CHANGE_REQUIRED', message: '首次登录请先修改密码' });
    }
  });

  app.get('/api/health', async () => ({
    ok: true,
    version: config.version,
    demo: config.demo,
    onebot: gateway.getStatus(),
  }));

  app.post('/api/auth/login', async (req, reply) => {
    if (!loginRate(req.ip)) return reply.code(429).send({ error: 'RATE_LIMIT', message: '尝试次数过多，请 15 分钟后再试' });
    const body = jsonBody(req);
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');
    if (!username || !password) return reply.code(400).send({ error: 'BAD_REQUEST', message: '请输入用户名和密码' });
    const admin = store.getAdminByUsername(username);
    if (!admin || !(await verifyPassword(admin.password_hash, password))) {
      recordFailure(req.ip);
      store.audit(username || 'unknown', 'auth.login_failed', '', req.ip);
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: '用户名或密码错误' });
    }
    attempts.delete(req.ip);
    const issued = issueSession(req, reply, admin.id, admin.username);
    return {
      ok: true,
      username: admin.username,
      mustChangePassword: Boolean(admin.must_change_password),
      csrfToken: issued.csrfToken,
      expiresAt: issued.expiresAt,
      demo: config.demo,
    };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.[COOKIE];
    if (token) store.deleteAdminSession(sha256Hex(token));
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const auth = (req as any).auth;
    return {
      username: auth.username,
      mustChangePassword: Boolean(auth.must_change_password),
      csrfToken: auth.csrf_token,
      expiresAt: auth.expires_at,
      demo: config.demo,
      version: config.version,
    };
  });

  app.post('/api/auth/change-password', async (req, reply) => {
    const auth = (req as any).auth;
    const body = jsonBody(req);
    const current = String(body.currentPassword ?? '');
    const next = String(body.newPassword ?? '');
    if (next.length < 8) return reply.code(400).send({ error: 'WEAK_PASSWORD', message: '新密码至少 8 位' });
    const admin = store.getAdminById(auth.user_id);
    if (!admin || !(await verifyPassword(admin.password_hash, current))) {
      return reply.code(400).send({ error: 'INVALID_PASSWORD', message: '当前密码不正确' });
    }
    store.updateAdminPassword(admin.id, await hashPassword(next), false);
    store.deleteAllAdminSessions(admin.id);
    const issued = issueSession(req, reply, admin.id, admin.username);
    return { ok: true, csrfToken: issued.csrfToken, mustChangePassword: false };
  });

  app.get('/api/status', async () => {
    const todayStart = startOfLocalDay(config.timezone);
    const usage = store.usageSummary(todayStart);
    const budget = store.todayBudget(new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date()));
    const chat = resolveRole(store, 'chat');
    const vision = resolveRole(store, 'vision');
    return {
      version: config.version,
      demo: config.demo,
      keyFingerprint: store.keys.fingerprint,
      uptimeSec: Math.round(process.uptime()),
      onebot: gateway.getStatus(),
      counts: store.counts(),
      usageToday: usage,
      budget: {
        todayCost: budget.cost,
        todayTokens: budget.tokens,
        dailyCny: store.getSettingInt('budget.daily_cny', 1000) / 100,
        sessionCny: store.getSettingInt('budget.session_cny', 200) / 100,
        dailyTokens: store.getSettingInt('budget.daily_tokens', 2_000_000),
        dailyCalls: store.getSettingInt('budget.daily_calls', 500),
        proactiveDaily: store.getSettingInt('budget.proactive_daily', 20),
      },
      models: {
        chat: chat ? { ref: chat.ref, label: chat.model.display_name, vision: chat.capabilities.vision } : null,
        vision: vision ? { ref: vision.ref, label: vision.model.display_name } : null,
        missing: chat ? null : describeMissingModel(store, 'chat'),
      },
      voice: voiceStatus(),
      tts: { supported: voiceStatus().supported },
      config: publicConfig(),
    };
  });

  app.get('/api/providers', async () => ({
    providers: catalogSummary(store).map((p) => ({
      ...p,
      api_key_enc: undefined,
      extra_headers_json: undefined,
    })),
  }));

  app.post('/api/providers', async (req, reply) => {
    const body = jsonBody(req);
    const id = String(body.id ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'Provider id 不能为空' });
    if (store.getProvider(id)) return reply.code(409).send({ error: 'EXISTS', message: 'Provider 已存在' });
    const kind = ['openai', 'anthropic', 'gemini', 'mock'].includes(body.kind) ? body.kind : 'openai';
    const baseUrl = String(body.baseUrl ?? '').trim();
    if (!baseUrl) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'baseUrl 不能为空' });
    store.addCustomProvider({
      id,
      name: String(body.name ?? id),
      kind,
      baseUrl,
      apiKey: body.apiKey ? String(body.apiKey) : undefined,
    });
    store.audit((req as any).auth.username, 'provider.create', id, req.ip);
    return { ok: true, id };
  });

  app.patch('/api/providers/:id', async (req, reply) => {
    const id = String((req.params as any).id);
    const provider = store.getProvider(id);
    if (!provider) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Provider 不存在' });
    const body = jsonBody(req);
    if (body.apiKey !== undefined) {
      store.setProviderKey(id, String(body.apiKey));
      if (String(body.apiKey)) store.setProviderEnabled(id, true);
    }
    if (body.baseUrl !== undefined && String(body.baseUrl).trim()) store.setProviderBaseUrl(id, String(body.baseUrl).trim());
    if (body.enabled !== undefined) store.setProviderEnabled(id, Boolean(body.enabled));
    store.audit((req as any).auth.username, 'provider.update', id, req.ip);
    return { ok: true };
  });

  app.delete('/api/providers/:id', async (req, reply) => {
    const id = String((req.params as any).id);
    const provider = store.getProvider(id);
    if (!provider) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Provider 不存在' });
    store.deleteProvider(id);
    store.audit((req as any).auth.username, 'provider.delete', id, req.ip);
    return { ok: true };
  });

  app.get('/api/models', async () => ({ models: catalogSummary(store) }));

  app.post('/api/models', async (req, reply) => {
    const body = jsonBody(req);
    const providerId = String(body.providerId ?? '');
    if (!store.getProvider(providerId)) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'Provider 不存在' });
    const modelId = String(body.modelId ?? '').trim();
    if (!modelId) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'modelId 不能为空' });
    const id = store.addCustomModel({
      providerId,
      modelId,
      displayName: String(body.displayName ?? modelId),
      context: Number(body.context ?? 32768),
      maxOutput: Number(body.maxOutput ?? 4096),
      input: Array.isArray(body.input) ? body.input.map(String) : ['text'],
      features: Array.isArray(body.features) ? body.features.map(String) : [],
      pricing: body.pricing ?? null,
    });
    return { ok: true, id };
  });

  app.patch('/api/models/:id', async (req, reply) => {
    const id = String((req.params as any).id);
    if (!store.getModel(id)) return reply.code(404).send({ error: 'NOT_FOUND', message: '模型不存在' });
    const body = jsonBody(req);
    if (body.capabilitiesOverride !== undefined) {
      store.setCapabilitiesOverride(id, body.capabilitiesOverride || null);
    }
    return { ok: true };
  });

  app.post('/api/models/:id/probe', async (req, reply) => {
    const id = String((req.params as any).id);
    const model = store.getModel(id);
    if (!model) return reply.code(404).send({ error: 'NOT_FOUND', message: '模型不存在' });
    const provider = store.getProvider(model.provider_id);
    if (!provider) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Provider 不存在' });
    const apiKey = provider.kind === 'mock' ? 'mock' : store.getProviderApiKey(provider.id);
    if (!apiKey) return reply.code(400).send({ error: 'NO_KEY', message: '请先配置该 Provider 的 API Key' });
    try {
      const result = await probeModel({ store, provider, model, apiKey });
      store.audit((req as any).auth.username, 'model.probe', id, req.ip);
      return { ok: true, probe: result };
    } catch (err) {
      return reply.code(500).send({ error: 'PROBE_FAILED', message: (err as Error).message });
    }
  });

  app.post('/api/providers/:id/test', async (req, reply) => {
    const providerId = String((req.params as any).id);
    const provider = store.getProvider(providerId);
    if (!provider) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Provider 不存在' });
    const body = jsonBody(req);
    const ref = body.modelRef ? String(body.modelRef) : store.listModels(providerId)[0]?.id;
    const model = ref ? store.getModel(ref) : null;
    if (!model) return reply.code(400).send({ error: 'NO_MODEL', message: '该 Provider 还没有模型' });
    const apiKey = provider.kind === 'mock' ? 'mock' : store.getProviderApiKey(providerId);
    if (!apiKey) return reply.code(400).send({ error: 'NO_KEY', message: '请先配置 API Key' });
    const result = await probeModel({ store, provider, model, apiKey });
    return { ok: true, probe: result };
  });

  app.get('/api/roles', async () => {
    const bindings = store.getRoleBindings();
    return {
      roles: ['chat', 'vision', 'memory', 'classifier', 'embedding'].map((role) => {
        const binding = bindings.find((b) => b.role === role);
        const candidates = resolveRoleCandidates(store, role as ModelRole);
        return {
          role,
          modelRef: binding?.model_ref ?? null,
          fallbackRefs: binding ? JSON.parse(binding.fallback_refs_json || '[]') : [],
          available: candidates.length > 0,
          label: candidates[0]?.model.display_name ?? null,
          missing: candidates.length ? null : describeMissingModel(store, role as ModelRole),
        };
      }),
    };
  });

  app.put('/api/roles', async (req, reply) => {
    const body = jsonBody(req);
    const role = String(body.role ?? '');
    if (!['chat', 'vision', 'memory', 'classifier', 'embedding'].includes(role)) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '未知角色' });
    }
    const modelRef = body.modelRef ? String(body.modelRef) : null;
    if (modelRef && !store.getModel(modelRef)) return reply.code(400).send({ error: 'BAD_REQUEST', message: '模型不存在' });
    const fallbackRefs = Array.isArray(body.fallbackRefs) ? body.fallbackRefs.map(String) : [];
    store.setRoleBinding(role as ModelRole, modelRef, fallbackRefs, body.options ?? {});
    store.audit((req as any).auth.username, 'role.update', role, req.ip);
    return { ok: true };
  });

  app.get('/api/personas', async () => ({
    personas: store.listPersonas(),
    activePersonaId: store.getActivePersona()?.id ?? null,
  }));

  app.post('/api/personas', async (req, reply) => {
    const body = jsonBody(req);
    if (!String(body.name ?? '').trim() || !String(body.systemPrompt ?? '').trim()) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '名称和人格提示词不能为空' });
    }
    const id = store.createPersona({
      name: String(body.name),
      description: String(body.description ?? ''),
      systemPrompt: String(body.systemPrompt),
      styleExamples: String(body.styleExamples ?? ''),
      boundaries: String(body.boundaries ?? ''),
      noVisionLines: String(body.noVisionLines ?? ''),
      voiceStyle: String(body.voiceStyle ?? ''),
    });
    return { ok: true, id };
  });

  app.put('/api/personas/:id', async (req, reply) => {
    const id = String((req.params as any).id);
    if (!store.getPersona(id)) return reply.code(404).send({ error: 'NOT_FOUND', message: '人格不存在' });
    const body = jsonBody(req);
    store.updatePersona(id, {
      name: String(body.name ?? ''),
      description: String(body.description ?? ''),
      systemPrompt: String(body.systemPrompt ?? ''),
      styleExamples: String(body.styleExamples ?? ''),
      boundaries: String(body.boundaries ?? ''),
      noVisionLines: String(body.noVisionLines ?? ''),
      voiceStyle: String(body.voiceStyle ?? ''),
    });
    store.audit((req as any).auth.username, 'persona.update', id, req.ip);
    return { ok: true };
  });

  app.post('/api/personas/:id/activate', async (req, reply) => {
    const id = String((req.params as any).id);
    if (!store.getPersona(id)) return reply.code(404).send({ error: 'NOT_FOUND', message: '人格不存在' });
    store.setSetting('active_persona_id', id);
    return { ok: true };
  });

  app.get('/api/personas/:id/versions', async (req) => ({
    versions: store.listPersonaVersions(String((req.params as any).id)),
  }));

  app.get('/api/policy', async () => ({ entries: store.listPolicy() }));

  app.post('/api/policy', async (req, reply) => {
    const body = jsonBody(req);
    const scope = String(body.scope ?? '');
    const action = String(body.action ?? '');
    const targetId = String(body.targetId ?? '').trim();
    if (!['private', 'group', 'group_member'].includes(scope)) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'scope 无效' });
    if (!['allow', 'deny'].includes(action)) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'action 无效' });
    if (scope === 'group_member' && action !== 'deny') return reply.code(400).send({ error: 'BAD_REQUEST', message: '群成员只支持黑名单' });
    if (!/^\d{3,20}$/.test(targetId)) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'QQ/群号格式不正确' });
    const id = store.upsertPolicy({ scope, action, targetId, note: String(body.note ?? ''), enabled: body.enabled !== false });
    store.audit((req as any).auth.username, 'policy.upsert', `${scope}:${action}:${targetId}`, req.ip);
    return { ok: true, id };
  });

  app.delete('/api/policy/:id', async (req) => {
    store.deletePolicy(String((req.params as any).id));
    return { ok: true };
  });

  app.get('/api/sessions', async () => {
    const sessions = store.listSessions(100).map((s) => {
      const last = store.listMessages(s.id, 1)[0];
      let settings: any = {};
      try {
        settings = JSON.parse(s.settings_json || '{}');
      } catch {
        settings = {};
      }
      return {
        ...s,
        settings,
        relationship: store.getRelationship(s.id),
        lastMessage: last ? { text: last.text, direction: last.direction, at: last.created_at } : null,
      };
    });
    return { sessions };
  });

  app.get('/api/sessions/:id', async (req, reply) => {
    const id = String((req.params as any).id);
    const session = store.getSession(id);
    if (!session) return reply.code(404).send({ error: 'NOT_FOUND', message: '会话不存在' });
    let settings: any = {};
    try {
      settings = JSON.parse(session.settings_json || '{}');
    } catch {
      settings = {};
    }
    return {
      session: { ...session, summary_enc: undefined, settings },
      relationship: store.getRelationship(id),
      summary: store.getSessionSummary(id),
      facts: store.listFacts(id, 20),
      diaries: store.listDiaries(id, 7),
      openLoops: store.listOpenLoops(id, 'open', 10),
    };
  });

  app.get('/api/sessions/:id/messages', async (req) => {
    const id = String((req.params as any).id);
    const limit = Math.min(500, Math.max(1, Number((req.query as any).limit ?? 200)));
    return { messages: store.listMessages(id, limit) };
  });

  app.patch('/api/sessions/:id', async (req, reply) => {
    const id = String((req.params as any).id);
    const session = store.getSession(id);
    if (!session) return reply.code(404).send({ error: 'NOT_FOUND', message: '会话不存在' });
    const body = jsonBody(req);
    let settings: any = {};
    try {
      settings = JSON.parse(session.settings_json || '{}');
    } catch {
      settings = {};
    }
    if (body.settings && typeof body.settings === 'object') settings = { ...settings, ...body.settings };
    store.updateSession(id, {
      mode: body.mode !== undefined ? String(body.mode) : undefined,
      settingsJson: JSON.stringify(settings),
      personaId: body.personaId === undefined ? undefined : body.personaId,
    });
    return { ok: true };
  });

  app.post('/api/sessions/:id/reset', async (req, reply) => {
    const id = String((req.params as any).id);
    if (!store.getSession(id)) return reply.code(404).send({ error: 'NOT_FOUND', message: '会话不存在' });
    store.resetSession(id);
    store.audit((req as any).auth.username, 'session.reset', id, req.ip);
    return { ok: true };
  });

  app.post('/api/sessions/:id/summarize', async (req, reply) => {
    const id = String((req.params as any).id);
    if (!store.getSession(id)) return reply.code(404).send({ error: 'NOT_FOUND', message: '会话不存在' });
    const jobId = store.enqueueJob('memory.summarize', { sessionId: id });
    return { ok: true, jobId };
  });

  app.post('/api/sessions/:id/diary', async (req, reply) => {
    const id = String((req.params as any).id);
    if (!store.getSession(id)) return reply.code(404).send({ error: 'NOT_FOUND', message: '会话不存在' });
    const jobId = store.enqueueJob('memory.diary', { sessionId: id });
    return { ok: true, jobId };
  });

  app.get('/api/memory/facts', async (req) => {
    const sessionId = String((req.query as any).sessionId ?? '');
    return { facts: sessionId ? store.listFacts(sessionId, 200) : [] };
  });

  app.get('/api/memory/diaries', async (req) => {
    const sessionId = String((req.query as any).sessionId ?? '');
    return { diaries: sessionId ? store.listDiaries(sessionId, 60) : [] };
  });

  app.delete('/api/memory/facts/:id', async (req) => {
    store.deleteFact(String((req.params as any).id));
    return { ok: true };
  });

  app.delete('/api/memory/diaries/:id', async (req) => {
    store.deleteDiary(String((req.params as any).id));
    return { ok: true };
  });

  app.get('/api/proactive/settings', async () => ({
    enabled: store.getSettingBool('proactive.enabled', true),
    quietStart: store.getSetting('proactive.quiet_start', '23:30'),
    quietEnd: store.getSetting('proactive.quiet_end', '08:00'),
    minIntervalMin: store.getSettingInt('proactive.min_interval_min', 120),
    privateDailyCap: store.getSettingInt('proactive.private_daily_cap', 2),
    groupDailyCap: store.getSettingInt('proactive.group_daily_cap', 2),
    globalDailyCap: store.getSettingInt('budget.proactive_daily', 20),
    lastTickAt: store.getSetting('proactive.last_tick_at', ''),
  }));

  app.put('/api/proactive/settings', async (req) => {
    const body = jsonBody(req);
    if (body.enabled !== undefined) store.setSetting('proactive.enabled', bool(body.enabled) ? '1' : '0');
    if (body.quietStart !== undefined) store.setSetting('proactive.quiet_start', String(body.quietStart));
    if (body.quietEnd !== undefined) store.setSetting('proactive.quiet_end', String(body.quietEnd));
    if (body.minIntervalMin !== undefined) store.setSetting('proactive.min_interval_min', String(clampNumber(body.minIntervalMin, 10, 1440, 120)));
    if (body.privateDailyCap !== undefined) store.setSetting('proactive.private_daily_cap', String(clampNumber(body.privateDailyCap, 0, 20, 2)));
    if (body.groupDailyCap !== undefined) store.setSetting('proactive.group_daily_cap', String(clampNumber(body.groupDailyCap, 0, 20, 2)));
    if (body.globalDailyCap !== undefined) store.setSetting('budget.proactive_daily', String(clampNumber(body.globalDailyCap, 0, 200, 20)));
    return { ok: true };
  });

  app.post('/api/proactive/test/:sessionId', async (req, reply) => {
    const id = String((req.params as any).sessionId);
    if (!store.getSession(id)) return reply.code(404).send({ error: 'NOT_FOUND', message: '会话不存在' });
    const result = await proactive.test(id, Boolean(jsonBody(req).enqueue));
    return { ok: true, result };
  });

  app.get('/api/usage', async (req) => {
    const days = Math.min(30, Math.max(1, Number((req.query as any).days ?? 7)));
    const since = startOfLocalDay(config.timezone) - (days - 1) * 24 * 3600_000;
    const summary = store.usageSummary(since);
    const timeseries = store.usageTimeseries(days, config.timezone);
    const todayStart = startOfLocalDay(config.timezone);
    const today = store.usageSummary(todayStart);
    const budget = store.todayBudget(new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date()));
    return {
      days,
      summary,
      timeseries,
      today: today.total,
      budget: {
        todayCost: budget.cost,
        todayTokens: budget.tokens,
        dailyCny: store.getSettingInt('budget.daily_cny', 1000) / 100,
        sessionCny: store.getSettingInt('budget.session_cny', 200) / 100,
        dailyTokens: store.getSettingInt('budget.daily_tokens', 2_000_000),
        dailyCalls: store.getSettingInt('budget.daily_calls', 500),
      },
    };
  });

  app.get('/api/settings', async () => ({
    botName: store.getSetting('bot.name', '小满'),
    aliases: store.getSetting('bot.aliases', '[]'),
    ownerQq: store.getSetting('owner_qq', ''),
    onebot: {
      mode: store.getSetting('onebot.mode', config.onebot.mode),
      path: store.getSetting('onebot.path', config.onebot.path),
      url: store.getSetting('onebot.url', config.onebot.url),
      tokenConfigured: Boolean(store.getSecretSetting('onebot.token') || config.onebot.token),
    },
    budget: {
      enabled: store.getSettingBool('budget.enabled', true),
      dailyCny: store.getSettingInt('budget.daily_cny', 1000) / 100,
      sessionCny: store.getSettingInt('budget.session_cny', 200) / 100,
      dailyTokens: store.getSettingInt('budget.daily_tokens', 2_000_000),
      dailyCalls: store.getSettingInt('budget.daily_calls', 500),
    },
    fxUsdCny: store.getSettingInt('fx.usd_cny', 720) / 100,
    defaults: {
      privateReplyProbability: Number(store.getSetting('defaults.private_reply_probability', '0.95')),
      groupReplyProbability: Number(store.getSetting('defaults.group_reply_probability', '0.12')),
      groupAttentionThreshold: Number(store.getSetting('defaults.group_attention_threshold', '4')),
      stickerProbability: Number(store.getSetting('defaults.sticker_probability', '0.2')),
      voiceProbability: Number(store.getSetting('defaults.voice_probability', '0.1')),
      maxMessagesPerHour: Number(store.getSetting('defaults.max_messages_per_hour', '12')),
      cooldownSec: Number(store.getSetting('defaults.cooldown_sec', '90')),
    },
    timezone: config.timezone,
    version: config.version,
    keyFingerprint: store.keys.fingerprint,
    voice: voiceStatus(),
  }));

  app.put('/api/settings', async (req) => {
    const body = jsonBody(req);
    if (body.botName !== undefined) store.setSetting('bot.name', String(body.botName));
    if (body.aliases !== undefined) {
      const aliases = Array.isArray(body.aliases)
        ? body.aliases.map(String)
        : String(body.aliases)
            .split(/[,，\n]/)
            .map((s) => s.trim())
            .filter(Boolean);
      store.setSetting('bot.aliases', JSON.stringify(aliases));
    }
    if (body.ownerQq !== undefined) store.setSetting('owner_qq', String(body.ownerQq).replace(/\D/g, ''));
    if (body.onebot) {
      if (body.onebot.mode !== undefined) store.setSetting('onebot.mode', body.onebot.mode === 'forward' ? 'forward' : 'reverse');
      if (body.onebot.path !== undefined) store.setSetting('onebot.path', String(body.onebot.path));
      if (body.onebot.url !== undefined) store.setSetting('onebot.url', String(body.onebot.url));
      if (body.onebot.token !== undefined && String(body.onebot.token)) store.setSecretSetting('onebot.token', String(body.onebot.token));
    }
    if (body.budget) {
      if (body.budget.enabled !== undefined) store.setSetting('budget.enabled', bool(body.budget.enabled) ? '1' : '0');
      if (body.budget.dailyCny !== undefined) store.setSetting('budget.daily_cny', String(Math.round(clampNumber(body.budget.dailyCny, 0, 100000, 10) * 100)));
      if (body.budget.sessionCny !== undefined) store.setSetting('budget.session_cny', String(Math.round(clampNumber(body.budget.sessionCny, 0, 100000, 2) * 100)));
      if (body.budget.dailyTokens !== undefined) store.setSetting('budget.daily_tokens', String(clampNumber(body.budget.dailyTokens, 0, 1e9, 2_000_000)));
      if (body.budget.dailyCalls !== undefined) store.setSetting('budget.daily_calls', String(clampNumber(body.budget.dailyCalls, 0, 1e6, 500)));
    }
    if (body.fxUsdCny !== undefined) store.setSetting('fx.usd_cny', String(Math.round(clampNumber(body.fxUsdCny, 0.1, 100, 7.2) * 100)));
    if (body.defaults) {
      const d = body.defaults;
      if (d.privateReplyProbability !== undefined) store.setSetting('defaults.private_reply_probability', String(clampNumber(d.privateReplyProbability, 0, 1, 0.95)));
      if (d.groupReplyProbability !== undefined) store.setSetting('defaults.group_reply_probability', String(clampNumber(d.groupReplyProbability, 0, 1, 0.12)));
      if (d.groupAttentionThreshold !== undefined) store.setSetting('defaults.group_attention_threshold', String(clampNumber(d.groupAttentionThreshold, 0, 100, 4)));
      if (d.stickerProbability !== undefined) store.setSetting('defaults.sticker_probability', String(clampNumber(d.stickerProbability, 0, 1, 0.2)));
      if (d.voiceProbability !== undefined) store.setSetting('defaults.voice_probability', String(clampNumber(d.voiceProbability, 0, 1, 0.1)));
      if (d.maxMessagesPerHour !== undefined) store.setSetting('defaults.max_messages_per_hour', String(clampNumber(d.maxMessagesPerHour, 1, 500, 12)));
      if (d.cooldownSec !== undefined) store.setSetting('defaults.cooldown_sec', String(clampNumber(d.cooldownSec, 0, 3600, 90)));
    }
    return { ok: true, restartRequiredForOneBotNetwork: Boolean(body.onebot) };
  });

  app.get('/api/stickers', async () => ({
    stickers: store.listStickers().map((s) => ({
      id: s.id,
      tags: s.tags,
      emotion: s.emotion,
      source: s.source,
      usage_count: s.usage_count,
      created_at: s.created_at,
      fileUrl: `/api/stickers/${s.id}/file`,
    })),
  }));

  app.post('/api/stickers', async (req, reply) => {
    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ error: 'BAD_REQUEST', message: '请上传图片' });
    if (!String(file.mimetype).startsWith('image/')) return reply.code(400).send({ error: 'BAD_REQUEST', message: '只支持图片' });
    const buffer = await file.toBuffer();
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const ext = file.mimetype.includes('gif') ? 'gif' : file.mimetype.includes('webp') ? 'webp' : 'png';
    const dest = path.join(config.dataDir, 'stickers', `${hash}.${ext}`);
    fs.writeFileSync(dest, buffer);
    const fields = file.fields as any;
    const id = store.addSticker({
      filePath: dest,
      tags: String(fields?.tags?.value ?? ''),
      emotion: String(fields?.emotion?.value ?? ''),
      source: 'manual',
    });
    return { ok: true, id };
  });

  app.get('/api/stickers/:id/file', async (req, reply) => {
    const sticker = store.listStickers().find((s) => s.id === String((req.params as any).id));
    if (!sticker || !fs.existsSync(sticker.file_path)) return reply.code(404).send({ error: 'NOT_FOUND' });
    const ext = path.extname(sticker.file_path).slice(1);
    const mime = ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png';
    reply.type(mime);
    return reply.send(fs.createReadStream(sticker.file_path));
  });

  app.delete('/api/stickers/:id', async (req) => {
    store.deleteSticker(String((req.params as any).id));
    return { ok: true };
  });

  app.post('/api/debug/chat', async (req, reply) => {
    const body = jsonBody(req);
    const text = String(body.text ?? '').trim();
    const images = Array.isArray(body.images)
      ? body.images
          .filter((i: any) => i?.dataBase64)
          .slice(0, 3)
          .map((i: any) => ({ mimeType: String(i.mimeType ?? 'image/png'), dataBase64: String(i.dataBase64) }))
      : [];
    if (!text && images.length === 0) return reply.code(400).send({ error: 'BAD_REQUEST', message: '请输入内容或附一张图' });
    try {
      const result = await runtime.debugChat({ sessionId: body.sessionId ? String(body.sessionId) : undefined, text, images });
      return { ok: true, ...result };
    } catch (err) {
      return reply.code(500).send({ error: 'CHAT_FAILED', message: (err as Error).message });
    }
  });

  app.get('/api/audit', async () => ({ logs: store.listAudit(200) }));

  app.get('/api/events', async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event: string, data: any) => {
      try {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        // closed
      }
    };
    send('ready', { at: Date.now() });
    const names = ['incoming', 'reply', 'proactive', 'outbox', 'error'] as const;
    const handlers = names.map((name) => {
      const handler = (data: any) => send(name, data);
      events.on(name, handler);
      return [name, handler] as const;
    });
    const heartbeat = setInterval(() => send('ping', { at: Date.now() }), 20_000);
    heartbeat.unref?.();
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      for (const [name, handler] of handlers) events.off(name, handler);
    });
  });

  // Static admin UI. In development use `pnpm dev:web`; production serves dist/web.
  if (fs.existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, prefix: '/' });
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (fs.existsSync(path.join(config.webDist, 'index.html'))) return reply.sendFile('index.html');
    return reply
      .type('text/html; charset=utf-8')
      .send('<!doctype html><meta charset="utf-8"><title>OneBot Companion</title><body style="font-family:system-ui;padding:40px"><h1>OneBot Companion</h1><p>管理端还没构建。请先运行 <code>pnpm build:web</code>，或用 <code>pnpm dev:web</code> 开发。</p>');
  });

  app.setErrorHandler((err: any, req: FastifyRequest, reply: FastifyReply) => {
    logger.error({ err: err.message, stack: err.stack, url: req.url }, 'HTTP 请求失败');
    const status = (err as any).statusCode && (err as any).statusCode >= 400 ? (err as any).statusCode : 500;
    return reply.code(status).send({
      error: status >= 500 ? 'INTERNAL' : 'BAD_REQUEST',
      message: status >= 500 ? '服务器内部错误' : err.message,
    });
  });

  return app;
}
