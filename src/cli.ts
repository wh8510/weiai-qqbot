import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { openDatabase } from './db/index.js';
import { Store } from './store.js';
import { hashPassword } from './security/password.js';
import { randomPassword } from './security/crypto.js';
import { resolveRole, describeMissingModel } from './models/gateway.js';

function usage(): void {
  console.log(`
OneBot Companion CLI

  reset-password [new-password]   重置管理员密码（不填则随机生成）
  backup                          生成加密字段的数据库备份
  doctor                          检查数据库 / Provider / 角色绑定
  key-fingerprint                 显示主密钥指纹
  help                            显示本帮助

示例：
  node dist/server/cli.js reset-password
  node dist/server/cli.js backup
`);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'help';
  if (command === 'help' || command === '--help' || command === '-h') return usage();

  const { db, keys } = openDatabase();
  const store = new Store(db, keys);
  try {
    if (command === 'reset-password') {
      const admin = store.getAdminByUsername(config.security.adminUsername);
      if (!admin) throw new Error(`找不到管理员 ${config.security.adminUsername}，请先正常启动一次`);
      const password = process.argv[3] || randomPassword(20);
      store.updateAdminPassword(admin.id, await hashPassword(password), true);
      store.deleteAllAdminSessions(admin.id);
      console.log(`\n管理员: ${admin.username}\n新密码: ${password}\n\n下次登录会要求再次修改密码。\n`);
      return;
    }

    if (command === 'backup') {
      const dir = path.join(config.dataDir, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `companion-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
      db.prepare(`VACUUM INTO '${file.replace(/'/g, "''")}'`).run();
      console.log(`备份完成: ${file}`);
      console.log('注意：备份中的敏感字段仍然是加密的，恢复时需要同一份 master.key。');
      return;
    }

    if (command === 'key-fingerprint') {
      console.log(`master key fingerprint: ${keys.fingerprint}`);
      console.log(`file: ${config.security.masterKeyFile}`);
      return;
    }

    if (command === 'doctor') {
      console.log(`data: ${config.dataDir}`);
      console.log(`db: ${config.dbFile}`);
      console.log(`counts: ${JSON.stringify(store.counts())}`);
      for (const provider of store.listProviders()) {
        const models = store.listModels(provider.id);
        console.log(`provider ${provider.id}: enabled=${provider.enabled} hasKey=${store.providerHasKey(provider.id)} models=${models.length}`);
      }
      for (const role of ['chat', 'vision', 'memory', 'classifier', 'embedding'] as const) {
        const model = resolveRole(store, role);
        console.log(`role ${role}: ${model ? `${model.ref} (${model.model.display_name})` : `MISSING — ${describeMissingModel(store, role)}`}`);
      }
      return;
    }

    usage();
  } finally {
    store.close();
  }
}

main().catch((err) => {
  console.error(`\n命令失败: ${(err as Error).message}\n`);
  process.exit(1);
});
