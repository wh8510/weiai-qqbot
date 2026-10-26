import { EventEmitter } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWebServer } from '../src/web/server.js';
import { hashPassword } from '../src/security/password.js';
import { makeStore } from './helpers.js';

let store: ReturnType<typeof makeStore>;
let app: any;
let cookie = '';
let csrf = '';

beforeAll(async () => {
  store = makeStore();
  store.createAdmin('admin', await hashPassword('TestPass123!'), false);
  store.upsertProviderPreset({ id: 'p', name: 'P', kind: 'openai', baseUrl: 'https://x.test/v1', models: [] });
  store.setProviderKey('p', 'sk-super-secret');
  const gateway = {
    getStatus: () => ({ connected: false, mode: 'none', selfId: '', nickname: '', lastEventAt: null, lastConnectedAt: null, lastError: '', eventCount: 0 }),
  };
  app = await createWebServer({
    store,
    gateway: gateway as any,
    runtime: {} as any,
    proactive: {} as any,
    events: new EventEmitter(),
  });
});

afterAll(async () => {
  await app?.close();
});

describe('admin API auth and sanitization', () => {
  it('rejects unauthenticated API access', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(401);
  });

  it('logs in and exposes CSRF', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'TestPass123!' },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.csrfToken).toBeTruthy();
    csrf = data.csrfToken;
    const setCookie = res.headers['set-cookie'];
    cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
    expect(cookie).toContain('companion_session=');
  });

  it('rejects unsafe requests without CSRF', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/policy',
      headers: { cookie },
      payload: { scope: 'private', action: 'allow', targetId: '10001' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('accepts a CSRF-protected request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/policy',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { scope: 'private', action: 'allow', targetId: '10001' },
    });
    expect(res.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/policy', headers: { cookie } });
    expect(list.json().entries).toHaveLength(1);
  });

  it('never returns encrypted keys or plaintext keys from providers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('sk-super-secret');
    expect(res.body).not.toContain('api_key_enc');
    expect(res.json().providers[0].hasKey).toBe(true);
  });

  it('reveals a key only through an explicit CSRF-protected request', async () => {
    const denied = await app.inject({ method: 'POST', url: '/api/providers/p/reveal-key', headers: { cookie }, payload: {} });
    expect(denied.statusCode).toBe(403);
    const res = await app.inject({
      method: 'POST',
      url: '/api/providers/p/reveal-key',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().apiKey).toBe('sk-super-secret');
    expect(res.json().keyLast4).toBe('cret');
  });

  it('rejects group_member allow entries', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/policy',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { scope: 'group_member', action: 'allow', targetId: '10001' },
    });
    expect(res.statusCode).toBe(400);
  });
});
