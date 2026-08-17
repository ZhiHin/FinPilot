import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { aiRequests } from "@/server/db/schema";

export const metadata: Metadata = { title: "AI activity" };

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "ok":
      return <Badge variant="positive">ok</Badge>;
    case "fallback":
      return <Badge variant="attention">fallback</Badge>;
    case "refused":
      return <Badge>refused</Badge>;
    default:
      return <Badge variant="risk">error</Badge>;
  }
}

export default async function AiActivityPage() {
  const { user } = await requireUser();
  const db = getDb();
  const rows = await db
    .select()
    .from(aiRequests)
    .where(eq(aiRequests.userId, user.id))
    .orderBy(desc(aiRequests.createdAt))
    .limit(100);

  return (
    <>
      <PageHeader
        title="AI activity"
        description="Every AI call made for your account — including refusals and verification fallbacks. Metadata only: no prompts and no financial data are ever stored here."
        actions={
          <Link
            href="/insights"
            className="text-[13px] font-medium text-accent underline underline-offset-2 hover:no-underline"
          >
            Back to Insights
          </Link>
        }
      />

      <div className="flex flex-col gap-4">
        <Banner variant="info">
          “refused” means Privacy Mode, missing consent, or the kill switch stopped the call before
          any provider was contacted. “fallback” means generated text failed numeric verification
          and the deterministic version was shown instead.
        </Banner>

        {rows.length === 0 ? (
          <EmptyState
            title="No AI activity yet"
            description="Calls appear here when you use the assistant or when insights are AI-phrased."
          />
        ) : (
          <div className="overflow-x-auto rounded-card border border-hairline bg-card">
            <table className="w-full text-[13px]">
              <caption className="sr-only">
                AI request log: time, feature, provider, model, prompt version, tokens, duration,
                status.
              </caption>
              <thead>
                <tr className="border-b border-hairline text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="px-3 py-2 font-medium">
                    When
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Feature
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Provider · model
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Prompt
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Tokens in/out
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    ms
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-hairline last:border-0">
                    <td className="whitespace-nowrap px-3 py-1.5 text-ink-secondary">
                      {new Intl.DateTimeFormat("en-MY", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "Asia/Kuala_Lumpur",
                      }).format(row.createdAt)}
                    </td>
                    <td className="px-3 py-1.5">{row.feature}</td>
                    <td className="px-3 py-1.5 text-ink-secondary">
                      {row.provider} · {row.model}
                    </td>
                    <td className="px-3 py-1.5 text-ink-secondary">{row.promptVersion}</td>
                    <td className="num px-3 py-1.5 text-right">
                      {row.inputTokens}/{row.outputTokens}
                    </td>
                    <td className="num px-3 py-1.5 text-right">{row.durationMs}</td>
                    <td className="px-3 py-1.5">
                      <StatusBadge status={row.status} />
                      {row.errorRedacted ? (
                        <span className="ml-1.5 text-[11.5px] text-ink-muted">
                          {row.errorRedacted}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
