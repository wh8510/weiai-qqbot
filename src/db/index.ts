import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureRuntimeDirs } from '../config.js';
import { deriveKeys, loadMasterKey, type KeySet } from '../security/crypto.js';
import { logger } from '../logger.js';
import { migrate } from './migrations.js';

export interface DbContext {
  db: Database.Database;
  keys: KeySet;
}

export function openDatabase(): DbContext {
  ensureRuntimeDirs();
  const { key, created } = loadMasterKey(config.security.masterKeyFile);
  const keys = deriveKeys(key);

  if (created) {
    logger.warn(
      { fingerprint: keys.fingerprint, file: config.security.masterKeyFile },
      '生成了新的主密钥，请立即备份；丢失后加密数据不可恢复',
    );
  }

  const exists = fs.existsSync(config.dbFile);
  if (!exists) fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

  const db = new Database(config.dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  migrate(db);

  // A wrong master key must fail loudly. Otherwise every encrypted field would
  // silently decrypt to an empty string and the app would look "reset".
  const fingerprintRow = db.prepare("SELECT value FROM meta WHERE key = 'key_fingerprint'").get() as
    | { value: string }
    | undefined;
  if (!fingerprintRow) {
    db.prepare("INSERT INTO meta(key, value) VALUES('key_fingerprint', ?)").run(keys.fingerprint);
  } else if (fingerprintRow.value !== keys.fingerprint) {
    db.close();
    throw new Error(
      '主密钥与数据库不匹配：请恢复正确的 data/master.key / BOT_MASTER_KEY，或从备份恢复。不要删除数据库后继续使用旧 Key。',
    );
  }

  logger.info({ file: config.dbFile, encryption: 'field-level', fingerprint: keys.fingerprint }, 'SQLite 已打开');
  return { db, keys };
}
