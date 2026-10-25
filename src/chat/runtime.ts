import { EventEmitter } from 'node:events';
import type { Store } from '../store.js';
import type { OneBotGateway } from '../onebot/gateway.js';
import type { AppConfig } from '../config.js';
import { logger } from '../logger.js';
import type { OneBotEvent, OneBotSegment } from '../onebot/types.js';
import { firstReplyId, isMentioned, normalizeSegments, segmentsToPlainText } from '../onebot/normalize.js';
import { checkAccess, groupShouldSpeak } from './policy.js';
import { buildContext, type IncomingImage, type IncomingMessage } from './context.js';
import { normalizePlan, timeBubbles, type ReplyPlan } from './planner.js';
import { callRole, resolveRole } from '../models/gateway.js';
import { modelCapabilities } from '../models/catalog.js';
import { describeImage, segmentToImage } from '../media/images.js';
import { randomBetween, isQuietHours } from '../util/time.js';
import { voiceStatus } from '../media/tts.js';

interface BatchItem extends IncomingMessage {
  segments: OneBotSegment[];
  replyToBot: boolean;
}

interface Batch {
  sessionId: string;
  items: BatchItem[];
  firstAt: number;
  timer: NodeJS.Timeout;
  token: number;
}

export interface DebugResult {
  sessionId: string;
  silent: boolean;
  bubbles: string[];
  sticker: string;
  model: string;
  capabilityPath: string;
  costCny: number;
  imagePath: string;
}

export class ChatRuntime {
  private batches = new Map<string, Batch>();
  private tokens = new Map<string, number>();

  constructor(
    private store: Store,
    private gateway: OneBotGateway,
    private config: AppConfig,
    private events: EventEmitter,
  ) {}

