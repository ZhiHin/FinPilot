import type { AICompletionRequest, AICompletionResponse, AIProvider } from "../provider";

/**
 * Anthropic adapter over the plain Messages API (no SDK dependency — the
 * provider boundary stays a single fetch). Selected only via configuration:
 * `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (+ optional `AI_MODEL`).
 * Never constructed in tests or without a key; the gateway routes Privacy-
 * Mode and non-consented users away before any adapter is reached.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model ?? "claude-sonnet-5";
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      // Status only — no response body in errors (may echo request content).
      throw new Error(`provider http ${response.status}`);
    }
    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (data.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    return {
      text,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
  }
}
