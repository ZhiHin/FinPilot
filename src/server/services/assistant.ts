import { z } from "zod";

import { aiComplete, aiAvailability, logFallback, type RefusalReason } from "@/server/ai/gateway";
import { PHRASING_PROMPT, TOOL_SELECTION_PROMPT } from "@/server/ai/prompts";
import { TOOL_NAMES, TOOL_REGISTRY, type ToolCard } from "@/server/ai/tools";
import { verifyNumericClaims } from "@/server/ai/verify";
import type { Db } from "@/server/db/client";

/**
 * The assistant (spec B7): generative composition over STRUCTURED TOOL
 * RESULTS ONLY. The model chooses a tool and phrases the result — it never
 * runs SQL, never touches tables, never performs arithmetic. Every numeric
 * claim in the phrased conclusion is verified against the tool's own numbers
 * (B5); any mismatch falls back to the tool's deterministic facts sentence.
 * User questions are delimited as data (<question>…</question>) and can never
 * become instructions; hostile content at worst mis-picks a tool or earns a
 * refusal — it cannot reach other users' data (tools inject the server-side
 * user id) or fabricate figures (verification).
 */

export type AssistantAnswer =
  | { kind: "card"; card: ToolCard; conclusion: string; phrasedBy: "model" | "deterministic" }
  | { kind: "refusal"; message: string }
  | { kind: "unavailable"; reason: RefusalReason };

const toolChoiceSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
});

const REFUSAL_MESSAGE =
  "I can only answer questions about your own FinPilot data — spending, bills, safe-to-spend, goals, and affordability checks. Try one of the suggested questions.";

export const assistantService = {
  async ask(db: Db, userId: string, question: string, today: string): Promise<AssistantAnswer> {
    const availability = await aiAvailability(db, userId);
    if (!availability.available) {
      return { kind: "unavailable", reason: availability.reason! };
    }
    const trimmed = question.trim().slice(0, 300);
    if (!trimmed) return { kind: "refusal", message: REFUSAL_MESSAGE };

    // 1) Tool selection — the question crosses as delimited data only.
    const selection = await aiComplete(db, {
      userId,
      feature: "assistant",
      promptVersion: `${TOOL_SELECTION_PROMPT.id}@${TOOL_SELECTION_PROMPT.version}`,
      request: {
        system: `${TOOL_SELECTION_PROMPT.system} Available tools: ${TOOL_NAMES.join(", ")}.`,
        messages: [{ role: "user", content: `<question>${trimmed}</question>` }],
        maxTokens: 200,
      },
    });
    if (selection.status === "refused") {
      return { kind: "unavailable", reason: selection.reason };
    }
    if (selection.status === "error") {
      return { kind: "refusal", message: REFUSAL_MESSAGE };
    }

    let choice: z.infer<typeof toolChoiceSchema>;
    try {
      choice = toolChoiceSchema.parse(JSON.parse(selection.response.text));
    } catch {
      return { kind: "refusal", message: REFUSAL_MESSAGE };
    }
    const runner = TOOL_REGISTRY[choice.tool];
    if (!runner) return { kind: "refusal", message: REFUSAL_MESSAGE };

    // 2) Execute the tool with the SERVER-SIDE user id.
    const card = await runner(db, userId, today, choice.args);
    if (!card) return { kind: "refusal", message: REFUSAL_MESSAGE };

    // 3) Phrase, then verify every numeric claim against the tool's numbers.
    const phrasing = await aiComplete(db, {
      userId,
      feature: "assistant",
      promptVersion: `${PHRASING_PROMPT.id}@${PHRASING_PROMPT.version}`,
      request: {
        system: PHRASING_PROMPT.system,
        messages: [
          {
            role: "user",
            content: `FACTS: ${card.facts}\nDATA: ${JSON.stringify(card.evidence)}`,
          },
        ],
        maxTokens: 300,
      },
    });
    if (phrasing.status === "ok" && phrasing.response.text !== "REFUSE") {
      const verification = verifyNumericClaims(phrasing.response.text, card.verified);
      if (verification.ok) {
        return { kind: "card", card, conclusion: phrasing.response.text, phrasedBy: "model" };
      }
      await logFallback(db, {
        userId,
        feature: "assistant",
        promptVersion: `${PHRASING_PROMPT.id}@${PHRASING_PROMPT.version}`,
        reason: `numeric verification failed: ${verification.failures[0] ?? ""}`,
      });
    }
    return { kind: "card", card, conclusion: card.facts, phrasedBy: "deterministic" };
  },
} as const;

export const SUGGESTED_QUESTIONS = [
  "How much can I safely spend this week?",
  "Why did I spend more last month?",
  "What bills are due in the next two weeks?",
  "Can I afford RM 2,800 for a laptop?",
  "How are my savings goals doing?",
];
