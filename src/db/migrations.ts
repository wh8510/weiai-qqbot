import type Database from 'better-sqlite3';

/**
 * v1 schema.
 *
 * Sensitive content is encrypted at the application layer before it reaches
 * SQLite. The database file itself is not SQLCipher-encrypted in the default
 * build because the cross-platform prebuilt native module is not available for
 * every Node version; see docs/security.md for the threat model and the
 * optional full-disk / SQLCipher deployment notes.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  totp_secret_enc TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_enc TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  is_preset INTEGER NOT NULL DEFAULT 1,
  docs_url TEXT,
  extra_headers_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  context_window INTEGER NOT NULL DEFAULT 32768,
  max_output INTEGER NOT NULL DEFAULT 4096,
  input_json TEXT NOT NULL DEFAULT '["text"]',
  output_json TEXT NOT NULL DEFAULT '["text"]',
  features_json TEXT NOT NULL DEFAULT '[]',
  pricing_json TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  successor TEXT,
  source_url TEXT,
  verified_at INTEGER,
  probe_json TEXT,
  capabilities_override_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider_id, model_id)
);
CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_id);

CREATE TABLE IF NOT EXISTS role_bindings (
  role TEXT PRIMARY KEY,
  model_ref TEXT,
  fallback_refs_json TEXT NOT NULL DEFAULT '[]',
  options_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL,
  style_examples TEXT NOT NULL DEFAULT '',
  boundaries TEXT NOT NULL DEFAULT '',
  no_vision_lines TEXT NOT NULL DEFAULT '',
  voice_style TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS persona_versions (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_persona_versions ON persona_versions(persona_id, version);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  group_id TEXT,
  persona_id TEXT,
  mode TEXT NOT NULL DEFAULT 'smart',
  settings_json TEXT NOT NULL DEFAULT '{}',
  summary_enc TEXT,
  summary_tokens INTEGER NOT NULL DEFAULT 0,
  last_active_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_id, kind, peer_id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active_at);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name_enc TEXT NOT NULL DEFAULT '',
  message_id TEXT,
  reply_to TEXT,
  segments_enc TEXT NOT NULL,
  text_enc TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  model_ref TEXT,
  capability_path TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session_time ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);

CREATE TABLE IF NOT EXISTS memory_facts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  fact_hash TEXT NOT NULL,
  subject_enc TEXT NOT NULL,
  predicate_enc TEXT NOT NULL,
  object_enc TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7,
  importance REAL NOT NULL DEFAULT 0.5,
  source_message_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(session_id, fact_hash)
);
CREATE INDEX IF NOT EXISTS idx_facts_session ON memory_facts(session_id, updated_at);

CREATE TABLE IF NOT EXISTS memory_episodes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title_enc TEXT NOT NULL,
  summary_enc TEXT NOT NULL,
  participants TEXT NOT NULL DEFAULT '[]',
  valence REAL NOT NULL DEFAULT 0,
  importance REAL NOT NULL DEFAULT 0.5,
  source_message_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_episodes_session ON memory_episodes(session_id, created_at);

CREATE TABLE IF NOT EXISTS diaries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  date TEXT NOT NULL,
  content_enc TEXT NOT NULL,
  mood TEXT NOT NULL DEFAULT '',
  importance REAL NOT NULL DEFAULT 0.6,
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, date)
);
CREATE INDEX IF NOT EXISTS idx_diaries_session ON diaries(session_id, date);

CREATE TABLE IF NOT EXISTS open_loops (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  topic_enc TEXT NOT NULL,
  detail_enc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  due_hint TEXT,
  source_message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_open_loops_session ON open_loops(session_id, status);

CREATE TABLE IF NOT EXISTS relationship_state (
  session_id TEXT PRIMARY KEY,
  affinity REAL NOT NULL DEFAULT 0.2,
  trust REAL NOT NULL DEFAULT 0.3,
  mood TEXT NOT NULL DEFAULT 'neutral',
  energy REAL NOT NULL DEFAULT 0.7,
  last_interaction_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_enc TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox(status, due_at);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload_enc TEXT NOT NULL,
  run_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(status, run_at);

CREATE TABLE IF NOT EXISTS usage_logs (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  session_id TEXT,
  provider_id TEXT,
  model_id TEXT,
  purpose TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  image_tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  cost_native REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CNY',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  estimated INTEGER NOT NULL DEFAULT 0,
  request_id TEXT,
  capability_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_logs(ts);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_logs(session_id, ts);

CREATE TABLE IF NOT EXISTS policy_entries (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE(scope, action, target_id)
);

CREATE TABLE IF NOT EXISTS stickers (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  emotion TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'image',
  description_enc TEXT,
  tags TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_ledger (
  date TEXT NOT NULL,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  spent_cost REAL NOT NULL DEFAULT 0,
  spent_tokens INTEGER NOT NULL DEFAULT 0,
  reserved_cost REAL NOT NULL DEFAULT 0,
  reserved_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(date, scope, key)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts);
`;

export function migrate(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version >= 1) return;

  const tx = db.transaction(() => {
    db.exec(SCHEMA);
    db.pragma('user_version = 1');
  });
  tx();
}
