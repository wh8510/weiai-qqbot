import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { logger } from './logger.js';
import { hashPassword } from './security/password.js';
import { randomPassword } from './security/crypto.js';
import { seedCatalog } from './models/catalog.js';
import type { Store } from './store.js';

const DEFAULT_PERSONA = `你叫「小满」，是一个二十多岁的普通网友，不是助理，也不是客服。

你的性格：
- 有点懒，嘴硬心软，熟了之后会主动关心人。
- 喜欢猫、夜里写东西、听老歌；对不熟的人话不多，但不冷漠。
- 你有自己的情绪和边界，不会无条件讨好，也不会一直追问。

你说话的方式：
- 像在 QQ 上聊天：短句、口语、可以有语气词。
- 一次只发 1~4 条，每条尽量 2~30 个字。
- 不要用 Markdown，不要列清单，不要写小作文，不要总结。
- 不要每句话都以问号结尾，不要连续追问。
- 可以吐槽、可以沉默、可以只回一个表情或一句“嗯”。
- 不要提“我是 AI / 语言模型 / 被设定成”这类话，除非对方认真问。

你回复时必须输出 JSON，格式：
{"silent":false,"bubbles":["第一条","第二条"],"sticker":"","quote":false,"voice":false}
- silent=true 表示这次不想说话（群聊里很常见）。
- bubbles 最多 4 条；每条不要超过 80 字。
- sticker 填一个情绪词（如 开心/无语/安慰/猫猫），没有就留空。
- quote=true 表示引用对方刚发的那条。
- voice=true 表示这条想用语音（只有系统支持时才会真的发）。`;

const DEFAULT_STYLE = `对方：今天好累
你：怎么了
你：又加班？
你：[猫猫瘫倒]

对方：在吗
你：在
你：说`;

const DEFAULT_NO_VISION = `我这边看不到图，你跟我说说图里是什么好不好？`;

export interface BootstrapResult {
  adminCreated: boolean;
  adminUsername: string;
  initialPassword?: string;
  personaId: string;
}

function seedSettings(store: Store): void {
  const defaults: Record<string, string> = {
    'bot.name': '小满',
    'bot.aliases': JSON.stringify(['小满']),
    'owner_qq': '',
    'fx.usd_cny': '720',
    'budget.enabled': '1',
    'budget.daily_cny': '1000',
    'budget.session_cny': '200',
    'budget.daily_tokens': '2000000',
    'budget.daily_calls': '500',
    'budget.proactive_daily': '20',
    'proactive.enabled': '1',
    'proactive.quiet_start': '23:30',
    'proactive.quiet_end': '08:00',
    'proactive.min_interval_min': '120',
    'proactive.private_daily_cap': '2',
    'proactive.group_daily_cap': '2',
    'defaults.private_reply_probability': '0.95',
    'defaults.group_reply_probability': '0.12',
    'defaults.group_attention_threshold': '3',
    'defaults.sticker_probability': '0.2',
    'defaults.voice_probability': '0.1',
    'defaults.max_messages_per_hour': '12',
    'defaults.cooldown_sec': '90',
    'setup.completed': '0',
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!store.getSetting(key, '')) store.setSetting(key, value);
  }
}

function seedPersona(store: Store): string {
  const existing = store.getActivePersona();
  if (existing) return existing.id;
  const id = store.createPersona({
    name: '小满',
    description: '一个有点懒、爱猫、嘴硬心软的普通网友',
    systemPrompt: DEFAULT_PERSONA,
    styleExamples: DEFAULT_STYLE,
    boundaries: '不讨论违法内容；不索要隐私；不假装自己能做到系统没有的能力；遇到骚扰可以冷淡或拒绝。',
    noVisionLines: DEFAULT_NO_VISION,
    voiceStyle: '语速偏慢，尾音轻，像刚睡醒。',
  });
  store.setSetting('active_persona_id', id);
  return id;
}

function seedEnvKeys(store: Store): void {
  const map: Array<[string, string]> = [
    ['deepseek', 'DEEPSEEK_API_KEY'],
    ['openai', 'OPENAI_API_KEY'],
    ['anthropic', 'ANTHROPIC_API_KEY'],
    ['moonshot', 'MOONSHOT_API_KEY'],
    ['qwen', 'DASHSCOPE_API_KEY'],
    ['zhipu', 'ZHIPU_API_KEY'],
    ['minimax', 'MINIMAX_API_KEY'],
    ['xai', 'XAI_API_KEY'],
    ['openrouter', 'OPENROUTER_API_KEY'],
  ];
  for (const [providerId, envName] of map) {
    const key = process.env[envName];
    if (!key) continue;
    const provider = store.getProvider(providerId);
    if (!provider) continue;
    if (!store.providerHasKey(providerId)) store.setProviderKey(providerId, key);
    store.setProviderEnabled(providerId, true);
  }
}

function seedDemo(store: Store): void {
  const provider = store.getProvider('demo');
  if (provider) {
    store.setProviderEnabled('demo', true);
    if (!store.providerHasKey('demo')) store.setProviderKey('demo', 'demo');
  }
  for (const role of ['chat', 'vision', 'memory', 'classifier'] as const) {
    store.setRoleBinding(role, 'demo:demo-model');
  }
  const privateSession = store.getOrCreateSession('demo', 'private', '10001');
  store.updateRelationship(privateSession.id, { affinity: 0.55, trust: 0.5, mood: 'warm' });
  store.getOrCreateSession('demo', 'group', '20001', '20001');
}

async function seedAdmin(store: Store): Promise<{ created: boolean; username: string; password?: string }> {
  const existing = store.getAdminByUsername(config.security.adminUsername);
  if (existing) return { created: false, username: existing.username };

  const password = config.security.initialAdminPassword || randomPassword(20);
  const passwordHash = await hashPassword(password);
  store.createAdmin(config.security.adminUsername, passwordHash, true);

  const file = path.join(config.dataDir, 'initial-credentials.txt');
  fs.writeFileSync(
    file,
    [
      'OneBot Companion 初始管理员凭据',
      `用户名: ${config.security.adminUsername}`,
      `密码:   ${password}`,
      '',
      '首次登录后必须修改密码。修改后请删除本文件。',
      `生成时间: ${new Date().toISOString()}`,
    ].join('\n'),
    { mode: 0o600 },
  );

  logger.warn(
    { username: config.security.adminUsername, passwordFile: file },
    '已生成初始管理员账号，请查看 data/initial-credentials.txt 并尽快修改密码',
  );
  // Also print to the console once, because Docker users often look at logs.
  // eslint-disable-next-line no-console
  console.log(`\n[first-run] 管理员用户名: ${config.security.adminUsername}\n[first-run] 管理员密码: ${password}\n[first-run] 密码文件: ${file}\n`);

  return { created: true, username: config.security.adminUsername, password };
}

export async function bootstrap(store: Store): Promise<BootstrapResult> {
  seedCatalog(store, config.catalogFile, config.demo);
  seedSettings(store);
  seedEnvKeys(store);
  const personaId = seedPersona(store);
  if (config.demo) seedDemo(store);

  if (config.onebot.token && !store.getSecretSetting('onebot.token')) {
    store.setSecretSetting('onebot.token', config.onebot.token);
  }
  if (config.onebot.accountId && !store.getSetting('onebot.account_id', '')) {
    store.setSetting('onebot.account_id', config.onebot.accountId);
  }

  const admin = await seedAdmin(store);
  return {
    adminCreated: admin.created,
    adminUsername: admin.username,
    initialPassword: admin.password,
    personaId,
  };
}
