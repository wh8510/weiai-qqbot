import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { logger } from './logger.js';
import { openDatabase } from './db/index.js';
import { Store } from './store.js';
import { bootstrap } from './bootstrap.js';
import { OneBotGateway } from './onebot/gateway.js';
import { ChatRuntime } from './chat/runtime.js';
import { OutboxWorker } from './chat/outbox.js';
import { MemoryWorker } from './memory/worker.js';
import { ProactiveScheduler } from './proactive/scheduler.js';
import { createWebServer } from './web/server.js';

async function main(): Promise<void> {
  const { db, keys } = openDatabase();
  const store = new Store(db, keys);
  const boot = await bootstrap(store);

  const events = new EventEmitter();
  events.setMaxListeners(50);

  const gateway = new OneBotGateway(store, config);
  const runtime = new ChatRuntime(store, gateway, config, events);
  const outbox = new OutboxWorker(store, gateway, events);
  const memory = new MemoryWorker(store, config.timezone);
  const proactive = new ProactiveScheduler(store, config, events);

  gateway.onEvent((event) => runtime.handleEvent(event));
  const app = await createWebServer({ store, gateway, runtime, proactive, events });
  gateway.attach(app);

  outbox.start();
  memory.start();
  proactive.start();

  await app.listen({ host: config.server.host, port: config.server.port });

  const localUrl = `http://${config.server.host === '0.0.0.0' ? '127.0.0.1' : config.server.host}:${config.server.port}`;
  logger.info(
    {
      url: localUrl,
      demo: config.demo,
      dataDir: config.dataDir,
      onebotMode: config.onebot.mode,
      onebotPath: config.onebot.path,
    },
    'OneBot Companion 已启动',
  );
  if (boot.adminCreated) {
    logger.warn(
      { username: boot.adminUsername, passwordFile: `${config.dataDir}/initial-credentials.txt` },
      '首次启动：请查看初始管理员凭据，登录后立即修改密码',
    );
  }
  // eslint-disable-next-line no-console
  console.log(`\n  OneBot Companion ${config.version}\n  管理端: ${localUrl}\n  Demo: ${config.demo ? '开' : '关'}\n  OneBot: ${config.onebot.mode} ${config.onebot.path}\n`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, '正在关闭');
    proactive.stop();
    memory.stop();
    outbox.stop();
    gateway.stop();
    try {
      await app.close();
    } catch {
      // ignore
    }
    try {
      store.close();
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err: (err as Error).message, stack: (err as Error).stack }, '启动失败');
  // eslint-disable-next-line no-console
  console.error(`\n启动失败: ${(err as Error).message}\n`);
  process.exit(1);
});
