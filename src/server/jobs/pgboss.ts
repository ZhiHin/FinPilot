import { PgBoss } from "pg-boss";

import { logError } from "../observability/logger";
import type { JobQueue, JobSendOptions } from "./queue";

/**
 * pg-boss adapter (owns its own `pgboss` schema in the same PostgreSQL).
 * Singleton per process; queues are created on first use.
 */

let bossPromise: Promise<PgBoss> | null = null;
const createdQueues = new Set<string>();

async function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set — the job queue needs the database.");
    }
    const boss = new PgBoss(connectionString);
    boss.on("error", (error) => {
      logError("jobs.pgboss", error);
    });
    bossPromise = boss.start();
  }
  return bossPromise;
}

async function ensureQueue(boss: PgBoss, name: string): Promise<void> {
  if (createdQueues.has(name)) return;
  await boss.createQueue(name);
  createdQueues.add(name);
}

export function getJobQueue(): JobQueue {
  return {
    async send(name: string, payload: object, options: JobSendOptions = {}): Promise<void> {
      const boss = await getBoss();
      await ensureQueue(boss, name);
      await boss.send(name, payload, {
        retryLimit: options.retryLimit ?? 3,
        retryDelay: options.retryDelaySeconds ?? 5,
        retryBackoff: true,
      });
    },

    async work<T extends object>(
      name: string,
      handler: (payload: T) => Promise<void>,
    ): Promise<void> {
      const boss = await getBoss();
      await ensureQueue(boss, name);
      await boss.work<T>(name, async (jobs) => {
        for (const job of jobs) {
          await handler(job.data);
        }
      });
    },

    async schedule(name: string, cron: string): Promise<void> {
      const boss = await getBoss();
      await ensureQueue(boss, name);
      await boss.schedule(name, cron, {}, { tz: "Asia/Kuala_Lumpur" });
    },

    async stop(): Promise<void> {
      if (bossPromise) {
        const boss = await bossPromise;
        await boss.stop();
        bossPromise = null;
        createdQueues.clear();
      }
    },
  };
}
