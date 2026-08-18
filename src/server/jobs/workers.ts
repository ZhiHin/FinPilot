import { getDb } from "../db/client";
import { logInfo } from "../observability/logger";
import { runAccountPurge } from "../services/account-purge";
import { runCommit, runValidation } from "../services/imports";
import { getJobQueue } from "./pgboss";

export const IMPORT_VALIDATE_JOB = "import.validate";
export const IMPORT_COMMIT_JOB = "import.commit";
export const ACCOUNT_PURGE_JOB = "account.purge";
export const ACCOUNT_PURGE_CRON = "30 3 * * *"; // daily, 03:30 Asia/Kuala_Lumpur

interface ImportJobPayload {
  jobId: string;
}

/**
 * Registers the import workers. Executors are idempotent (status guards +
 * conflict-ignoring inserts), so pg-boss retries are safe.
 */
export async function registerImportWorkers(): Promise<void> {
  const queue = getJobQueue();
  await queue.work<ImportJobPayload>(IMPORT_VALIDATE_JOB, async ({ jobId }) => {
    await runValidation(getDb(), jobId);
  });
  await queue.work<ImportJobPayload>(IMPORT_COMMIT_JOB, async ({ jobId }) => {
    await runCommit(getDb(), jobId);
  });
}

/**
 * Daily maintenance: the account purge job (Phase 10, staged deletion).
 * Idempotent — the due query only matches not-yet-purged users.
 */
export async function registerMaintenanceWorkers(): Promise<void> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set — the purge job needs it for audit subject hashes.");
  }
  const queue = getJobQueue();
  await queue.work(ACCOUNT_PURGE_JOB, async () => {
    const { purged } = await runAccountPurge(getDb(), { secret });
    if (purged > 0) {
      logInfo("jobs.account_purge", "purged accounts past their recovery window", { purged });
    }
  });
  await queue.schedule(ACCOUNT_PURGE_JOB, ACCOUNT_PURGE_CRON);
}
