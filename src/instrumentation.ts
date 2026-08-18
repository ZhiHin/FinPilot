/**
 * Server bootstrap (Next.js instrumentation): starts the PostgreSQL-backed job
 * workers once per server instance. The app remains usable if the queue fails
 * to start — imports then surface a queue error instead of progressing, and
 * the daily purge simply waits for the next healthy boot.
 */

const STARTED = Symbol.for("finpilot.jobs.started");

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const globalState = globalThis as { [STARTED]?: boolean };
  if (globalState[STARTED]) return;
  globalState[STARTED] = true;

  const { logError, logInfo } = await import("./server/observability/logger");
  try {
    const { registerImportWorkers, registerMaintenanceWorkers } =
      await import("./server/jobs/workers");
    await registerImportWorkers();
    await registerMaintenanceWorkers();
    logInfo("jobs", "import + maintenance workers registered");
  } catch (error) {
    logError("jobs", error);
  }
}
