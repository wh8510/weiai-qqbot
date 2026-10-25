import { EventEmitter } from 'node:events';
import type { Store } from '../store.js';
import type { AppConfig } from '../config.js';
import { logger } from '../logger.js';
import { callRole, resolveRole } from '../models/gateway.js';
import { buildSystemPrompt } from '../chat/persona.js';
import { normalizePlan, timeBubbles } from '../chat/planner.js';
import { isQuietHours, localDateKey, startOfLocalDay } from '../util/time.js';
import { voiceStatus } from '../media/tts.js';

export class ProactiveScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private store: Store,
    private config: AppConfig,
    private events: EventEmitter,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref?.();
    setTimeout(() => void this.tick(), 15_000).unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private sessionSettings(session: any): Record<string, any> {
    try {
      return JSON.parse(session.settings_json || '{}');
    } catch {
      return {};
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      this.store.setSetting('proactive.last_tick_at', String(Date.now()));
      this.maybeScheduleDiaries();
      if (!this.store.getSettingBool('proactive.enabled', true)) return;
      if (isQuietHours(this.config.timezone, this.store.getSetting('proactive.quiet_start', '23:30'), this.store.getSetting('proactive.quiet_end', '08:00'))) return;

      const since = startOfLocalDay(this.config.timezone);
      const globalCap = this.store.getSettingInt('budget.proactive_daily', 20);
      if (this.store.countAllOutboxByKindSince('proactive', since) >= globalCap) return;

      const sessions = this.store.listSessions(200);
      for (const session of sessions) {
        if (this.store.countPendingOutbox(session.id) > 0) continue;
        const settings = this.sessionSettings(session);
        if (settings.paused === true) continue;
        if (
          isQuietHours(
            this.config.timezone,
            String(settings.quietStart ?? this.store.getSetting('proactive.quiet_start', '23:30')),
            String(settings.quietEnd ?? this.store.getSetting('proactive.quiet_end', '08:00')),
          )
        ) {
          continue;
        }

        const lastIn = this.store.lastIncomingAt(session.id) ?? 0;

        if (session.kind === 'group') {
          if (!['smart', 'active'].includes(session.mode)) continue;
          if (Date.now() - lastIn > 30 * 60_000) continue;
          if (Math.random() > 0.006) continue;
          const cap = Number(settings.proactiveDailyCap ?? this.store.getSetting('proactive.group_daily_cap', '2'));
          if (this.store.countOutboxByKindSince(session.id, 'proactive', since) >= cap) continue;
          await this.generate(session, 'group');
        } else {
          if (Date.now() - lastIn < 20 * 60_000) continue;
          const unanswered = this.store.countOutgoingSince(session.id, lastIn);
          if (unanswered >= 2) continue;
          const minInterval = Number(settings.proactiveMinIntervalMin ?? this.store.getSetting('proactive.min_interval_min', '120'));
          const lastOut = this.store.lastOutgoingAt(session.id) ?? 0;
          if (Date.now() - lastOut < minInterval * 60_000) continue;
          if (Math.random() > 0.025) continue;
          const cap = Number(settings.proactiveDailyCap ?? this.store.getSetting('proactive.private_daily_cap', '2'));
          if (this.store.countOutboxByKindSince(session.id, 'proactive', since) >= cap) continue;
          await this.generate(session, 'private');
        }
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '主动消息调度失败');
    } finally {
      this.running = false;
    }
  }

  private maybeScheduleDiaries(): void {
    const now = new Date();
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: this.config.timezone, hour: '2-digit', hour12: false }).format(now));
    if (hour !== 23) return;
    const date = localDateKey(this.config.timezone);
    if (this.store.getSetting('diary.last_date', '') === date) return;
    this.store.setSetting('diary.last_date', date);
    for (const session of this.store.listSessions(100)) {
      if (this.store.countMessages(session.id) < 4) continue;
      this.store.enqueueJob('memory.diary', { sessionId: session.id }, Date.now() + 10_000);
    }
  }

  private lifeState(): string {
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: this.config.timezone, hour: '2-digit', hour12: false }).format(new Date()));
    if (hour < 6) return '凌晨，困，但可能还没睡';
    if (hour < 9) return '早上，刚醒，脑子还没完全转起来';
    if (hour < 12) return '上午，在忙自己的事';
    if (hour < 14) return '中午，吃饭/犯困';
    if (hour < 18) return '下午，有点累，想摸鱼';
    if (hour < 22) return '晚上，精神好一点，想聊天';
    return '深夜，容易说真话，也容易困';
  }

  async generate(session: any, scene: 'private' | 'group', enqueue = true): Promise<any | null> {
    const chatModel = resolveRole(this.store, 'chat');
    if (!chatModel) return null;
    const persona = (session.persona_id && this.store.getPersona(session.persona_id)) || this.store.getActivePersona();
    if (!persona) return null;

    const facts = this.store.listFacts(session.id, 12);
    const diary = this.store.listDiaries(session.id, 1)[0] ?? null;
    const loops = this.store.listOpenLoops(session.id, 'open', 5);
    const relationship = this.store.getRelationship(session.id);
    const summary = this.store.getSessionSummary(session.id);

    const system = buildSystemPrompt({
      persona,
      session,
      capabilities: chatModel.capabilities,
      relationship,
      summary,
      facts,
      episodes: this.store.listEpisodes(session.id, 3),
      diary,
      openLoops: loops,
      timezone: this.config.timezone,
      platform: process.platform === 'win32' ? 'Windows' : 'Linux',
      voiceAvailable: voiceStatus().supported,
      stickersAvailable: this.store.listStickers().length > 0,
      isGroup: scene === 'group',
    });

    const user = [
      scene === 'group'
        ? '群里刚刚还在聊。你有点想插一句，但不是必须。'
        : '现在没有新消息。你突然想主动找对方说点什么。',
      `你现在的状态：${this.lifeState()}。`,
      loops.length
        ? `可以跟进的事：${loops.map((l) => `${l.topic}（${l.detail}）`).join('；')}`
        : '',
      '要求：具体、像真人、不要“在吗/干嘛呢/吃了吗”这种空话；可以关心、分享、吐槽、跟进之前的事。',
      '输出 JSON 回复计划。',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const result = await callRole(
        this.store,
        'chat',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          sessionId: session.id,
          purpose: 'proactive',
          json: chatModel.capabilities.json,
          maxTokens: 400,
          temperature: 0.95,
          capabilityPath: 'proactive',
        },
        this.config.timezone,
      );
      const plan = normalizePlan(result.text);
      if (plan.silent || plan.bubbles.length === 0) return null;

      if (enqueue) {
        const timed = timeBubbles(plan.bubbles);
        for (const bubble of timed) {
          this.store.enqueueOutbox({
            sessionId: session.id,
            accountId: session.account_id,
            kind: 'proactive',
            payload: { text: bubble.text, modelRef: result.ref, capabilityPath: 'proactive' },
            dueAt: Date.now() + bubble.delayMs,
          });
        }
      }
      this.events.emit('proactive', {
        sessionId: session.id,
        bubbles: plan.bubbles,
        at: Date.now(),
        modelRef: result.ref,
      });
      return { plan, modelRef: result.ref, dryRun: !enqueue };
    } catch (err) {
      logger.warn({ err: (err as Error).message, sessionId: session.id }, '主动消息生成失败');
      return null;
    }
  }

  async test(sessionId: string, enqueue = false): Promise<any> {
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error('会话不存在');
    return this.generate(session, session.kind === 'group' ? 'group' : 'private', enqueue);
  }
}
