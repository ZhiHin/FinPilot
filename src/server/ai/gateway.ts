import { and, eq, gte, sql } from "drizzle-orm";

import { uuidv7 } from "@/lib/ids";
import type { Db } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { aiRequests } from "@/server/db/schema";

import { AnthropicProvider } from "./adapters/anthropic";
import { StubProvider, WrongNumberStubProvider } from "./adapters/stub";
import type { AICompletionRequest, AICompletionResponse, AIProvider } from "./provider";

/**
 * The single AI chokepoint. EVERY generative call flows through here:
 * - Privacy Mode ON, missing AI consent, or the product kill switch
 *   (`AI_DISABLED=1`) → status "refused", no adapter is ever reached
 *   (spec B6 — enforced at the gateway, e2e network-asserted).
 * - Every call (including refusals and errors) is logged to `ai_requests`
 *   as metadata only: feature, provider, model, prompt version, tokens,
 *   duration, status, redacted error. Never prompts, never financial data.
 * - Errors/timeouts return null — callers always have a deterministic
 *   fallback (ADR-011).
 */

export type RefusalReason = "privacy_mode" | "no_consent" | "disabled" | "rate_limited";

export type GatewayOutcome =
  | { status: "ok"; response: AICompletionResponse; provider: string; model: string }
  | { status: "refused"; reason: RefusalReason }
  | { status: "error" };

/**
 * Per-user cap on provider calls per hour (risk register R7, threat model
 * "resource abuse"). Counted from `ai_requests` — the same table the activity
 * page shows — so the budget is auditable. Refusals and fallbacks don't count:
 * they never reached a provider.
 */
export const AI_CALLS_PER_HOUR = 60;

async function overCallBudget(db: Db, userId: string): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiRequests)
    .where(
      and(
        eq(aiRequests.userId, userId),
        gte(aiRequests.createdAt, since),
        sql`${aiRequests.status} in ('ok', 'error')`,
      ),
    );
  return (row?.n ?? 0) >= AI_CALLS_PER_HOUR;
}

function resolveProvider(): AIProvider {
  if (process.env.AI_PROVIDER === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider(process.env.ANTHROPIC_API_KEY, process.env.AI_MODEL);
  }
  if (process.env.AI_PROVIDER === "stub-wrong") {
    // Golden-fixture provider: fabricates a number so B5 verification must
    // reject it. Test configuration only.
    return new WrongNumberStubProvider();
  }
  return new StubProvider();
}

async function log(
  db: Db,
  entry: {
    userId: string | null;
    feature: string;
    provider: string;
    model: string;
    promptVersion: string;
    inputTokens?: number;
    outputTokens?: number;
    durationMs?: number;
    status: "ok" | "error" | "refused" | "fallback";
    errorRedacted?: string | null;
  },
): Promise<void> {
  await db.insert(aiRequests).values({
    id: uuidv7(),
    userId: entry.userId,
    feature: entry.feature,
    provider: entry.provider,
    model: entry.model,
    promptVersion: entry.promptVersion,
    inputTokens: entry.inputTokens ?? 0,
    outputTokens: entry.outputTokens ?? 0,
    durationMs: entry.durationMs ?? 0,
    status: entry.status,
    errorRedacted: entry.errorRedacted ?? null,
  });
}

export async function aiAvailability(
  db: Db,
  userId: string,
): Promise<{ available: boolean; reason?: "privacy_mode" | "no_consent" | "disabled" }> {
  if (process.env.AI_DISABLED === "1") return { available: false, reason: "disabled" };
  const prefs = await preferencesRepo.get(db, userId);
  if (prefs?.privacyMode) return { available: false, reason: "privacy_mode" };
  if (!prefs?.aiConsentAt) return { available: false, reason: "no_consent" };
  return { available: true };
}

export async function aiComplete(
  db: Db,
  input: {
    userId: string;
    feature: "assistant" | "insight" | "suggestion" | "categorize";
    promptVersion: string;
    request: AICompletionRequest;
  },
): Promise<GatewayOutcome> {
  const provider = resolveProvider();
  const availability = await aiAvailability(db, input.userId);
  if (!availability.available) {
    await log(db, {
      userId: input.userId,
      feature: input.feature,
      provider: provider.name,
      model: provider.model,
      promptVersion: input.promptVersion,
      status: "refused",
      errorRedacted: availability.reason,
    });
    return { status: "refused", reason: availability.reason! };
  }

  if (await overCallBudget(db, input.userId)) {
    await log(db, {
      userId: input.userId,
      feature: input.feature,
      provider: provider.name,
      model: provider.model,
      promptVersion: input.promptVersion,
      status: "refused",
      errorRedacted: "rate_limited",
    });
    return { status: "refused", reason: "rate_limited" };
  }

  const start = Date.now();
  try {
    const response = await provider.complete(input.request);
    await log(db, {
      userId: input.userId,
      feature: input.feature,
      provider: provider.name,
      model: provider.model,
      promptVersion: input.promptVersion,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      durationMs: Date.now() - start,
      status: "ok",
    });
    return { status: "ok", response, provider: provider.name, model: provider.model };
  } catch (error) {
    await log(db, {
      userId: input.userId,
      feature: input.feature,
      provider: provider.name,
      model: provider.model,
      promptVersion: input.promptVersion,
      durationMs: Date.now() - start,
      status: "error",
      errorRedacted: error instanceof Error ? error.message.slice(0, 120) : "unknown",
    });
    return { status: "error" };
  }
}

/** Callers report a verification fallback so the activity log stays honest. */
export async function logFallback(
  db: Db,
  input: { userId: string; feature: string; promptVersion: string; reason: string },
): Promise<void> {
  const provider = resolveProvider();
  await log(db, {
    userId: input.userId,
    feature: input.feature,
    provider: provider.name,
    model: provider.model,
    promptVersion: input.promptVersion,
    status: "fallback",
    errorRedacted: input.reason.slice(0, 120),
  });
}
