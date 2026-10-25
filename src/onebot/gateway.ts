import type { FastifyInstance } from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { logger } from '../logger.js';
import { safeEqual } from '../security/crypto.js';
import type { Store } from '../store.js';
import type { AppConfig } from '../config.js';
import { HttpOneBotConnection, WsOneBotConnection, type OneBotConnection } from './api.js';
import type { OneBotEvent, OneBotStatus } from './types.js';

type EventHandler = (event: OneBotEvent) => void | Promise<void>;

export class OneBotGateway {
  private wss: WebSocketServer | null = null;
  private conn: OneBotConnection | null = null;
  private forwardSocket: WebSocket | null = null;
  private forwardTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private stopped = false;
  private eventHandler: EventHandler = () => {};
  private status: OneBotStatus = {
    connected: false,
    mode: 'none',
    selfId: '',
    nickname: '',
    lastEventAt: null,
    lastConnectedAt: null,
    lastError: '',
    eventCount: 0,
  };

  constructor(private store: Store, private config: AppConfig) {}

  onEvent(handler: EventHandler): void {
    this.eventHandler = handler;
  }

  getStatus(): OneBotStatus {
    return { ...this.status };
  }

  private token(): string {
    return this.store.getSecretSetting('onebot.token') || this.config.onebot.token;
  }

  private configuredMode(): 'reverse' | 'forward' {
    return (this.store.getSetting('onebot.mode', this.config.onebot.mode) as 'reverse' | 'forward') || 'reverse';
  }

