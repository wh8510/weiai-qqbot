import type { Store } from '../store.js';
import type { OneBotSegment } from '../onebot/types.js';
import { isMentioned } from '../onebot/normalize.js';

export interface AccessInput {
  kind: 'private' | 'group';
  peerId: string;
  groupId?: string | null;
  senderId: string;
  selfId: string;
  ownerQq: string;
  segments: OneBotSegment[];
  aliases: string[];
}

export interface AccessResult {
  allowed: boolean;
  reason: string;
  mentioned: boolean;
  owner: boolean;
  groupMode: 'off' | 'mention_only' | 'smart' | 'active' | 'normal';
}

export function checkAccess(store: Store, input: AccessInput): AccessResult {
  const owner = Boolean(input.ownerQq) && String(input.senderId) === String(input.ownerQq);
  const mentioned = input.kind === 'group' ? isMentioned(input.segments, input.selfId, input.aliases) : true;
  const policy = store.listPolicy().filter((p) => p.enabled);
  const find = (scope: string, action: string, target: string) =>
    policy.find((p) => p.scope === scope && p.action === action && String(p.target_id) === String(target));

  if (input.kind === 'private') {
    if (find('private', 'deny', input.senderId)) {
      return { allowed: false, reason: '私聊黑名单', mentioned, owner, groupMode: 'normal' };
    }
    if (owner) return { allowed: true, reason: 'owner', mentioned, owner, groupMode: 'normal' };
    const allows = policy.filter((p) => p.scope === 'private' && p.action === 'allow');
    if (allows.length > 0 && !find('private', 'allow', input.senderId)) {
      return { allowed: false, reason: '不在私聊白名单', mentioned, owner, groupMode: 'normal' };
    }
    if (allows.length === 0) {
      return { allowed: false, reason: '私聊白名单为空（默认拒绝）', mentioned, owner, groupMode: 'normal' };
    }
    return { allowed: true, reason: 'private allow', mentioned, owner, groupMode: 'normal' };
  }

  const groupId = String(input.groupId ?? input.peerId);
  if (find('group', 'deny', groupId)) {
    return { allowed: false, reason: '群黑名单', mentioned, owner, groupMode: 'off' };
  }
  if (find('group_member', 'deny', input.senderId)) {
    return { allowed: false, reason: '群成员黑名单', mentioned, owner, groupMode: 'off' };
  }
  if (!owner) {
    const allows = policy.filter((p) => p.scope === 'group' && p.action === 'allow');
    if (allows.length > 0 && !find('group', 'allow', groupId)) {
      return { allowed: false, reason: '不在群白名单', mentioned, owner, groupMode: 'off' };
    }
    if (allows.length === 0) {
      return { allowed: false, reason: '群白名单为空（默认拒绝）', mentioned, owner, groupMode: 'off' };
    }
  }
  const session = store.findSession(input.selfId, 'group', groupId);
  const mode = (session?.mode as AccessResult['groupMode']) || 'mention_only';
  return { allowed: true, reason: 'group allow', mentioned, owner, groupMode: mode };
}

export function groupShouldSpeak(input: {
  mode: AccessResult['groupMode'];
  mentioned: boolean;
  replyToBot: boolean;
  text: string;
  settings: Record<string, any>;
  botSpokeRecently: boolean;
  messagesLastHour: number;
  quiet: boolean;
}): { speak: boolean; score: number; reason: string } {
  if (input.mode === 'off') return { speak: false, score: 0, reason: '群已关闭' };
  if (input.mentioned || input.replyToBot) return { speak: true, score: 99, reason: '被点名/回复' };
  if (input.mode === 'mention_only') return { speak: false, score: 0, reason: '仅 @ 时回复' };
  if (input.quiet) return { speak: false, score: 0, reason: '静默时段' };
  if (input.messagesLastHour >= Number(input.settings.maxMessagesPerHour ?? 12)) {
    return { speak: false, score: 0, reason: '本群每小时消息上限' };
  }
  if (input.botSpokeRecently) return { speak: false, score: 0, reason: '刚说过话，冷却中' };

  let score = 0;
  if (/\?|？|吗|怎么|为什么|求助|有没有/.test(input.text)) score += 2;
  if (input.text.length >= 8 && input.text.length <= 200) score += 1;
  if (input.messagesLastHour >= 3) score += 1;
  const threshold = Number(input.settings.groupAttentionThreshold ?? 4);
  const probability = Number(input.settings.groupReplyProbability ?? (input.mode === 'active' ? 0.35 : 0.12));
  if (score < threshold) return { speak: false, score, reason: '注意力分数不足' };
  const speak = Math.random() < probability;
  return { speak, score, reason: speak ? '概率命中' : '概率未命中' };
}
