import { and, eq, inArray, sql } from "drizzle-orm";

import { aiComplete, logFallback } from "@/server/ai/gateway";
import { PHRASING_PROMPT } from "@/server/ai/prompts";
import { extractClaims, verifyNumericClaims } from "@/server/ai/verify";
import type { Db } from "@/server/db/client";
import { insights } from "@/server/db/schema";

/**
 * Generative insight phrasing (spec B5). The deterministic body IS the fact
 * sheet: its numbers define the complete set of legal claims. The provider
 * may rephrase; the result renders only if every RM amount and percentage in
 * it verifies against that set — otherwise the deterministic body stays and a
 * fallback is logged. Privacy Mode / no consent never reaches a provider
 * (gateway-refused) and the deterministic body simply remains (ADR-011).
 */

export const phrasingService = {
  /** Phrase up to `limit` still-deterministic insights; quiet no-op otherwise. */
  async phrasePendingInsights(
    db: Db,
    userId: string,
    limit = 5,
  ): Promise<{ phrased: number; fallbacks: number }> {
    const rows = await db
      .select()
      .from(insights)
      .where(
        and(
          eq(insights.userId, userId),
          eq(insights.generatedBy, "deterministic"),
          inArray(insights.status, ["new", "read"]),
        ),
      )
      .orderBy(sql`${insights.createdAt} desc`)
      .limit(limit);

    let phrased = 0;
    let fallbacks = 0;
    for (const insight of rows) {
      const outcome = await aiComplete(db, {
        userId,
        feature: "insight",
        promptVersion: `${PHRASING_PROMPT.id}@${PHRASING_PROMPT.version}`,
        request: {
          system: PHRASING_PROMPT.system,
          messages: [
            {
              role: "user",
              content: `FACTS: ${insight.body}\nDATA: ${JSON.stringify(insight.comparison)}`,
            },
          ],
          maxTokens: 300,
        },
      });
      if (outcome.status === "refused") return { phrased, fallbacks }; // stays deterministic
      if (outcome.status === "error") continue;
      const text = outcome.response.text.trim();
      if (!text || text === "REFUSE") continue;
      if (text === insight.body) continue; // provider echoed — nothing gained

      const verification = verifyNumericClaims(text, extractClaims(insight.body));
      if (!verification.ok) {
        fallbacks += 1;
        await logFallback(db, {
          userId,
          feature: "insight",
          promptVersion: `${PHRASING_PROMPT.id}@${PHRASING_PROMPT.version}`,
          reason: `numeric verification failed: ${verification.failures[0] ?? ""}`,
        });
        continue;
      }
      await db
        .update(insights)
        .set({
          body: text,
          generatedBy: "generative",
          model: outcome.model,
          promptVersion: `${PHRASING_PROMPT.id}@${PHRASING_PROMPT.version}`,
        })
        .where(eq(insights.id, insight.id));
      phrased += 1;
    }
    return { phrased, fallbacks };
  },
} as const;
