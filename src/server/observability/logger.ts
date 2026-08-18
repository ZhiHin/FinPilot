import pino from "pino";

/**
 * Structured server logging (Phase 10, spec G6 / risk doc "redacted logging").
 *
 * Contract: log lines are JSON on stdout and NEVER carry raw financial detail
 * or secrets — amounts, balances, descriptions, notes, titles, merchant
 * names, emails, tokens, passwords. Every context object passes through
 * scrubForLogging() (unit-tested); the safe payload is ids, counts,
 * durations, statuses, and error classes.
 */

const REDACTED = "[redacted]";
const MAX_DEPTH = 6;
const MAX_STRING = 300;

/** Key patterns (full-key match, case-insensitive) whose VALUES never appear in logs. */
const SENSITIVE_KEY_PATTERNS = [
  /pass(word)?/,
  /.*secret.*/,
  /.*token.*/,
  /cookie/,
  /authorization/,
  /api[_-]?key/,
  /email/,
  /phone/,
  /address/,
  /description(_?(original|clean))?/,
  /notes?/,
  /title/,
  /body/,
  /.*merchant.*/,
  /display[_-]?name/,
  /canonical[_-]?name/,
  /filename/,
  /search/,
  /question/,
  /prompt/,
  /.*amount.*/,
  /.*minor/,
  /.*balance.*/,
  /diff/,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((p) => new RegExp(`^${p.source}$`, "i").test(key));
}

/** Deep-copies a context value with sensitive keys redacted and strings capped. */
export function scrubForLogging(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { error: value.name, message: scrubForLogging(value.message, depth + 1) };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => scrubForLogging(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : scrubForLogging(item, depth + 1);
    }
    return out;
  }
  return REDACTED;
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

/** Scope + message + scrubbed context; use for operational events. */
export function logInfo(scope: string, message: string, context?: Record<string, unknown>): void {
  logger.info({ scope, ...(context ? { context: scrubForLogging(context) } : {}) }, message);
}

export function logWarn(scope: string, message: string, context?: Record<string, unknown>): void {
  logger.warn({ scope, ...(context ? { context: scrubForLogging(context) } : {}) }, message);
}

export function logError(scope: string, error: unknown, context?: Record<string, unknown>): void {
  logger.error(
    {
      scope,
      error: scrubForLogging(error),
      ...(context ? { context: scrubForLogging(context) } : {}),
    },
    error instanceof Error ? error.message : "error",
  );
}
