import { describe, expect, it } from 'vitest';
import { checkAccess, groupShouldSpeak } from '../src/chat/policy.js';
import { makeStore } from './helpers.js';

describe('access policy', () => {
  it('denies private chats when the whitelist is empty', () => {
    const store = makeStore();
    const result = checkAccess(store, {
      kind: 'private',
      peerId: '10001',
      senderId: '10001',
      selfId: '99999',
      ownerQq: '',
      segments: [],
      aliases: [],
    });
    expect(result.allowed).toBe(false);
  });

  it('allows a whitelisted private chat and denies a blacklisted one', () => {
    const store = makeStore();
    store.upsertPolicy({ scope: 'private', action: 'allow', targetId: '10001' });
    store.upsertPolicy({ scope: 'private', action: 'deny', targetId: '10002' });
    expect(checkAccess(store, {
      kind: 'private', peerId: '10001', senderId: '10001', selfId: '99999', ownerQq: '', segments: [], aliases: [],
    }).allowed).toBe(true);
    expect(checkAccess(store, {
      kind: 'private', peerId: '10002', senderId: '10002', selfId: '99999', ownerQq: '', segments: [], aliases: [],
    }).allowed).toBe(false);
  });

  it('always allows the owner', () => {
    const store = makeStore();
    const result = checkAccess(store, {
      kind: 'private', peerId: '10001', senderId: '10001', selfId: '99999', ownerQq: '10001', segments: [], aliases: [],
    });
    expect(result.allowed).toBe(true);
    expect(result.owner).toBe(true);
  });

  it('detects group mentions and respects group whitelist', () => {
    const store = makeStore();
    store.upsertPolicy({ scope: 'group', action: 'allow', targetId: '20001' });
    const result = checkAccess(store, {
      kind: 'group',
      peerId: '20001',
      groupId: '20001',
      senderId: '10001',
      selfId: '99999',
      ownerQq: '',
      segments: [{ type: 'at', data: { qq: '99999' } }, { type: 'text', data: { text: ' 在吗' } }],
      aliases: ['小满'],
    });
    expect(result.allowed).toBe(true);
    expect(result.mentioned).toBe(true);
  });
});

describe('group attention', () => {
  it('always replies when mentioned', () => {
    const result = groupShouldSpeak({
      mode: 'mention_only', mentioned: true, replyToBot: false, text: '', settings: {}, botSpokeRecently: false, messagesLastHour: 0, botMessagesLastHour: 0, quiet: false,
    });
    expect(result.speak).toBe(true);
  });

  it('stays silent in mention_only when not mentioned', () => {
    const result = groupShouldSpeak({
      mode: 'mention_only', mentioned: false, replyToBot: false, text: '今天好热', settings: {}, botSpokeRecently: false, messagesLastHour: 0, botMessagesLastHour: 0, quiet: false,
    });
    expect(result.speak).toBe(false);
  });

  it('can interject in smart mode when the score clears the threshold', () => {
    const result = groupShouldSpeak({
      mode: 'smart',
      mentioned: false,
      replyToBot: false,
      text: '有人知道这个怎么弄吗？',
      settings: { groupAttentionThreshold: 3, groupReplyProbability: 1 },
      botSpokeRecently: false,
      messagesLastHour: 2,
      botMessagesLastHour: 0,
      quiet: false,
    });
    expect(result.score).toBeGreaterThanOrEqual(3);
    expect(result.speak).toBe(true);
  });

  it('honours quiet hours and cooldown', () => {
    expect(groupShouldSpeak({
      mode: 'smart', mentioned: false, replyToBot: false, text: '有人吗？', settings: {}, botSpokeRecently: false, messagesLastHour: 0, botMessagesLastHour: 0, quiet: true,
    }).speak).toBe(false);
    expect(groupShouldSpeak({
      mode: 'smart', mentioned: false, replyToBot: false, text: '有人吗？', settings: {}, botSpokeRecently: true, messagesLastHour: 0, botMessagesLastHour: 0, quiet: false,
    }).speak).toBe(false);
  });
});
