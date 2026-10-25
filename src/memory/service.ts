import type { Store } from '../store.js';
import { callRole } from '../models/gateway.js';
import { estimateTokens } from '../models/pricing.js';
import { logger } from '../logger.js';
import { localDateKey } from '../util/time.js';

function parseLoose(text: string): any | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function transcript(store: Store, sessionId: string, limit = 40): string {
  return store
    .listRecentMessages(sessionId, limit)
    .map((m) => {
      const who = m.direction === 'out' ? store.getSetting('bot.name', '小满') : m.sender_name || m.sender_id;
      return `${who}: ${m.text}`;
    })
    .join('\n');
}

export async function summarizeSession(store: Store, sessionId: string, timezone: string): Promise<boolean> {
  const session = store.getSession(sessionId);
  if (!session) return false;
  const messages = store.listRecentMessages(sessionId, 40);
  if (messages.length < 4) return false;
  const previous = store.getSessionSummary(sessionId);
  const facts = store.listFacts(sessionId, 30);
  const openLoops = store.listOpenLoops(sessionId, 'open', 10);

  const prompt = [
    '你在为一段 QQ 聊天做长期记忆整理。只输出 JSON，不要 Markdown。',
    '目标：保留以后聊天真的用得上的信息，不要把寒暄流水账塞进去。',
    '',
    '已有摘要：',
    previous || '（无）',
    '',
    '已有事实：',
    facts.length ? facts.map((f) => `- ${f.subject} ${f.predicate} ${f.object}`).join('\n') : '（无）',
    '',
    '未闭环话题：',
    openLoops.length ? openLoops.map((l) => `- ${l.topic}: ${l.detail}`).join('\n') : '（无）',
    '',
    '最近对话：',
    transcript(store, sessionId, 40),
    '',
    '输出格式：',
    '{"summary":"300字以内的滚动摘要","facts":[{"subject":"用户","predicate":"喜欢","object":"猫","confidence":0.8,"importance":0.6}],"episode":{"title":"一句话标题","summary":"100字以内","valence":0.2,"importance":0.5},"open_loops":[{"topic":"面试","detail":"明天下午面试，之后要问结果"}],"mood":"neutral"}',
    '规则：facts 只保留稳定偏好、重要经历、承诺、关键人物；open_loops 只保留真的需要以后跟进的事；没有就给空数组。',
  ].join('\n');

  try {
    const result = await callRole(
      store,
      'memory',
      [
        { role: 'system', content: '你是一个严谨的长期记忆整理器，只输出合法 JSON。' },
        { role: 'user', content: prompt },
      ],
      { sessionId, purpose: 'memory', json: true, maxTokens: 900, temperature: 0.2 },
      timezone,
    );
    const data = parseLoose(result.text);
    if (!data) {
      logger.warn({ sessionId }, '记忆整理返回的不是 JSON');
      return false;
    }
    if (typeof data.summary === 'string' && data.summary.trim()) {
      store.setSessionSummary(sessionId, data.summary.trim().slice(0, 1200), estimateTokens(data.summary));
    }
    if (Array.isArray(data.facts)) {
      for (const fact of data.facts.slice(0, 12)) {
        if (!fact?.subject || !fact?.predicate || !fact?.object) continue;
        store.upsertFact({
          sessionId,
          subject: String(fact.subject).slice(0, 80),
          predicate: String(fact.predicate).slice(0, 80),
          object: String(fact.object).slice(0, 200),
          confidence: Math.max(0, Math.min(1, Number(fact.confidence ?? 0.7))),
          importance: Math.max(0, Math.min(1, Number(fact.importance ?? 0.5))),
          sourceMessageIds: messages.slice(-8).map((m) => m.id),
        });
      }
    }
    if (data.episode?.title && data.episode?.summary) {
      store.addEpisode({
        sessionId,
        title: String(data.episode.title).slice(0, 120),
        summary: String(data.episode.summary).slice(0, 500),
        valence: Number(data.episode.valence ?? 0),
        importance: Number(data.episode.importance ?? 0.5),
        sourceMessageIds: messages.slice(-8).map((m) => m.id),
      });
    }
    if (Array.isArray(data.open_loops)) {
      for (const loop of data.open_loops.slice(0, 5)) {
        if (!loop?.topic) continue;
        store.upsertOpenLoop({
          sessionId,
          topic: String(loop.topic).slice(0, 80),
          detail: String(loop.detail ?? '').slice(0, 300),
          sourceMessageId: messages[messages.length - 1]?.message_id ?? undefined,
        });
      }
    }
    if (data.mood) store.updateRelationship(sessionId, { mood: String(data.mood).slice(0, 20) });
    return true;
  } catch (err) {
    logger.warn({ err: (err as Error).message, sessionId }, '记忆整理失败');
    return false;
  }
}

export async function writeDiary(store: Store, sessionId: string, timezone: string): Promise<boolean> {
  const session = store.getSession(sessionId);
  if (!session) return false;
  const messages = store.listRecentMessages(sessionId, 60);
  if (messages.length < 4) return false;
  const date = localDateKey(timezone);
  const facts = store.listFacts(sessionId, 20);
  const relationship = store.getRelationship(sessionId);
  const summary = store.getSessionSummary(sessionId);

  const prompt = [
    '用第一人称写一篇很短的日记，像真的网友在 QQ 空间/备忘录里随手写的。',
    '不要写成客服总结，不要列条目，不要 Markdown。100~220 字。',
    `今天是 ${date}。`,
    `关系状态：${JSON.stringify(relationship)}`,
    `摘要：${summary || '（无）'}`,
    `记得的事：${facts.map((f) => `${f.subject}${f.predicate}${f.object}`).join('；') || '（无）'}`,
    '今天聊了：',
    transcript(store, sessionId, 40),
    '只输出日记正文。不要标题，不要引号。',
  ].join('\n');

  try {
    const result = await callRole(
      store,
      'memory',
      [
        { role: 'system', content: '你是一个有连续生活的普通网友，用第一人称写日记。' },
        { role: 'user', content: prompt },
      ],
      { sessionId, purpose: 'diary', json: false, maxTokens: 500, temperature: 0.9 },
      timezone,
    );
    const content = result.text.trim().slice(0, 800);
    if (!content) return false;
    store.upsertDiary({ sessionId, date, content, mood: relationship.mood, importance: 0.6 });
    return true;
  } catch (err) {
    logger.warn({ err: (err as Error).message, sessionId }, '日记生成失败');
    return false;
  }
}
