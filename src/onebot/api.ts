import WebSocket from 'ws';
import type { OneBotActionResponse, OneBotEvent } from './types.js';

export class OneBotApiError extends Error {
  action: string;
  retcode: number;
  constructor(action: string, message: string, retcode = -1) {
    super(message);
    this.name = 'OneBotApiError';
    this.action = action;
    this.retcode = retcode;
  }
}

export interface OneBotConnection {
  readonly kind: 'reverse' | 'forward' | 'http';
  readonly label: string;
  isOpen(): boolean;
  sendAction(action: string, params?: Record<string, any>, timeoutMs?: number): Promise<any>;
  close(): void;
}

export class WsOneBotConnection implements OneBotConnection {
  readonly kind: 'reverse' | 'forward';
  readonly label: string;
  private ws: WebSocket;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private seq = 0;
  private closed = false;

  constructor(ws: WebSocket, kind: 'reverse' | 'forward', label: string, private onEvent: (event: OneBotEvent) => void, private onClose: () => void) {
    this.ws = ws;
    this.kind = kind;
    this.label = label;
    ws.on('message', (data) => this.handleMessage(data));
    ws.on('close', () => {
      this.closed = true;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('OneBot 连接已断开'));
      }
      this.pending.clear();
      this.onClose();
    });
    ws.on('error', () => {
      // Close handler cleans up.
    });
  }

  isOpen(): boolean {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }

  private handleMessage(data: WebSocket.RawData): void {
    let payload: any;
    try {
      payload = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (payload && payload.echo !== undefined) {
      const key = String(payload.echo);
      const pending = this.pending.get(key);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(key);
        const response = payload as OneBotActionResponse;
        if (response.status === 'ok' && (response.retcode ?? 0) === 0) pending.resolve(response.data);
        else {
          pending.reject(
            new OneBotApiError(
              'unknown',
              response.wording || `OneBot 调用失败 (retcode=${response.retcode})`,
              response.retcode ?? -1,
            ),
          );
        }
      }
      return;
    }
    this.onEvent(payload as OneBotEvent);
  }

  sendAction(action: string, params: Record<string, any> = {}, timeoutMs = 20_000): Promise<any> {
    if (!this.isOpen()) return Promise.reject(new Error('OneBot 未连接'));
    const echo = `c${Date.now()}_${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(new OneBotApiError(action, `OneBot 调用超时: ${action}`));
      }, timeoutMs);
      this.pending.set(echo, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ action, params, echo }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(echo);
        reject(err as Error);
      }
    });
  }

  close(): void {
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

export class HttpOneBotConnection implements OneBotConnection {
  readonly kind = 'http' as const;
  readonly label: string;
  constructor(private baseUrl: string, private token: string) {
    this.label = 'http';
  }

  isOpen(): boolean {
    return Boolean(this.baseUrl);
  }

  async sendAction(action: string, params: Record<string, any> = {}, timeoutMs = 20_000): Promise<any> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/${action}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await response.json()) as OneBotActionResponse;
    if (!response.ok || data.status !== 'ok' || (data.retcode ?? 0) !== 0) {
      throw new OneBotApiError(action, data.wording || `HTTP ${response.status}`, data.retcode ?? -1);
    }
    return data.data;
  }

  close(): void {
    // stateless
  }
}
