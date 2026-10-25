import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { Store } from '../store.js';
import type { OneBotGateway } from '../onebot/gateway.js';
import { buildImageSegment, buildRecordSegment, buildReplySegment, buildTextSegment } from '../onebot/normalize.js';
import { logger } from '../logger.js';
import { synthesizeSilk, voiceSupported } from '../media/tts.js';

export class OutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private processing = false;
  private lastSentAt = new Map<string, number>();

  constructor(
    private store: Store,
    private gateway: OneBotGateway,
    private events: EventEmitter,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), 500);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      const items = this.store.listDueOutbox(Date.now(), 20);
      for (const item of items) {
        if (item.status !== 'pending') continue;
        const last = this.lastSentAt.get(item.session_id) ?? 0;
        if (Date.now() - last < 1100) continue;
        await this.sendOne(item);
      }
    } catch (err) {
      logger.error({ err: (err as Error).message }, '发送队列处理失败');
    } finally {
      this.processing = false;
    }
  }

  private async sendOne(item: any): Promise<void> {
    const session = this.store.getSession(item.session_id);
    if (!session) {
      this.store.markOutbox(item.id, 'failed', '会话不存在');
      return;
    }
    const payload = item.payload ?? {};
    if (item.kind === 'proactive' && Date.now() - item.created_at > 10 * 60_000) {
      this.store.markOutbox(item.id, 'cancelled', '主动消息已过期');
      return;
    }

    try {
      let segments: any[] = [];
      let text = '';
      let capabilityPath = payload.capabilityPath ?? 'direct';

      if (item.kind === 'sticker') {
        const file = String(payload.path ?? '');
        if (!file || !fs.existsSync(file)) throw new Error('表情包文件不存在');
        const base64 = fs.readFileSync(file).toString('base64');
        segments = [buildImageSegment(base64, path.basename(file))];
        text = '[表情包]';
        capabilityPath = 'sticker';
      } else if (item.kind === 'voice') {
        try {
          if (!voiceSupported()) throw new Error('当前系统不支持语音');
          const silk = await synthesizeSilk({ text: String(payload.text ?? ''), voice: payload.voice });
          segments = [buildRecordSegment(silk.silk.toString('base64'))];
          text = '[语音]';
          capabilityPath = 'voice';
        } catch (voiceErr) {
          // Voice is an enhancement, never a reason to drop the message.
          text = String(payload.text ?? '').trim();
          if (!text) throw voiceErr;
          segments = [buildTextSegment(text)];
          capabilityPath = 'voice-fallback';
        }
      } else {
        text = String(payload.text ?? '').trim();
        if (!text) {
          this.store.markOutbox(item.id, 'cancelled', '空消息');
          return;
        }
        if (payload.quoteId) segments.push(buildReplySegment(String(payload.quoteId)));
        segments.push(buildTextSegment(text));
      }

      const target = session.kind === 'group' ? String(session.group_id ?? session.peer_id) : String(session.peer_id);
      const response = await this.gateway.sendSegments(session.kind === 'group' ? 'group' : 'private', target, segments);
      const messageId = response?.message_id ? String(response.message_id) : null;
      this.store.addMessage({
        sessionId: session.id,
        accountId: session.account_id,
        direction: 'out',
        senderId: this.store.getSetting('onebot.account_id', 'bot'),
        senderName: this.store.getSetting('bot.name', '小满'),
        messageId,
        segments,
        text,
        modelRef: payload.modelRef ?? null,
        capabilityPath,
      });
      this.store.markOutbox(item.id, 'sent');
      this.lastSentAt.set(session.id, Date.now());
      this.events.emit('message', { sessionId: session.id, direction: 'out', text, at: Date.now() });
      this.events.emit('outbox', { id: item.id, status: 'sent', sessionId: session.id });
    } catch (err) {
      const message = (err as Error).message;
      const disconnected = /未连接|not connected|连接已断开|OneBot 未连接/i.test(message);
      if (disconnected) {
        this.store.retryOutbox(item.id, Date.now() + 5000, message);
      } else if (item.attempts < 1) {
        this.store.retryOutbox(item.id, Date.now() + 3000, message);
      } else {
        this.store.markOutbox(item.id, 'failed', message);
        logger.warn({ err: message, outbox: item.id }, '消息发送失败');
      }
    }
  }
}
