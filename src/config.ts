import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export interface OneBotConfig {
  mode: 'reverse' | 'forward';
  path: string;
  token: string;
  url: string;
  httpUrl: string;
  accountId: string;
}

export interface AppConfig {
  root: string;
  version: string;
  demo: boolean;
  isProduction: boolean;
  dataDir: string;
  dbFile: string;
  catalogFile: string;
  webDist: string;
  assetsDir: string;
  server: {
    host: string;
    port: number;
    publicUrl: string;
    trustProxy: boolean;
  };
  security: {
    masterKeyFile: string;
    sessionTtlHours: number;
    adminUsername: string;
    initialAdminPassword: string;
    forceHttps: boolean;
  };
  onebot: OneBotConfig;
  timezone: string;
  currency: string;
  logLevel: string;
}

function readYaml(file: string): Record<string, any> {
  try {
    if (!fs.existsSync(file)) return {};
    const doc = YAML.parse(fs.readFileSync(file, 'utf8'));
    return doc && typeof doc === 'object' ? doc : {};
  } catch (err) {
    throw new Error(`无法读取配置文件 ${file}: ${(err as Error).message}`);
  }
}

function asBool(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function asInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function asString(value: unknown, fallback = ''): string {
  return value === undefined || value === null ? fallback : String(value);
}

const root = process.cwd();
const fileConfig = readYaml(path.resolve(root, process.env.BOT_CONFIG_FILE || 'config.yaml'));
const serverCfg = fileConfig.server ?? {};
const securityCfg = fileConfig.security ?? {};
const onebotCfg = fileConfig.onebot ?? {};
const demoMode = asBool(process.env.DEMO_MODE ?? fileConfig.demo, false);
const fileDataDir = asString(fileConfig.dataDir, 'data');
const dataDir = path.resolve(root, process.env.BOT_DATA_DIR || (demoMode ? 'data-demo' : fileDataDir));

let version = '0.1.0';
try {
  version = JSON.parse(fs.readFileSync(path.resolve(root, 'package.json'), 'utf8')).version ?? version;
} catch {
  // bundled / packaged without package.json is fine
}

export const config: AppConfig = {
  root,
  version,
  demo: demoMode,
  isProduction: process.env.NODE_ENV === 'production',
  dataDir,
  dbFile: path.resolve(dataDir, process.env.BOT_DB_FILE || asString(fileConfig.database?.file, 'companion.db')),
  catalogFile: path.resolve(root, process.env.BOT_CATALOG_FILE || asString(fileConfig.catalogFile, 'catalog/providers.yaml')),
  webDist: path.resolve(root, asString(fileConfig.webDist, 'dist/web')),
  assetsDir: path.resolve(root, 'assets'),
  server: {
    host: process.env.BOT_HOST || asString(serverCfg.host, '127.0.0.1'),
    port: asInt(process.env.BOT_PORT || serverCfg.port, 8080),
    publicUrl: process.env.BOT_PUBLIC_URL || asString(serverCfg.publicUrl, ''),
    trustProxy: asBool(process.env.BOT_TRUST_PROXY ?? serverCfg.trustProxy, false),
  },
  security: {
    masterKeyFile: path.resolve(dataDir, process.env.BOT_MASTER_KEY_FILE || asString(securityCfg.masterKeyFile, 'master.key')),
    sessionTtlHours: asInt(process.env.BOT_SESSION_TTL_HOURS || securityCfg.sessionTtlHours, 72),
    adminUsername: process.env.BOT_ADMIN_USERNAME || asString(securityCfg.adminUsername, 'admin'),
    initialAdminPassword: process.env.BOT_ADMIN_PASSWORD || asString(securityCfg.initialAdminPassword, ''),
    forceHttps: asBool(process.env.BOT_FORCE_HTTPS ?? securityCfg.forceHttps, false),
  },
  onebot: {
    mode: (process.env.ONEBOT_MODE || asString(onebotCfg.mode, 'reverse')) === 'forward' ? 'forward' : 'reverse',
    path: process.env.ONEBOT_PATH || asString(onebotCfg.path, '/onebot/v11/ws'),
    token: process.env.ONEBOT_TOKEN || asString(onebotCfg.token, ''),
    url: process.env.ONEBOT_URL || asString(onebotCfg.url, ''),
    httpUrl: process.env.ONEBOT_HTTP_URL || asString(onebotCfg.httpUrl, ''),
    accountId: process.env.ONEBOT_ACCOUNT_ID || asString(onebotCfg.accountId, ''),
  },
  timezone: process.env.BOT_TIMEZONE || asString(fileConfig.timezone, 'Asia/Shanghai'),
  currency: process.env.BOT_CURRENCY || asString(fileConfig.currency, 'CNY'),
  logLevel: process.env.LOG_LEVEL || asString(fileConfig.logLevel, 'info'),
};

export function ensureRuntimeDirs(): void {
  for (const dir of [
    config.dataDir,
    path.join(config.dataDir, 'media'),
    path.join(config.dataDir, 'stickers'),
    path.join(config.dataDir, 'tts'),
    path.join(config.dataDir, 'backups'),
    path.join(config.dataDir, 'logs'),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function publicConfig() {
  return {
    version: config.version,
    demo: config.demo,
    timezone: config.timezone,
    currency: config.currency,
    server: { host: config.server.host, port: config.server.port, publicUrl: config.server.publicUrl },
    onebot: {
      mode: config.onebot.mode,
      path: config.onebot.path,
      url: config.onebot.url,
      httpUrl: config.onebot.httpUrl,
      tokenConfigured: Boolean(config.onebot.token),
    },
  };
}
