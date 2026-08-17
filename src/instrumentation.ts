/**
 * Server bootstrap (Next.js instrumentation): starts the PostgreSQL-backed job
 * workers once per server instance. The app remains usable if the queue fails
 * to start — imports then surface a queue error instead of progressing.
 */

const STARTED = Symbol.for("finpilot.jobs.started");

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const globalState = globalThis as { [STARTED]?: boolean };
  if (globalState[STARTED]) return;
  globalState[STARTED] = true;

  try {
    const { registerImportWorkers } = await import("./server/jobs/workers");
    await registerImportWorkers();
    console.log("[jobs] import workers registered");
  } catch (error) {
    console.error(
      "[jobs] failed to start workers:",
      error instanceof Error ? error.message : error,
    );
  }
}
