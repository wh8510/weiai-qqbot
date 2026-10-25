import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { decryptField, encryptField, sha256Hex } from './security/crypto.js';
import type { KeySet } from './security/crypto.js';

export type SessionKind = 'private' | 'group';
export type Direction = 'in' | 'out';
export type ModelRole = 'chat' | 'vision' | 'memory' | 'classifier' | 'embedding';

export interface ProviderRow {
  id: string;
  name: string;
  kind: string;
  base_url: string;
  api_key_enc: string | null;
  enabled: number;
  is_preset: number;
  docs_url: string | null;
  extra_headers_json: string | null;
  created_at: number;
  updated_at: number;
}

export interface ModelRow {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  context_window: number;
  max_output: number;
  input_json: string;
  output_json: string;
  features_json: string;
  pricing_json: string | null;
  status: string;
  successor: string | null;
  source_url: string | null;
  verified_at: number | null;
  probe_json: string | null;
  capabilities_override_json: string | null;
  created_at: number;
  updated_at: number;
}

export interface SessionRow {
  id: string;
  account_id: string;
  kind: SessionKind;
  peer_id: string;
  group_id: string | null;
  persona_id: string | null;
  mode: string;
  settings_json: string;
  summary_enc: string | null;
  summary_tokens: number;
  last_active_at: number;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  session_id: string;
  account_id: string;
  direction: Direction;
  sender_id: string;
  sender_name_enc: string;
  message_id: string | null;
  reply_to: string | null;
  segments_enc: string;
  text_enc: string;
  tokens: number;
  model_ref: string | null;
  capability_path: string | null;
  created_at: number;
}

export interface MessageRecord extends Omit<MessageRow, 'segments_enc' | 'text_enc' | 'sender_name_enc'> {
  segments: any[];
  text: string;
  sender_name: string;
}

export interface FactRecord {
  id: string;
  session_id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  importance: number;
  source_message_ids: string[];
  status: string;
  created_at: number;
  updated_at: number;
}

export interface EpisodeRecord {
  id: string;
  session_id: string;
  title: string;
  summary: string;
  participants: string[];
  valence: number;
  importance: number;
  source_message_ids: string[];
  created_at: number;
}

export interface DiaryRecord {
  id: string;
  session_id: string;
  date: string;
  content: string;
  mood: string;
  importance: number;
  created_at: number;
}

