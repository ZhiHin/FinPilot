import type { AICompletionRequest, AICompletionResponse, AIProvider } from "../provider";

/**
 * Deterministic stub adapter — the default provider (no key required), the
 * second adapter that proves the interface swaps cleanly (spec B8), and the
 * engine behind all tests (zero network, zero cost).
 *
 * Behavior contract, mirroring how the real pipeline uses providers:
 * - Tool-selection prompts (marked TOOL_SELECTION) answer with bare JSON
 *   naming a tool, chosen by simple keyword rules over the user question.
 * - Phrasing prompts (marked PHRASING) echo the caller-supplied FACTS line
 *   verbatim — the caller's own verified sentence — so numeric verification
 *   passes by construction. It never invents numbers.
 * - Anything else gets a refusal marker, exercising refusal paths.
 */
export class StubProvider implements AIProvider {
  readonly name: string = "stub";
  readonly model: string = "deterministic-stub-v1";

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    const input = lastUser?.content ?? "";
    let text: string;

    if (request.system.includes("TOOL_SELECTION")) {
      text = selectTool(input);
    } else if (request.system.includes("PHRASING")) {
      const factsLine = input
        .split("\n")
        .find((line) => line.startsWith("FACTS:"))
        ?.slice("FACTS:".length)
        .trim();
      text = factsLine ?? "REFUSE";
    } else {
      text = "REFUSE";
    }
    return {
      text,
      inputTokens: Math.ceil((request.system.length + input.length) / 4),
      outputTokens: Math.ceil(text.length / 4),
    };
  }
}

/**
 * Golden-fixture adapter (`AI_PROVIDER=stub-wrong`): phrases with a
 * FABRICATED amount so the B5 numeric-verification layer must reject it and
 * fall back to the deterministic text. Exists purely to prove, through the
 * real pipeline, that unverified numbers can never reach the user.
 */
export class WrongNumberStubProvider extends StubProvider {
  override readonly name = "stub-wrong";
  override readonly model = "deterministic-stub-wrong-v1";

  override async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const result = await super.complete(request);
    if (request.system.includes("PHRASING")) {
      return { ...result, text: `${result.text} Also, you spent RM 999,999.99 on mistakes.` };
    }
    return result;
  }
}

/** Keyword routing over the question segment (delimited as data by the caller). */
function selectTool(input: string): string {
  const question = (input.match(/<question>([\s\S]*?)<\/question>/)?.[1] ?? "").toLowerCase();
  const afford = question.match(/afford[^\d]*(?:rm\s?)?([\d,]+(?:\.\d{1,2})?)/i);
  if (afford) {
    return JSON.stringify({
      tool: "run_affordability_check",
      args: { amount: afford[1].replaceAll(",", "") },
    });
  }
  if (/safe to spend|how much can i spend/.test(question)) {
    return JSON.stringify({ tool: "get_safe_to_spend", args: {} });
  }
  if (/bill|due|upcoming|renewal/.test(question)) {
    return JSON.stringify({ tool: "get_upcoming_bills", args: { days: 14 } });
  }
  if (/goal|saving/.test(question)) {
    return JSON.stringify({ tool: "get_goal_status", args: {} });
  }
  if (/spend more|spending|spent|why did/.test(question)) {
    return JSON.stringify({ tool: "get_spending_summary", args: { period: "last-month" } });
  }
  return JSON.stringify({ tool: "refuse", args: {} });
}
