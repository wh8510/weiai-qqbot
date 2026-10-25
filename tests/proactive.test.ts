import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { ProactiveScheduler } from '../src/proactive/scheduler.js';
import { makeStore, seedDemo } from './helpers.js';

const config = {
  timezone: 'Asia/Shanghai',
  demo: true,
  dataDir: 'data-test',
} as any;

describe('proactive scheduler', () => {
  it('generates a preview without enqueueing', async () => {
    const store = makeStore();
    seedDemo(store);
    const session = store.getOrCreateSession('999', 'private', '10001');
    const scheduler = new ProactiveScheduler(store, config, new EventEmitter());
    const result = await scheduler.test(session.id);
    expect(result.plan.bubbles.length).toBeGreaterThan(0);
    expect(store.countPendingOutbox(session.id)).toBe(0);
  });

  it('enqueues proactive bubbles when explicitly requested', async () => {
    const store = makeStore();
    seedDemo(store);
    const session = store.getOrCreateSession('999', 'private', '10001');
    const scheduler = new ProactiveScheduler(store, config, new EventEmitter());
    const result = await scheduler.test(session.id, true);
    expect(result.plan.bubbles.length).toBeGreaterThan(0);
    expect(store.countPendingOutbox(session.id)).toBe(result.plan.bubbles.length);
  });
});