  attach(app: FastifyInstance): void {
    this.wss = new WebSocketServer({ noServer: true });
    app.server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
    this.watchdog = setInterval(() => this.checkHealth(), 30_000);
    this.watchdog.unref?.();

    const mode = this.configuredMode();
    if (mode === 'forward') this.startForward();
    if (!this.token()) {
      logger.warn('ONEBOT_TOKEN 为空：反向 WS 会接受任意客户端，生产环境请务必设置 token');
    }
    logger.info({ mode, path: this.config.onebot.path }, 'OneBot 网关已启动');
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    let pathname = '';
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== this.config.onebot.path) {
      socket.destroy();
      return;
    }
    if (!this.checkToken(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const selfId = String(req.headers['x-self-id'] ?? new URL(req.url ?? '/', 'http://localhost').searchParams.get('self_id') ?? '');
    this.wss!.handleUpgrade(req, socket, head, (ws) => {
      this.wss!.emit('connection', ws, req);
      this.acceptSocket(ws, selfId, 'reverse');
    });
  }

  private checkToken(req: IncomingMessage): boolean {
    const expected = this.token();
    if (!expected) return true;
    const auth = String(req.headers.authorization ?? '');
    const headerToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    let queryToken = '';
    try {
      queryToken = new URL(req.url ?? '/', 'http://localhost').searchParams.get('access_token') ?? '';
    } catch {
      queryToken = '';
    }
    const supplied = headerToken || String(req.headers['x-access-token'] ?? '') || queryToken;
    return Boolean(supplied) && safeEqual(supplied, expected);
  }

  private acceptSocket(ws: WebSocket, selfId: string, kind: 'reverse' | 'forward'): void {
    this.conn?.close();
    let connection: WsOneBotConnection;
    connection = new WsOneBotConnection(
      ws,
      kind,
      selfId || 'unknown',
      (event) => this.handleEvent(event),
      () => {
        if (this.conn === connection) {
          this.status.connected = false;
          this.status.mode = 'none';
          this.status.lastError = '连接已断开';
          logger.warn('OneBot 连接已断开');
        }
      },
    );
    this.conn = connection;
    this.status = {
      ...this.status,
      connected: true,
      mode: kind,
      selfId: selfId || this.status.selfId || '',
      lastConnectedAt: Date.now(),
      lastError: '',
    };
    logger.info({ kind, selfId }, 'OneBot 已连接');
    void this.refreshLoginInfo();
  }

  private async refreshLoginInfo(): Promise<void> {
    try {
      const info = await this.conn?.sendAction('get_login_info');
      if (info?.user_id) {
        this.status.selfId = String(info.user_id);
        this.status.nickname = String(info.nickname ?? '');
        this.store.setSetting('onebot.account_id', this.status.selfId);
        if (info.nickname) this.store.setSetting('onebot.nickname', String(info.nickname));
      }
    } catch (err) {
      logger.debug({ err: (err as Error).message }, 'get_login_info 失败（可能尚未就绪）');
    }
  }

  private async handleEvent(event: OneBotEvent): Promise<void> {
    this.status.lastEventAt = Date.now();
    this.status.eventCount += 1;
    if (event.self_id) this.status.selfId = String(event.self_id);
    if (event.post_type === 'meta_event' && event.meta_event_type === 'heartbeat') {
      if (event.status?.good === false) {
        this.status.lastError = '上游心跳报告 good=false';
      }
      return;
    }
    try {
      await this.eventHandler(event);
    } catch (err) {
      logger.error({ err: (err as Error).message, event: event.post_type }, '处理 OneBot 事件失败');
    }
  }

  private checkHealth(): void {
    if (!this.conn?.isOpen()) {
      if (this.status.connected) {
        this.status.connected = false;
        this.status.mode = 'none';
        this.status.lastError = '连接已断开';
      }
      if (this.configuredMode() === 'forward' && !this.forwardSocket) this.startForward();
      return;
    }
    if (this.status.lastEventAt && Date.now() - this.status.lastEventAt > 120_000) {
      this.status.lastError = '超过 2 分钟没有收到任何事件（可能是上游 Hook 卡住）';
    }
  }

  async send(action: string, params: Record<string, any> = {}, timeoutMs = 20_000): Promise<any> {
    if (this.conn?.isOpen()) return this.conn.sendAction(action, params, timeoutMs);
    if (this.config.onebot.httpUrl) {
      const http = new HttpOneBotConnection(this.config.onebot.httpUrl, this.token());
      return http.sendAction(action, params, timeoutMs);
    }
    throw new Error('OneBot 未连接，且没有配置 HTTP 兜底地址');
  }

  async sendSegments(kind: 'private' | 'group', targetId: string, segments: any[]): Promise<any> {
    const action = kind === 'private' ? 'send_private_msg' : 'send_group_msg';
    const params = kind === 'private' ? { user_id: Number(targetId), message: segments } : { group_id: Number(targetId), message: segments };
    return this.send(action, params);
  }

  private startForward(): void {
    if (this.stopped || this.forwardSocket) return;
    const url = this.store.getSetting('onebot.url', this.config.onebot.url);
    if (!url) {
      logger.warn('OneBot 配置为正向后，但 onebot.url 为空');
      return;
    }
    const token = this.token();
    const ws = new WebSocket(url, {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'x-client-role': 'Universal',
      },
    });
    this.forwardSocket = ws;
    ws.on('open', () => {
      logger.info({ url }, 'OneBot 正向 WS 已连接');
      this.acceptSocket(ws, this.status.selfId, 'forward');
    });
    ws.on('close', () => {
      this.forwardSocket = null;
      this.status.connected = false;
      this.status.mode = 'none';
      this.scheduleForwardReconnect();
    });
    ws.on('error', (err) => {
      this.status.lastError = err.message;
    });
  }

  private scheduleForwardReconnect(): void {
    if (this.stopped) return;
    if (this.forwardTimer) clearTimeout(this.forwardTimer);
    this.forwardTimer = setTimeout(() => {
      this.forwardTimer = null;
      this.startForward();
    }, 5000);
    this.forwardTimer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.forwardTimer) clearTimeout(this.forwardTimer);
    try {
      this.forwardSocket?.close();
    } catch {
      // ignore
    }
    this.conn?.close();
    this.wss?.close();
  }
}