export interface OpenLoopRecord {
  id: string;
  session_id: string;
  topic: string;
  detail: string;
  status: string;
  due_hint: string | null;
  source_message_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface OutboxRow {
  id: string;
  session_id: string;
  account_id: string;
  kind: string;
  payload_enc: string;
  due_at: number;
  status: string;
  attempts: number;
  idempotency_key: string | null;
  created_at: number;
  sent_at: number | null;
  error: string | null;
}

export interface JobRow {
  id: string;
  type: string;
  payload_enc: string;
  run_at: number;
  status: string;
  attempts: number;
  created_at: number;
  updated_at: number;
}

export interface UsageRecord {
  id?: string;
  ts: number;
  session_id?: string | null;
  provider_id?: string | null;
  model_id?: string | null;
  purpose: string;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
  image_tokens?: number;
  cost: number;
  cost_native?: number;
  currency?: string;
  latency_ms?: number;
  estimated?: boolean;
  request_id?: string | null;
  capability_path?: string | null;
}

export interface ModelPreset {
  id: string;
  name?: string;
  context?: number;
  maxOutput?: number;
  input?: string[];
  output?: string[];
  features?: string[];
  pricing?: Record<string, any> | null;
  status?: string;
  successor?: string;
  source?: string;
}

export interface ProviderPreset {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  docs?: string;
  headers?: Record<string, string>;
  models?: ModelPreset[];
}

function now(): number {
  return Date.now();
}

function json<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class Store {
  readonly db: Database.Database;
  readonly keys: KeySet;

  constructor(db: Database.Database, keys: KeySet) {
    this.db = db;
    this.keys = keys;
  }

  close(): void {
    this.db.close();
  }

  private enc(value: string, aad: string): string {
    return encryptField(value, this.keys.field, aad);
  }

  private dec(value: string | null, aad: string): string {
    if (!value) return '';
    try {
      return decryptField(value, this.keys.field, aad);
    } catch {
      return '';
    }
  }

  private factHash(subject: string, predicate: string, object: string): string {
    const normalized = `${subject.trim().toLowerCase()}|${predicate.trim().toLowerCase()}|${object.trim().toLowerCase()}`;
    return crypto.createHmac('sha256', this.keys.field).update(normalized).digest('hex');
  }

  // ── settings ────────────────────────────────────────────────────────────

  getSetting(key: string, fallback = ''): string {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? fallback;
  }

  getSettingInt(key: string, fallback: number): number {
    const n = Number(this.getSetting(key, String(fallback)));
    return Number.isFinite(n) ? n : fallback;
  }

  getSettingBool(key: string, fallback = false): boolean {
    const v = this.getSetting(key, fallback ? '1' : '0');
    return v === '1' || v === 'true';
  }

  getJson<T>(key: string, fallback: T): T {
    return json(this.getSetting(key, ''), fallback);
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings(key, value, updated_at) VALUES(?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, now());
  }

  setJson(key: string, value: unknown): void {
    this.setSetting(key, JSON.stringify(value));
  }

  deleteSetting(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }

  getSecretSetting(key: string): string {
    const enc = this.getSetting(`${key}:enc`, '');
    return this.dec(enc, `settings:${key}`);
  }

  setSecretSetting(key: string, value: string): void {
    if (!value) {
      this.deleteSetting(`${key}:enc`);
      return;
    }
    this.setSetting(`${key}:enc`, this.enc(value, `settings:${key}`));
  }

  // ── admin / auth ────────────────────────────────────────────────────────

  getAdminByUsername(username: string): any {
    return this.db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  }

  getAdminById(id: string): any {
    return this.db.prepare('SELECT * FROM admin_users WHERE id = ?').get(id);
  }

  createAdmin(username: string, passwordHash: string, mustChange = true): string {
    const id = crypto.randomUUID();
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO admin_users(id, username, password_hash, must_change_password, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?)`,
      )
      .run(id, username, passwordHash, mustChange ? 1 : 0, ts, ts);
    return id;
  }

  updateAdminPassword(id: string, passwordHash: string, mustChange = false): void {
    this.db
      .prepare('UPDATE admin_users SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?')
      .run(passwordHash, mustChange ? 1 : 0, now(), id);
  }

  // ── admin sessions ──────────────────────────────────────────────────────

  createAdminSession(input: {
    userId: string;
    tokenHash: string;
    csrfToken: string;
    expiresAt: number;
    ip?: string;
    userAgent?: string;
  }): string {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO admin_sessions(id, user_id, token_hash, csrf_token, created_at, expires_at, ip, user_agent)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.tokenHash,
        input.csrfToken,
        now(),
        input.expiresAt,
        input.ip ?? null,
        input.userAgent ?? null,
      );
    return id;
  }

  getAdminSession(tokenHash: string): any {
    return this.db
      .prepare(
        `SELECT s.*, u.username, u.must_change_password
         FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(tokenHash, now());
  }

  deleteAdminSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash);
  }

  deleteAllAdminSessions(userId: string): void {
    this.db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(userId);
  }

  purgeExpiredSessions(): void {
    this.db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now());
  }

  // ── providers / models ──────────────────────────────────────────────────

  listProviders(): ProviderRow[] {
    return this.db.prepare('SELECT * FROM providers ORDER BY is_preset DESC, name').all() as ProviderRow[];
  }

  getProvider(id: string): ProviderRow | undefined {
    return this.db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as ProviderRow | undefined;
  }

  upsertProviderPreset(preset: ProviderPreset): void {
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO providers(id, name, kind, base_url, enabled, is_preset, docs_url, extra_headers_json, created_at, updated_at)
         VALUES(?, ?, ?, ?, 0, 1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           docs_url = excluded.docs_url,
           extra_headers_json = excluded.extra_headers_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        preset.id,
        preset.name,
        preset.kind,
        preset.baseUrl,
        preset.docs ?? null,
        preset.headers ? JSON.stringify(preset.headers) : null,
        ts,
        ts,
      );
  }

  setProviderKey(id: string, plaintext: string): void {
    const enc = plaintext ? this.enc(plaintext, `providers:${id}:api_key`) : null;
    this.db.prepare('UPDATE providers SET api_key_enc = ?, updated_at = ? WHERE id = ?').run(enc, now(), id);
  }

  getProviderApiKey(id: string): string {
    const row = this.getProvider(id);
    return this.dec(row?.api_key_enc ?? null, `providers:${id}:api_key`);
  }

  providerHasKey(id: string): boolean {
    return Boolean(this.getProvider(id)?.api_key_enc);
  }

  setProviderEnabled(id: string, enabled: boolean): void {
    this.db.prepare('UPDATE providers SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, now(), id);
  }

  setProviderBaseUrl(id: string, baseUrl: string): void {
    this.db.prepare('UPDATE providers SET base_url = ?, updated_at = ? WHERE id = ?').run(baseUrl, now(), id);
  }

  addCustomProvider(input: { id: string; name: string; kind: string; baseUrl: string; apiKey?: string }): void {
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO providers(id, name, kind, base_url, enabled, is_preset, created_at, updated_at)
         VALUES(?, ?, ?, ?, 1, 0, ?, ?)`,
      )
      .run(input.id, input.name, input.kind, input.baseUrl, ts, ts);
    if (input.apiKey) this.setProviderKey(input.id, input.apiKey);
  }

  deleteProvider(id: string): void {
    this.db.prepare('DELETE FROM models WHERE provider_id = ?').run(id);
    this.db.prepare('DELETE FROM providers WHERE id = ?').run(id);
  }

  listModels(providerId?: string): ModelRow[] {
    if (providerId) {
      return this.db.prepare('SELECT * FROM models WHERE provider_id = ? ORDER BY display_name').all(providerId) as ModelRow[];
    }
    return this.db.prepare('SELECT * FROM models ORDER BY provider_id, display_name').all() as ModelRow[];
  }

  getModel(id: string): ModelRow | undefined {
    return this.db.prepare('SELECT * FROM models WHERE id = ?').get(id) as ModelRow | undefined;
  }

  upsertModelPreset(providerId: string, model: ModelPreset): void {
    const id = `${providerId}:${model.id}`;
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO models(id, provider_id, model_id, display_name, context_window, max_output,
           input_json, output_json, features_json, pricing_json, status, successor, source_url, verified_at, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           context_window = excluded.context_window,
           max_output = excluded.max_output,
           input_json = excluded.input_json,
           output_json = excluded.output_json,
           features_json = excluded.features_json,
           pricing_json = excluded.pricing_json,
           status = excluded.status,
           successor = excluded.successor,
           source_url = excluded.source_url,
           verified_at = excluded.verified_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        providerId,
        model.id,
        model.name ?? model.id,
        model.context ?? 32768,
        model.maxOutput ?? 4096,
        JSON.stringify(model.input ?? ['text']),
        JSON.stringify(model.output ?? ['text']),
        JSON.stringify(model.features ?? []),
        model.pricing ? JSON.stringify(model.pricing) : null,
        model.status ?? 'active',
        model.successor ?? null,
        model.source ?? null,
        model.source ? ts : null,
        ts,
        ts,
      );
  }

  addCustomModel(input: {
    providerId: string;
    modelId: string;
    displayName?: string;
    context?: number;
    maxOutput?: number;
    input?: string[];
    features?: string[];
    pricing?: Record<string, any> | null;
  }): string {
    const id = `${input.providerId}:${input.modelId}`;
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO models(id, provider_id, model_id, display_name, context_window, max_output,
           input_json, output_json, features_json, pricing_json, status, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, '["text"]', ?, ?, 'active', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           context_window = excluded.context_window,
           max_output = excluded.max_output,
           input_json = excluded.input_json,
           features_json = excluded.features_json,
           pricing_json = excluded.pricing_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        input.providerId,
        input.modelId,
        input.displayName ?? input.modelId,
        input.context ?? 32768,
        input.maxOutput ?? 4096,
        JSON.stringify(input.input ?? ['text']),
        JSON.stringify(input.features ?? []),
        input.pricing ? JSON.stringify(input.pricing) : null,
        ts,
        ts,
      );
    return id;
  }

  deleteModel(id: string): void {
    this.db.prepare('DELETE FROM models WHERE id = ?').run(id);
  }

  saveProbe(id: string, probe: Record<string, any>): void {
    this.db
      .prepare('UPDATE models SET probe_json = ?, verified_at = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(probe), now(), now(), id);
  }

  setCapabilitiesOverride(id: string, override: Record<string, any> | null): void {
    this.db
      .prepare('UPDATE models SET capabilities_override_json = ?, updated_at = ? WHERE id = ?')
      .run(override ? JSON.stringify(override) : null, now(), id);
  }

  getRoleBindings(): Array<{ role: ModelRole; model_ref: string | null; fallback_refs_json: string; options_json: string }> {
    return this.db.prepare('SELECT * FROM role_bindings').all() as any[];
  }

  getRoleBinding(role: ModelRole): { role: ModelRole; model_ref: string | null; fallback_refs_json: string; options_json: string } | undefined {
    return this.db.prepare('SELECT * FROM role_bindings WHERE role = ?').get(role) as any;
  }

  setRoleBinding(role: ModelRole, modelRef: string | null, fallbackRefs: string[] = [], options: Record<string, any> = {}): void {
    this.db
      .prepare(
        `INSERT INTO role_bindings(role, model_ref, fallback_refs_json, options_json, updated_at)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(role) DO UPDATE SET
           model_ref = excluded.model_ref,
           fallback_refs_json = excluded.fallback_refs_json,
           options_json = excluded.options_json,
           updated_at = excluded.updated_at`,
      )
      .run(role, modelRef, JSON.stringify(fallbackRefs), JSON.stringify(options), now());
  }

  // ── personas ────────────────────────────────────────────────────────────

  listPersonas(): any[] {
    return this.db.prepare('SELECT * FROM personas ORDER BY updated_at DESC').all();
  }

  getPersona(id: string): any {
    return this.db.prepare('SELECT * FROM personas WHERE id = ?').get(id);
  }

  getActivePersona(): any {
    const id = this.getSetting('active_persona_id', '');
    return (id && this.getPersona(id)) || this.db.prepare('SELECT * FROM personas ORDER BY created_at LIMIT 1').get();
  }

  createPersona(input: {
    name: string;
    description?: string;
    systemPrompt: string;
    styleExamples?: string;
    boundaries?: string;
    noVisionLines?: string;
    voiceStyle?: string;
  }): string {
    const id = crypto.randomUUID();
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO personas(id, name, description, system_prompt, style_examples, boundaries, no_vision_lines, voice_style, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.description ?? '',
        input.systemPrompt,
        input.styleExamples ?? '',
        input.boundaries ?? '',
        input.noVisionLines ?? '',
        input.voiceStyle ?? '',
        ts,
        ts,
      );
    return id;
  }

  updatePersona(id: string, input: {
    name: string;
    description?: string;
    systemPrompt: string;
    styleExamples?: string;
    boundaries?: string;
    noVisionLines?: string;
    voiceStyle?: string;
  }): void {
    const existing = this.getPersona(id);
    if (existing) {
      const version = (this.db.prepare('SELECT COALESCE(MAX(version),0) AS v FROM persona_versions WHERE persona_id = ?').get(id) as any).v + 1;
      this.db
        .prepare('INSERT INTO persona_versions(id, persona_id, version, snapshot_json, created_at) VALUES(?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), id, version, JSON.stringify(existing), now());
    }
    this.db
      .prepare(
        `UPDATE personas SET name = ?, description = ?, system_prompt = ?, style_examples = ?, boundaries = ?,
           no_vision_lines = ?, voice_style = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        input.name,
        input.description ?? '',
        input.systemPrompt,
        input.styleExamples ?? '',
        input.boundaries ?? '',
        input.noVisionLines ?? '',
        input.voiceStyle ?? '',
        now(),
        id,
      );
  }

  listPersonaVersions(personaId: string): any[] {
    return this.db
      .prepare('SELECT id, persona_id, version, created_at FROM persona_versions WHERE persona_id = ? ORDER BY version DESC')
      .all(personaId);
  }

  // ── policy ──────────────────────────────────────────────────────────────

  listPolicy(): any[] {
    return this.db.prepare('SELECT * FROM policy_entries ORDER BY scope, action, target_id').all();
  }

  upsertPolicy(input: { scope: string; action: string; targetId: string; note?: string; enabled?: boolean }): string {
    const existing = this.db
      .prepare('SELECT id FROM policy_entries WHERE scope = ? AND action = ? AND target_id = ?')
      .get(input.scope, input.action, input.targetId) as { id: string } | undefined;
    if (existing) {
      this.db
        .prepare('UPDATE policy_entries SET note = ?, enabled = ? WHERE id = ?')
        .run(input.note ?? '', input.enabled === false ? 0 : 1, existing.id);
      return existing.id;
    }
    const id = crypto.randomUUID();
    this.db
      .prepare('INSERT INTO policy_entries(id, scope, action, target_id, note, enabled, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.scope, input.action, input.targetId, input.note ?? '', input.enabled === false ? 0 : 1, now());
    return id;
  }

  deletePolicy(id: string): void {
    this.db.prepare('DELETE FROM policy_entries WHERE id = ?').run(id);
  }

  // ── sessions / messages ─────────────────────────────────────────────────

  getOrCreateSession(accountId: string, kind: SessionKind, peerId: string, groupId?: string): SessionRow {
    const existing = this.db
      .prepare('SELECT * FROM sessions WHERE account_id = ? AND kind = ? AND peer_id = ?')
      .get(accountId, kind, peerId) as SessionRow | undefined;
    if (existing) return existing;
    const id = crypto.randomUUID();
    const ts = now();
    const mode = kind === 'group' ? 'mention_only' : 'normal';
    this.db
      .prepare(
        `INSERT INTO sessions(id, account_id, kind, peer_id, group_id, mode, settings_json, last_active_at, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
      )
      .run(id, accountId, kind, peerId, groupId ?? null, mode, ts, ts, ts);
    this.db
      .prepare('INSERT OR IGNORE INTO relationship_state(session_id, updated_at) VALUES(?, ?)')
      .run(id, ts);
    return this.getSession(id)!;
  }

  getSession(id: string): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  }

  findSession(accountId: string, kind: SessionKind, peerId: string): SessionRow | undefined {
    return this.db
      .prepare('SELECT * FROM sessions WHERE account_id = ? AND kind = ? AND peer_id = ?')
      .get(accountId, kind, peerId) as SessionRow | undefined;
  }

  listSessions(limit = 100): any[] {
    return this.db
      .prepare(
        `SELECT s.id, s.account_id, s.kind, s.peer_id, s.group_id, s.persona_id, s.mode,
           s.settings_json, s.summary_tokens, s.last_active_at, s.created_at, s.updated_at,
           (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count,
           (SELECT MAX(created_at) FROM messages m WHERE m.session_id = s.id) AS last_message_at
         FROM sessions s ORDER BY s.last_active_at DESC LIMIT ?`,
      )
      .all(limit);
  }

  touchSession(id: string): void {
    this.db.prepare('UPDATE sessions SET last_active_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
  }

  updateSession(id: string, patch: { mode?: string; settingsJson?: string; personaId?: string | null }): void {
    const current = this.getSession(id);
    if (!current) return;
    this.db
      .prepare('UPDATE sessions SET mode = ?, settings_json = ?, persona_id = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.mode ?? current.mode,
        patch.settingsJson ?? current.settings_json,
        patch.personaId === undefined ? current.persona_id : patch.personaId,
        now(),
        id,
      );
  }

  addMessage(input: {
    id?: string;
    sessionId: string;
    accountId: string;
    direction: Direction;
    senderId: string;
    senderName?: string;
    messageId?: string | null;
    replyTo?: string | null;
    segments: any[];
    text: string;
    tokens?: number;
    modelRef?: string | null;
    capabilityPath?: string | null;
    createdAt?: number;
  }): string {
    const id = input.id ?? crypto.randomUUID();
    const ts = input.createdAt ?? now();
    this.db
      .prepare(
        `INSERT INTO messages(id, session_id, account_id, direction, sender_id, sender_name_enc, message_id, reply_to,
           segments_enc, text_enc, tokens, model_ref, capability_path, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.accountId,
        input.direction,
        input.senderId,
        this.enc(input.senderName ?? '', `messages:${id}:sender`),
        input.messageId ?? null,
        input.replyTo ?? null,
        this.enc(JSON.stringify(input.segments ?? []), `messages:${id}:segments`),
        this.enc(input.text ?? '', `messages:${id}:text`),
        input.tokens ?? 0,
        input.modelRef ?? null,
        input.capabilityPath ?? null,
        ts,
      );
    this.db.prepare('UPDATE sessions SET last_active_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, input.sessionId);
    return id;
  }

  private hydrateMessage(row: MessageRow): MessageRecord {
    const { segments_enc, text_enc, sender_name_enc, ...rest } = row;
    return {
      ...rest,
      segments: json<any[]>(this.dec(segments_enc, `messages:${row.id}:segments`), []),
      text: this.dec(text_enc, `messages:${row.id}:text`),
      sender_name: this.dec(sender_name_enc, `messages:${row.id}:sender`),
    };
  }

  listMessages(sessionId: string, limit = 100, before?: number): MessageRecord[] {
    const rows = before
      ? (this.db
          .prepare('SELECT * FROM messages WHERE session_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?')
          .all(sessionId, before, limit) as MessageRow[])
      : (this.db
          .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?')
          .all(sessionId, limit) as MessageRow[]);
    return rows.reverse().map((r) => this.hydrateMessage(r));
  }

  listRecentMessages(sessionId: string, limit = 40): MessageRecord[] {
    return this.listMessages(sessionId, limit);
  }

  countMessages(sessionId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM messages WHERE session_id = ?').get(sessionId) as any).c;
  }

  getSessionSummary(sessionId: string): string {
    const row = this.getSession(sessionId);
    return row ? this.dec(row.summary_enc, `sessions:${sessionId}:summary`) : '';
  }

  setSessionSummary(sessionId: string, summary: string, tokens: number): void {
    const enc = summary ? this.enc(summary, `sessions:${sessionId}:summary`) : null;
    this.db.prepare('UPDATE sessions SET summary_enc = ?, summary_tokens = ?, updated_at = ? WHERE id = ?').run(enc, tokens, now(), sessionId);
  }

  resetSession(sessionId: string): void {
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM memory_facts WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM memory_episodes WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM diaries WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM open_loops WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM outbox WHERE session_id = ? AND status = ?').run(sessionId, 'pending');
    this.db.prepare('UPDATE sessions SET summary_enc = NULL, summary_tokens = 0 WHERE id = ?').run(sessionId);
  }

  // ── relationship ────────────────────────────────────────────────────────

  getRelationship(sessionId: string): any {
    return (
      this.db.prepare('SELECT * FROM relationship_state WHERE session_id = ?').get(sessionId) ?? {
        session_id: sessionId,
        affinity: 0.2,
        trust: 0.3,
        mood: 'neutral',
        energy: 0.7,
        last_interaction_at: null,
      }
    );
  }

  updateRelationship(sessionId: string, patch: { affinity?: number; trust?: number; mood?: string; energy?: number }): void {
    const current = this.getRelationship(sessionId);
    this.db
      .prepare(
        `INSERT INTO relationship_state(session_id, affinity, trust, mood, energy, last_interaction_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           affinity = excluded.affinity, trust = excluded.trust, mood = excluded.mood,
           energy = excluded.energy, last_interaction_at = excluded.last_interaction_at, updated_at = excluded.updated_at`,
      )
      .run(
        sessionId,
        patch.affinity ?? current.affinity,
        patch.trust ?? current.trust,
        patch.mood ?? current.mood,
        patch.energy ?? current.energy,
        now(),
        now(),
      );
  }

  // ── memory ──────────────────────────────────────────────────────────────

  upsertFact(input: {
    sessionId: string;
    subject: string;
    predicate: string;
    object: string;
    confidence?: number;
    importance?: number;
    sourceMessageIds?: string[];
  }): string {
    const hash = this.factHash(input.subject, input.predicate, input.object);
    const existing = this.db
      .prepare('SELECT id FROM memory_facts WHERE session_id = ? AND fact_hash = ?')
      .get(input.sessionId, hash) as { id: string } | undefined;
    if (existing) {
      this.db
        .prepare('UPDATE memory_facts SET confidence = ?, importance = ?, updated_at = ? WHERE id = ?')
        .run(input.confidence ?? 0.7, input.importance ?? 0.5, now(), existing.id);
      return existing.id;
    }
    const id = crypto.randomUUID();
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO memory_facts(id, session_id, fact_hash, subject_enc, predicate_enc, object_enc, confidence, importance,
           source_message_ids, status, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        hash,
        this.enc(input.subject, `facts:${id}:subject`),
        this.enc(input.predicate, `facts:${id}:predicate`),
        this.enc(input.object, `facts:${id}:object`),
        input.confidence ?? 0.7,
        input.importance ?? 0.5,
        JSON.stringify(input.sourceMessageIds ?? []),
        ts,
        ts,
      );
    return id;
  }

  listFacts(sessionId: string, limit = 40): FactRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM memory_facts WHERE session_id = ? AND status = ? ORDER BY importance DESC, updated_at DESC LIMIT ?')
      .all(sessionId, 'active', limit) as any[];
    return rows.map((r) => {
      const { subject_enc, predicate_enc, object_enc, fact_hash, ...rest } = r;
      return {
        ...rest,
        subject: this.dec(subject_enc, `facts:${r.id}:subject`),
        predicate: this.dec(predicate_enc, `facts:${r.id}:predicate`),
        object: this.dec(object_enc, `facts:${r.id}:object`),
        source_message_ids: json(r.source_message_ids, []),
      };
    });
  }

  searchFacts(sessionId: string, query: string, limit = 8): FactRecord[] {
    const q = query.toLowerCase();
    return this.listFacts(sessionId, 200)
      .filter((f) => `${f.subject}${f.predicate}${f.object}`.toLowerCase().includes(q))
      .slice(0, limit);
  }

  deleteFact(id: string): void {
    this.db.prepare('DELETE FROM memory_facts WHERE id = ?').run(id);
  }

  addEpisode(input: {
    sessionId: string;
    title: string;
    summary: string;
    participants?: string[];
    valence?: number;
    importance?: number;
    sourceMessageIds?: string[];
  }): string {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO memory_episodes(id, session_id, title_enc, summary_enc, participants, valence, importance, source_message_ids, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        this.enc(input.title, `episodes:${id}:title`),
        this.enc(input.summary, `episodes:${id}:summary`),
        JSON.stringify(input.participants ?? []),
        input.valence ?? 0,
        input.importance ?? 0.5,
        JSON.stringify(input.sourceMessageIds ?? []),
        now(),
      );
    return id;
  }

  listEpisodes(sessionId: string, limit = 10): EpisodeRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM memory_episodes WHERE session_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(sessionId, limit) as any[];
    return rows.map((r) => {
      const { title_enc, summary_enc, ...rest } = r;
      return {
        ...rest,
        title: this.dec(title_enc, `episodes:${r.id}:title`),
        summary: this.dec(summary_enc, `episodes:${r.id}:summary`),
        participants: json(r.participants, []),
        source_message_ids: json(r.source_message_ids, []),
      };
    });
  }

  upsertDiary(input: { sessionId: string; date: string; content: string; mood?: string; importance?: number }): void {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO diaries(id, session_id, date, content_enc, mood, importance, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, date) DO UPDATE SET
           content_enc = excluded.content_enc, mood = excluded.mood, importance = excluded.importance, created_at = excluded.created_at`,
      )
      .run(
        id,
        input.sessionId,
        input.date,
        this.enc(input.content, `diaries:${input.sessionId}:${input.date}`),
        input.mood ?? '',
        input.importance ?? 0.6,
        now(),
      );
  }

  listDiaries(sessionId: string, limit = 10): DiaryRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM diaries WHERE session_id = ? ORDER BY date DESC LIMIT ?')
      .all(sessionId, limit) as any[];
    return rows.map((r) => {
      const { content_enc, ...rest } = r;
      return {
        ...rest,
        content: this.dec(content_enc, `diaries:${r.session_id}:${r.date}`),
      };
    });
  }

  deleteDiary(id: string): void {
    this.db.prepare('DELETE FROM diaries WHERE id = ?').run(id);
  }

  upsertOpenLoop(input: { sessionId: string; topic: string; detail: string; dueHint?: string; sourceMessageId?: string }): string {
    const id = crypto.randomUUID();
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO open_loops(id, session_id, topic_enc, detail_enc, status, due_hint, source_message_id, created_at, updated_at)
         VALUES(?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        this.enc(input.topic, `loops:${id}:topic`),
        this.enc(input.detail, `loops:${id}:detail`),
        input.dueHint ?? null,
        input.sourceMessageId ?? null,
        ts,
        ts,
      );
    return id;
  }

  listOpenLoops(sessionId: string, status = 'open', limit = 10): OpenLoopRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM open_loops WHERE session_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?')
      .all(sessionId, status, limit) as any[];
    return rows.map((r) => {
      const { topic_enc, detail_enc, ...rest } = r;
      return {
        ...rest,
        topic: this.dec(topic_enc, `loops:${r.id}:topic`),
        detail: this.dec(detail_enc, `loops:${r.id}:detail`),
      };
    });
  }

  closeOpenLoop(id: string): void {
    this.db.prepare('UPDATE open_loops SET status = ?, updated_at = ? WHERE id = ?').run('closed', now(), id);
  }

  // ── outbox / jobs ───────────────────────────────────────────────────────

  enqueueOutbox(input: {
    sessionId: string;
    accountId: string;
    kind: string;
    payload: any;
    dueAt: number;
    idempotencyKey?: string | null;
  }): string {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO outbox(id, session_id, account_id, kind, payload_enc, due_at, status, attempts, idempotency_key, created_at)
         VALUES(?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.accountId,
        input.kind,
        this.enc(JSON.stringify(input.payload), `outbox:${id}`),
        input.dueAt,
        input.idempotencyKey ?? null,
        now(),
      );
    return id;
  }

  listDueOutbox(nowTs: number, limit = 10): Array<OutboxRow & { payload: any }> {
    const rows = this.db
      .prepare("SELECT * FROM outbox WHERE status = 'pending' AND due_at <= ? ORDER BY due_at LIMIT ?")
      .all(nowTs, limit) as OutboxRow[];
    return rows.map((r) => ({ ...r, payload: json(this.dec(r.payload_enc, `outbox:${r.id}`), {}) }));
  }

  retryOutbox(id: string, dueAt: number, error: string): void {
    this.db
      .prepare("UPDATE outbox SET attempts = attempts + 1, due_at = ?, error = ?, status = 'pending' WHERE id = ?")
      .run(dueAt, error.slice(0, 500), id);
  }

  markOutbox(id: string, status: string, error?: string): void {
    this.db
      .prepare('UPDATE outbox SET status = ?, error = ?, attempts = attempts + 1, sent_at = ? WHERE id = ?')
      .run(status, error ?? null, status === 'sent' ? now() : null, id);
  }

  cancelPendingOutbox(sessionId: string, kind?: string): number {
    const row = kind
      ? this.db.prepare("UPDATE outbox SET status = 'cancelled' WHERE session_id = ? AND status = 'pending' AND kind = ?").run(sessionId, kind)
      : this.db.prepare("UPDATE outbox SET status = 'cancelled' WHERE session_id = ? AND status = 'pending'").run(sessionId);
    return row.changes;
  }

  countPendingOutbox(sessionId: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM outbox WHERE session_id = ? AND status = 'pending'").get(sessionId) as any).c;
  }

  enqueueJob(type: string, payload: any, runAt = now()): string {
    const id = crypto.randomUUID();
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO jobs(id, type, payload_enc, run_at, status, attempts, created_at, updated_at)
         VALUES(?, ?, ?, ?, 'pending', 0, ?, ?)`,
      )
      .run(id, type, this.enc(JSON.stringify(payload), `jobs:${id}`), runAt, ts, ts);
    return id;
  }

  listDueJobs(nowTs: number, limit = 5): Array<JobRow & { payload: any }> {
    const rows = this.db
      .prepare("SELECT * FROM jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at LIMIT ?")
      .all(nowTs, limit) as JobRow[];
    return rows.map((r) => ({ ...r, payload: json(this.dec(r.payload_enc, `jobs:${r.id}`), {}) }));
  }

  markJob(id: string, status: string): void {
    this.db
      .prepare('UPDATE jobs SET status = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?')
      .run(status, now(), id);
  }

  // ── usage / budget ──────────────────────────────────────────────────────

  recordUsage(record: UsageRecord): string {
    const id = record.id ?? crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO usage_logs(id, ts, session_id, provider_id, model_id, purpose, prompt_tokens, completion_tokens,
           cached_tokens, reasoning_tokens, image_tokens, cost, cost_native, currency, latency_ms, estimated, request_id, capability_path)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        record.ts,
        record.session_id ?? null,
        record.provider_id ?? null,
        record.model_id ?? null,
        record.purpose,
        record.prompt_tokens ?? 0,
        record.completion_tokens ?? 0,
        record.cached_tokens ?? 0,
        record.reasoning_tokens ?? 0,
        record.image_tokens ?? 0,
        record.cost ?? 0,
        record.cost_native ?? 0,
        record.currency ?? 'CNY',
        record.latency_ms ?? 0,
        record.estimated ? 1 : 0,
        record.request_id ?? null,
        record.capability_path ?? null,
      );
    return id;
  }

  usageSummary(sinceTs: number): any {
    const rows = this.db
      .prepare('SELECT * FROM usage_logs WHERE ts >= ? ORDER BY ts')
      .all(sinceTs) as any[];
    const total = {
      calls: rows.length,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      imageTokens: 0,
      cost: 0,
      estimated: 0,
    };
    const byPurpose: Record<string, any> = {};
    const byModel: Record<string, any> = {};
    const bySession: Record<string, any> = {};
    for (const row of rows) {
      total.promptTokens += row.prompt_tokens;
      total.completionTokens += row.completion_tokens;
      total.cachedTokens += row.cached_tokens;
      total.reasoningTokens += row.reasoning_tokens;
      total.imageTokens += row.image_tokens;
      total.cost += row.cost;
      total.estimated += row.estimated;
      const p = (byPurpose[row.purpose] ??= { purpose: row.purpose, calls: 0, cost: 0, tokens: 0 });
      p.calls += 1;
      p.cost += row.cost;
      p.tokens += row.prompt_tokens + row.completion_tokens;
      const m = (byModel[row.model_id ?? 'unknown'] ??= { model: row.model_id ?? 'unknown', calls: 0, cost: 0, tokens: 0 });
      m.calls += 1;
      m.cost += row.cost;
      m.tokens += row.prompt_tokens + row.completion_tokens;
      if (row.session_id) {
        const s = (bySession[row.session_id] ??= { sessionId: row.session_id, calls: 0, cost: 0 });
        s.calls += 1;
        s.cost += row.cost;
      }
    }
    return {
      total,
      byPurpose: Object.values(byPurpose),
      byModel: Object.values(byModel),
      bySession: Object.values(bySession),
    };
  }

  usageTimeseries(days = 7, timezone = 'UTC'): any[] {
    const localKey = (date: Date) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    const start = new Date(Date.now() - (days - 1) * 24 * 3600_000);
    const rows = this.db.prepare('SELECT * FROM usage_logs WHERE ts >= ? ORDER BY ts').all(start.getTime() - 24 * 3600_000) as any[];
    const out: Record<string, any> = {};
    for (let i = 0; i < days; i += 1) {
      const d = new Date(start.getTime() + i * 24 * 3600_000);
      const key = localKey(d);
      out[key] = { date: key, cost: 0, tokens: 0, calls: 0 };
    }
    for (const row of rows) {
      const key = localKey(new Date(row.ts));
      if (!out[key]) continue;
      out[key].cost += row.cost;
      out[key].tokens += row.prompt_tokens + row.completion_tokens;
      out[key].calls += 1;
    }
    return Object.values(out);
  }

  getBudgetRow(date: string, scope: string, key: string): any {
    return this.db.prepare('SELECT * FROM budget_ledger WHERE date = ? AND scope = ? AND key = ?').get(date, scope, key);
  }

  reserveBudget(input: {
    date: string;
    scope: string;
    key: string;
    cost: number;
    tokens: number;
    capCost: number;
    capTokens: number;
  }): boolean {
    const tx = this.db.transaction(() => {
      const row = this.getBudgetRow(input.date, input.scope, input.key);
      const spentCost = row?.spent_cost ?? 0;
      const spentTokens = row?.spent_tokens ?? 0;
      const reservedCost = row?.reserved_cost ?? 0;
      const reservedTokens = row?.reserved_tokens ?? 0;
      if (input.capCost > 0 && spentCost + reservedCost + input.cost > input.capCost) return false;
      if (input.capTokens > 0 && spentTokens + reservedTokens + input.tokens > input.capTokens) return false;
      this.db
        .prepare(
          `INSERT INTO budget_ledger(date, scope, key, spent_cost, spent_tokens, reserved_cost, reserved_tokens, updated_at)
           VALUES(?, ?, ?, 0, 0, ?, ?, ?)
           ON CONFLICT(date, scope, key) DO UPDATE SET
             reserved_cost = reserved_cost + excluded.reserved_cost,
             reserved_tokens = reserved_tokens + excluded.reserved_tokens,
             updated_at = excluded.updated_at`,
        )
        .run(input.date, input.scope, input.key, input.cost, input.tokens, now());
      return true;
    });
    return tx();
  }

  settleBudget(input: {
    date: string;
    scope: string;
    key: string;
    reservedCost: number;
    reservedTokens: number;
    actualCost: number;
    actualTokens: number;
  }): void {
    this.db
      .prepare(
        `UPDATE budget_ledger SET
           reserved_cost = MAX(0, reserved_cost - ?),
           reserved_tokens = MAX(0, reserved_tokens - ?),
           spent_cost = spent_cost + ?,
           spent_tokens = spent_tokens + ?,
           updated_at = ?
         WHERE date = ? AND scope = ? AND key = ?`,
      )
      .run(
        input.reservedCost,
        input.reservedTokens,
        input.actualCost,
        input.actualTokens,
        now(),
        input.date,
        input.scope,
        input.key,
      );
  }

  releaseBudget(date: string, scope: string, key: string, reservedCost: number, reservedTokens: number): void {
    this.db
      .prepare(
        `UPDATE budget_ledger SET
           reserved_cost = MAX(0, reserved_cost - ?),
           reserved_tokens = MAX(0, reserved_tokens - ?),
           updated_at = ?
         WHERE date = ? AND scope = ? AND key = ?`,
      )
      .run(reservedCost, reservedTokens, now(), date, scope, key);
  }

  todayBudget(date: string): { cost: number; tokens: number } {
    const row = this.getBudgetRow(date, 'global', 'all') as any;
    return {
      cost: (row?.spent_cost ?? 0) + (row?.reserved_cost ?? 0),
      tokens: (row?.spent_tokens ?? 0) + (row?.reserved_tokens ?? 0),
    };
  }

  // ── stickers / media / audit ────────────────────────────────────────────

  addSticker(input: { filePath: string; tags?: string; emotion?: string; source?: string }): string {
    const id = crypto.randomUUID();
    this.db
      .prepare('INSERT INTO stickers(id, file_path, tags, emotion, source, created_at) VALUES(?, ?, ?, ?, ?, ?)')
      .run(id, input.filePath, input.tags ?? '', input.emotion ?? '', input.source ?? 'manual', now());
    return id;
  }

  listStickers(): any[] {
    return this.db.prepare('SELECT * FROM stickers ORDER BY created_at DESC').all();
  }

  deleteSticker(id: string): void {
    this.db.prepare('DELETE FROM stickers WHERE id = ?').run(id);
  }

  pickSticker(emotion?: string): any {
    const rows = emotion
      ? (this.db.prepare('SELECT * FROM stickers WHERE emotion = ? OR tags LIKE ? ORDER BY RANDOM() LIMIT 1').all(emotion, `%${emotion}%`) as any[])
      : (this.db.prepare('SELECT * FROM stickers ORDER BY RANDOM() LIMIT 1').all() as any[]);
    return rows[0];
  }

  bumpStickerUsage(id: string): void {
    this.db.prepare('UPDATE stickers SET usage_count = usage_count + 1 WHERE id = ?').run(id);
  }

  upsertMedia(input: { sha256: string; path: string; mime: string; size: number; kind?: string; description?: string; tags?: string }): string {
    const existing = this.db.prepare('SELECT * FROM media_assets WHERE sha256 = ?').get(input.sha256) as any;
    if (existing) return existing.id;
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO media_assets(id, sha256, path, mime, size, kind, description_enc, tags, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sha256,
        input.path,
        input.mime,
        input.size,
        input.kind ?? 'image',
        input.description ? this.enc(input.description, `media:${id}:description`) : null,
        input.tags ?? '',
        now(),
      );
    return id;
  }

  getMediaDescription(sha256: string): string {
    const row = this.db.prepare('SELECT * FROM media_assets WHERE sha256 = ?').get(sha256) as any;
    if (!row?.description_enc) return '';
    return this.dec(row.description_enc, `media:${row.id}:description`);
  }

  setMediaDescription(sha256: string, description: string): void {
    const row = this.db.prepare('SELECT * FROM media_assets WHERE sha256 = ?').get(sha256) as any;
    if (!row) return;
    this.db
      .prepare('UPDATE media_assets SET description_enc = ? WHERE id = ?')
      .run(this.enc(description, `media:${row.id}:description`), row.id);
  }

  audit(actor: string, action: string, detail = '', ip?: string): void {
    this.db
      .prepare('INSERT INTO audit_logs(id, ts, actor, action, detail, ip) VALUES(?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), now(), actor, action, detail, ip ?? null);
  }

  listAudit(limit = 100): any[] {
    return this.db.prepare('SELECT * FROM audit_logs ORDER BY ts DESC LIMIT ?').all(limit);
  }

  listStickersForAdmin(): any[] {
    return this.listStickers();
  }

  isOutgoingMessageId(messageId: string): boolean {
    const row = this.db.prepare('SELECT direction FROM messages WHERE message_id = ? LIMIT 1').get(messageId) as any;
    return row?.direction === 'out';
  }

  // ── conversation counters ───────────────────────────────────────────────

  countOutgoingSince(sessionId: string, since: number): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS c FROM messages WHERE session_id = ? AND direction = 'out' AND created_at >= ?")
        .get(sessionId, since) as any
    ).c;
  }

  lastOutgoingAt(sessionId: string): number | null {
    const row = this.db
      .prepare("SELECT MAX(created_at) AS t FROM messages WHERE session_id = ? AND direction = 'out'")
      .get(sessionId) as any;
    return row?.t ?? null;
  }

  lastIncomingAt(sessionId: string): number | null {
    const row = this.db
      .prepare("SELECT MAX(created_at) AS t FROM messages WHERE session_id = ? AND direction = 'in'")
      .get(sessionId) as any;
    return row?.t ?? null;
  }

  countIncomingSince(sessionId: string, since: number): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS c FROM messages WHERE session_id = ? AND direction = 'in' AND created_at >= ?")
        .get(sessionId, since) as any
    ).c;
  }

  countOutboxByKindSince(sessionId: string, kind: string, since: number): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS c FROM outbox WHERE session_id = ? AND kind = ? AND created_at >= ?")
        .get(sessionId, kind, since) as any
    ).c;
  }

  countAllOutboxByKindSince(kind: string, since: number): number {
    return (
      this.db
        .prepare('SELECT COUNT(*) AS c FROM outbox WHERE kind = ? AND created_at >= ?')
        .get(kind, since) as any
    ).c;
  }

  // ── counters / status ───────────────────────────────────────────────────

  counts(): any {
    const one = (sql: string) => (this.db.prepare(sql).get() as any)?.c ?? 0;
    return {
      sessions: one('SELECT COUNT(*) AS c FROM sessions'),
      messages: one('SELECT COUNT(*) AS c FROM messages'),
      facts: one('SELECT COUNT(*) AS c FROM memory_facts'),
      diaries: one('SELECT COUNT(*) AS c FROM diaries'),
      pendingOutbox: one("SELECT COUNT(*) AS c FROM outbox WHERE status = 'pending'"),
      pendingJobs: one("SELECT COUNT(*) AS c FROM jobs WHERE status = 'pending'"),
    };
  }
}
