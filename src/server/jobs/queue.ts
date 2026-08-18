/**
 * Job-queue interface (architecture doc ADR-006): PostgreSQL-backed via pg-boss,
 * kept replaceable. Handlers must be idempotent — retries re-run them.
 */

export interface JobSendOptions {
  retryLimit?: number;
  retryDelaySeconds?: number;
}

export interface JobQueue {
  send(name: string, payload: object, options?: JobSendOptions): Promise<void>;
  work<T extends object>(name: string, handler: (payload: T) => Promise<void>): Promise<void>;
  /** Recurring job on a cron expression (Asia/Kuala_Lumpur), e.g. the purge. */
  schedule(name: string, cron: string): Promise<void>;
  stop(): Promise<void>;
}

export type EnqueueFn = (name: string, payload: object) => Promise<void>;
