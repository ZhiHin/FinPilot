"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { askAssistantAction, type AssistantFormState } from "./actions";

/**
 * The assistant (UX §4.7): never chat-only. Every answer is a structured card
 * — conclusion, evidence table straight from the tool result, the filters and
 * period used, assumptions, a non-advisory notice, and links to the
 * underlying screens.
 */
export function AssistantPanel({ suggestedQuestions }: { suggestedQuestions: string[] }) {
  const [state, formAction, pending] = useActionState<AssistantFormState, FormData>(
    askAssistantAction,
    null,
  );

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="assistant-question" className="sr-only">
          Ask about your finances
        </label>
        <Input
          id="assistant-question"
          name="question"
          placeholder="Ask about your own numbers, e.g. “What bills are due soon?”"
          maxLength={300}
          defaultValue={state?.question ?? ""}
          className="flex-1"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Working…" : "Ask"}
        </Button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {suggestedQuestions.map((question) => (
          <form key={question} action={formAction}>
            <input type="hidden" name="question" value={question} />
            <button
              type="submit"
              disabled={pending}
              className="rounded-chip bg-sunken px-3 py-1 text-[12.5px] text-ink-secondary hover:bg-accent-soft hover:text-accent"
            >
              {question}
            </button>
          </form>
        ))}
      </div>

      {state?.answer.kind === "refusal" ? (
        <Banner variant="info">{state.answer.message}</Banner>
      ) : null}
      {state?.answer.kind === "unavailable" ? (
        <Banner variant="info">
          {state.answer.reason === "privacy_mode"
            ? "Privacy Mode is on, so the assistant is off — no data leaves FinPilot. Every deterministic feature keeps working."
            : state.answer.reason === "no_consent"
              ? "The assistant needs your AI consent. You can grant it in Settings → Privacy & AI."
              : "AI features are currently disabled."}
        </Banner>
      ) : null}

      {state?.answer.kind === "card" ? (
        <article
          aria-label="Assistant answer"
          className="flex flex-col gap-3 rounded-card border border-hairline bg-card p-4"
        >
          <p className="text-[15px] text-ink">{state.answer.conclusion}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <caption className="sr-only">Evidence for this answer</caption>
              <tbody>
                {state.answer.card.evidence.map((row) => (
                  <tr key={row.label} className="border-b border-hairline last:border-0">
                    <td className="py-1 pr-3 text-ink-secondary">{row.label}</td>
                    <td className="num py-1 text-right">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11.5px] text-ink-muted">
            Used: {state.answer.card.tool} ·{" "}
            {Object.entries(state.answer.card.filters)
              .map(([key, value]) => `${key}=${value}`)
              .join(" · ")}
          </p>
          {state.answer.card.assumptions.length > 0 ? (
            <ul className="list-disc pl-5 text-[11.5px] text-ink-muted">
              {state.answer.card.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-3 text-[13px]">
            {state.answer.card.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="font-medium text-accent underline underline-offset-2"
              >
                {link.label}
              </Link>
            ))}
          </div>
          <p className="text-[11.5px] text-ink-muted">
            Numbers come from your ledger via typed tools; the answer text is verified against them
            ({state.answer.phrasedBy === "model" ? "AI-phrased" : "deterministic phrasing"}).
            Educational information, not financial advice.
          </p>
        </article>
      ) : null}
    </div>
  );
}
