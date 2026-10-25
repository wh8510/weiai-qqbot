import type { Store } from '../store.js';
import { logger } from '../logger.js';
import { summarizeSession, writeDiary } from './service.js';

export class MemoryWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private store: Store, private timezone: string) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), 5000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const jobs = this.store.listDueJobs(Date.now(), 3);
      for (const job of jobs) {
        if (job.type !== 'memory.summarize' && job.type !== 'memory.diary') continue;
        this.store.markJob(job.id, 'running');
        try {
          if (job.type === 'memory.summarize') await summarizeSession(this.store, job.payload.sessionId, this.timezone);
          else await writeDiary(this.store, job.payload.sessionId, this.timezone);
          this.store.markJob(job.id, 'done');
        } catch (err) {
          logger.warn({ err: (err as Error).message, job: job.id }, '记忆任务失败');
          this.store.markJob(job.id, job.attempts >= 2 ? 'failed' : 'pending');
        }
      }
    } finally {
      this.running = false;
    }
  }
}