  private aliases(): string[] {
    const raw = this.store.getSetting('bot.aliases', '[]');
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // ignore
    }
    return [this.store.getSetting('bot.name', '小满')].filter(Boolean);
  }

  private mergeSettings(session: any): Record<string, any> {
    let override: Record<string, any> = {};
    try {
      override = JSON.parse(session.settings_json || '{}');
    } catch {
      override = {};
    }
    return {
      paused: override.paused === true,
      privateReplyProbability: Number(override.privateReplyProbability ?? this.store.getSetting('defaults.private_reply_probability', '0.95')),
      groupReplyProbability: Number(override.groupReplyProbability ?? this.store.getSetting('defaults.group_reply_probability', '0.12')),
      groupAttentionThreshold: Number(override.groupAttentionThreshold ?? this.store.getSetting('defaults.group_attention_threshold', '3')),
      stickerProbability: Number(override.stickerProbability ?? this.store.getSetting('defaults.sticker_probability', '0.2')),
      voiceProbability: Number(override.voiceProbability ?? this.store.getSetting('defaults.voice_probability', '0.1')),
      maxMessagesPerHour: Number(override.maxMessagesPerHour ?? this.store.getSetting('defaults.max_messages_per_hour', '12')),
      cooldownSec: Number(override.cooldownSec ?? this.store.getSetting('defaults.cooldown_sec', '90')),
      quietStart: String(override.quietStart ?? this.store.getSetting('proactive.quiet_start', '23:30')),
      quietEnd: String(override.quietEnd ?? this.store.getSetting('proactive.quiet_end', '08:00')),
      ...override,
    };
  }

  async handleEvent(event: OneBotEvent): Promise<void> {
    if (event.post_type !== 'message') return;
    if (event.message_type !== 'private' && event.message_type !== 'group') return;
    const selfId = String(event.self_id ?? this.gateway.getStatus().selfId ?? '');
    const senderId = String(event.user_id ?? event.sender?.user_id ?? '');
    if (!senderId || senderId === selfId) return;

    const segments = normalizeSegments(event.message);
    const text = segmentsToPlainText(segments, selfId);
    const hasImage = segments.some((s) => s.type === 'image');
    if (!text && !hasImage) return;

    const kind = event.message_type;
    const groupId = kind === 'group' ? String(event.group_id ?? '') : null;
    const peerId = kind === 'group' ? groupId! : senderId;
    if (!peerId) return;

    const access = checkAccess(this.store, {
      kind,
      peerId,
      groupId,
      senderId,
      selfId,
      ownerQq: this.store.getSetting('owner_qq', ''),
      segments,
      aliases: this.aliases(),
    });
    if (!access.allowed) {
      logger.debug({ reason: access.reason, senderId, groupId }, '消息被名单拒绝');
      return;
    }

    const session = this.store.getOrCreateSession(selfId || 'unknown', kind, peerId, groupId ?? undefined);
    if (kind === 'group' && access.groupMode !== 'normal' && session.mode !== access.groupMode) {
      this.store.updateSession(session.id, { mode: access.groupMode });
    }
    const settings = this.mergeSettings(session);
    if (settings.paused) return;

    const replyToBot = segments.some((s) => {
      const id = s.type === 'reply' ? String(s.data.id ?? '') : '';
      return id ? this.store.isOutgoingMessageId(id) : false;
    });

    this.store.addMessage({
      sessionId: session.id,
      accountId: session.account_id,
      direction: 'in',
      senderId,
      senderName: String(event.sender?.card || event.sender?.nickname || senderId),
      messageId: event.message_id ? String(event.message_id) : null,
      replyTo: firstReplyId(segments),
      segments,
      text: text || '[图片]',
      tokens: 0,
    });
    this.store.updateRelationship(session.id, { lastInteractionAt: Date.now() });

    // In mention-only groups we still store context (encrypted), so when the
    // bot is eventually @-ed it knows what the group was talking about. We do
    // not generate, cancel queued bubbles, or spend tokens for these messages.
    if (kind === 'group' && access.groupMode === 'mention_only' && !access.mentioned) {
      this.maybeScheduleMemory(session.id);
      return;
    }

    this.events.emit('incoming', {
      sessionId: session.id,
      kind,
      senderId,
      senderName: String(event.sender?.card || event.sender?.nickname || senderId),
      text: text || '[图片]',
      at: Date.now(),
    });

    // A new user message cancels queued bubbles from the previous turn. This is
    // the difference between "chatting" and "a queue of notifications".
    this.store.cancelPendingOutbox(session.id);
    const token = (this.tokens.get(session.id) ?? 0) + 1;
    this.tokens.set(session.id, token);

    const item: BatchItem = {
      senderId,
      senderName: String(event.sender?.card || event.sender?.nickname || senderId),
      text: text || '[图片]',
      messageId: event.message_id ? String(event.message_id) : null,
      createdAt: Date.now(),
      segments,
      replyToBot,
    };
    this.enqueueBatch(session.id, item, token, kind === 'group' ? 2200 : 1200);
  }

  private enqueueBatch(sessionId: string, item: BatchItem, token: number, windowMs: number): void {
    const existing = this.batches.get(sessionId);
    if (existing) {
      existing.items.push(item);
      if (Date.now() - existing.firstAt > 6000) {
        clearTimeout(existing.timer);
        this.batches.delete(sessionId);
        void this.processBatch(existing);
      }
      return;
    }
    const timer = setTimeout(() => {
      const batch = this.batches.get(sessionId);
      if (!batch) return;
      this.batches.delete(sessionId);
      void this.processBatch(batch);
    }, windowMs + randomBetween(0, 500));
    timer.unref?.();
    this.batches.set(sessionId, { sessionId, items: [item], firstAt: Date.now(), timer, token });
  }

  private async processBatch(batch: Batch): Promise<void> {
    const session = this.store.getSession(batch.sessionId);
    if (!session) return;
    const settings = this.mergeSettings(session);
    if (this.tokens.get(session.id) !== batch.token) return;
    const combinedText = batch.items.map((i) => i.text).join('\n');
    const mentioned = batch.items.some((i) => isMentioned(i.segments, session.account_id, this.aliases()));
    const replyToBot = batch.items.some((i) => i.replyToBot);

    if (session.kind === 'group' && !batch.items.some((i) => i.replyToBot)) {
      const lastOut = this.store.lastOutgoingAt(session.id);
      const botSpokeRecently = Boolean(lastOut && Date.now() - lastOut < settings.cooldownSec * 1000);
      const quiet = isQuietHours(this.config.timezone, settings.quietStart, settings.quietEnd);
      const decision = groupShouldSpeak({
        mode: session.mode as any,
        mentioned,
        replyToBot,
        text: combinedText,
        settings,
        botSpokeRecently,
        messagesLastHour: this.store.countIncomingSince(session.id, Date.now() - 3600_000),
        botMessagesLastHour: this.store.countOutgoingSince(session.id, Date.now() - 3600_000),
        quiet,
      });
      if (!decision.speak) {
        logger.debug({ sessionId: session.id, reason: decision.reason, score: decision.score }, '群聊保持沉默');
        this.maybeScheduleMemory(session.id);
        return;
      }
    }

    if (session.kind === 'private' && !mentioned) {
      const owner = String(batch.items[0]?.senderId) === this.store.getSetting('owner_qq', '');
      const probability = owner ? 1 : Number(settings.privateReplyProbability);
      if (Math.random() > probability) {
        logger.debug({ sessionId: session.id }, '私聊概率未命中，保持沉默');
        this.maybeScheduleMemory(session.id);
        return;
      }
    }

    try {
      const result = await this.generateReply(session, batch.items);
      if (this.tokens.get(session.id) !== batch.token) return;
      if (result.plan.silent || result.plan.bubbles.length === 0) {
        this.store.updateRelationship(session.id, { mood: result.plan.mood });
        this.maybeScheduleMemory(session.id);
        return;
      }

      const timed = timeBubbles(result.plan.bubbles);
      const quoteId = result.plan.quote && session.kind === 'group' ? batch.items[batch.items.length - 1]?.messageId : null;
      let lastDue = Date.now();
      let voiceFirst = false;

      if (result.plan.voice && session.kind === 'private' && voiceStatus().supported && Math.random() < Number(settings.voiceProbability)) {
        voiceFirst = true;
        const first = timed[0];
        this.store.enqueueOutbox({
          sessionId: session.id,
          accountId: session.account_id,
          kind: 'voice',
          payload: { text: result.plan.bubbles[0], modelRef: result.modelRef, capabilityPath: 'voice' },
          dueAt: Date.now() + (first?.delayMs ?? 1500),
        });
        lastDue = Date.now() + (first?.delayMs ?? 1500);
      }

      for (const bubble of timed) {
        if (voiceFirst && bubble === timed[0]) continue;
        lastDue = Date.now() + bubble.delayMs;
        this.store.enqueueOutbox({
          sessionId: session.id,
          accountId: session.account_id,
          kind: 'reply',
          payload: { text: bubble.text, quoteId, modelRef: result.modelRef, capabilityPath: result.capabilityPath },
          dueAt: lastDue,
        });
      }

      if (result.plan.sticker && Math.random() < Number(settings.stickerProbability)) {
        const sticker = this.store.pickSticker(result.plan.sticker);
        if (sticker?.file_path) {
          this.store.enqueueOutbox({
            sessionId: session.id,
            accountId: session.account_id,
            kind: 'sticker',
            payload: { path: sticker.file_path, emotion: result.plan.sticker, modelRef: result.modelRef },
            dueAt: lastDue + randomBetween(500, 1400),
          });
          this.store.bumpStickerUsage(sticker.id);
        }
      }

      this.store.updateRelationship(session.id, {
        affinity: Math.min(1, Number(this.store.getRelationship(session.id).affinity ?? 0.2) + 0.01),
        mood: result.plan.mood,
      });
      this.events.emit('reply', {
        sessionId: session.id,
        plan: result.plan,
        modelRef: result.modelRef,
        capabilityPath: result.capabilityPath,
        at: Date.now(),
      });
      this.maybeScheduleMemory(session.id);
    } catch (err) {
      logger.warn({ err: (err as Error).message, sessionId: session.id }, '生成回复失败');
      this.events.emit('error', { sessionId: session.id, message: (err as Error).message, at: Date.now() });
    }
  }

  private async generateReply(session: any, items: BatchItem[]): Promise<{
    plan: ReplyPlan;
    modelRef: string;
    capabilityPath: string;
    costCny: number;
    imagePath: string;
  }> {
    const chatModel = resolveRole(this.store, 'chat');
    if (!chatModel) throw new Error('没有可用的主对话模型，请先在后台配置 Provider / API Key');
    const persona = (session.persona_id && this.store.getPersona(session.persona_id)) || this.store.getActivePersona();
    if (!persona) throw new Error('还没有人格配置');

    const images: IncomingImage[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      for (const segment of item.segments.filter((s) => s.type === 'image')) {
        const image = await segmentToImage(this.store, segment);
        if (!image || seen.has(image.sha256)) continue;
        seen.add(image.sha256);
        let description = '';
        if (!chatModel.capabilities.vision) {
          const described = await describeImage({
            store: this.store,
            buffer: image.buffer,
            mime: image.mime,
            sha256: image.sha256,
            timezone: this.config.timezone,
            sessionId: session.id,
          });
          description = described?.description ?? '';
        }
        images.push({
          mimeType: image.mime,
          dataBase64: image.buffer.toString('base64'),
          description,
          sha256: image.sha256,
        });
      }
    }

    const incoming: IncomingMessage[] = items.map((item) => ({
      senderId: item.senderId,
      senderName: item.senderName,
      text: item.text,
      messageId: item.messageId,
      createdAt: item.createdAt,
    }));

    const context = buildContext({
      store: this.store,
      session,
      persona,
      capabilities: chatModel.capabilities,
      model: chatModel.model,
      incoming,
      images,
      mentioned: items.some((i) => isMentioned(i.segments, session.account_id, this.aliases())),
      replyToBot: items.some((i) => i.replyToBot),
      historyBefore: items[0]?.createdAt ? items[0].createdAt - 1 : undefined,
      timezone: this.config.timezone,
      platform: process.platform === 'win32' ? 'Windows' : process.platform === 'linux' ? 'Linux' : process.platform,
      voiceAvailable: voiceStatus().supported,
      stickersAvailable: this.store.listStickers().length > 0,
    });

    if (context.usedTokens > context.budgetTokens * 0.85) {
      // Near the prompt budget: schedule a flush/compaction after this reply.
      // The next turn uses the new summary + facts instead of a huge history.
      this.store.enqueueJob('memory.summarize', { sessionId: session.id }, Date.now() + 1500);
    }

    const result = await callRole(
      this.store,
      'chat',
      context.messages,
      {
        sessionId: session.id,
        purpose: 'chat',
        json: chatModel.capabilities.json,
        maxTokens: 600,
        temperature: 0.9,
        capabilityPath: context.imagePath,
      },
      this.config.timezone,
    );
    const plan = normalizePlan(result.text);
    if (!plan.bubbles.length && !plan.silent) plan.silent = true;
    return {
      plan,
      modelRef: result.ref,
      capabilityPath: context.imagePath,
      costCny: result.costCny,
      imagePath: context.imagePath,
    };
  }

  private maybeScheduleMemory(sessionId: string): void {
    const count = this.store.countMessages(sessionId);
    if (count >= 8 && count % 8 < 2) {
      this.store.enqueueJob('memory.summarize', { sessionId }, Date.now() + 5000);
    }
  }

  async debugChat(input: { sessionId?: string; text: string; images?: Array<{ mimeType: string; dataBase64: string }> }): Promise<DebugResult> {
    const session = input.sessionId
      ? this.store.getSession(input.sessionId)
      : this.store.getOrCreateSession('demo', 'private', 'debug');
    if (!session) throw new Error('会话不存在');
    const senderId = session.kind === 'private' ? session.peer_id : 'debug';
    const segments: OneBotSegment[] = [{ type: 'text', data: { text: input.text } }];
    for (const image of input.images ?? []) {
      if (image?.dataBase64) segments.push({ type: 'image', data: { file: `base64://${image.dataBase64}` } });
    }
    const item: BatchItem = {
      senderId,
      senderName: '你',
      text: input.text || (segments.some((s) => s.type === 'image') ? '[图片]' : ''),
      messageId: null,
      createdAt: Date.now(),
      segments,
      replyToBot: false,
    };
    this.store.addMessage({
      sessionId: session.id,
      accountId: session.account_id,
      direction: 'in',
      senderId,
      senderName: '你',
      segments: item.segments,
      text: input.text,
    });
    const result = await this.generateReply(session, [item]);
    for (const bubble of result.plan.bubbles) {
      this.store.addMessage({
        sessionId: session.id,
        accountId: session.account_id,
        direction: 'out',
        senderId: 'debug',
        senderName: this.store.getSetting('bot.name', '小满'),
        segments: [{ type: 'text', data: { text: bubble } }],
        text: bubble,
        modelRef: result.modelRef,
        capabilityPath: result.capabilityPath,
      });
    }
    return {
      sessionId: session.id,
      silent: result.plan.silent,
      bubbles: result.plan.bubbles,
      sticker: result.plan.sticker,
      model: result.modelRef,
      capabilityPath: result.capabilityPath,
      costCny: result.costCny,
      imagePath: result.imagePath,
    };
  }
}
