/**
 * Provider-independent AI interface (ADR-012, spec B8). The application binds
 * a provider only via configuration (`AI_PROVIDER`, `AI_MODEL`, provider key
 * env vars) — swapping providers touches nothing outside `adapters/`. The
 * stub adapter is the default and proves the interface; it also powers every
 * test with zero network access.
 */

export interface AIMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AICompletionRequest {
  system: string;
  messages: AIMessage[];
  maxTokens: number;
}

export interface AICompletionResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  complete(request: AICompletionRequest): Promise<AICompletionResponse>;
}
