import { getDb } from "../db/client";
import { runCommit, runValidation } from "../services/imports";
import { getJobQueue } from "./pgboss";

export const IMPORT_VALIDATE_JOB = "import.validate";
export const IMPORT_COMMIT_JOB = "import.commit";

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
