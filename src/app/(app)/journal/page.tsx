import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { DeleteEntryButton, NewEntryForm, OutcomeReviewForm } from "@/features/journal/entry-forms";
import { formatIsoDate, localDateInTz } from "@/lib/dates";
import { formatMinor } from "@/lib/money";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { journalService } from "@/server/services/journal";
import { scenariosService } from "@/server/services/scenarios";

export const metadata: Metadata = { title: "Decision Journal" };

const KIND_LABELS: Record<string, string> = {
  life_event: "Life event",
  decision: "Decision",
  note: "Note",
};

export default async function JournalPage() {
  const { user } = await requireUser();
  const db = getDb();
  const prefs = await preferencesRepo.get(db, user.id);
  const currency = (prefs?.currency ?? "MYR").trim();
  const today = localDateInTz(new Date(), prefs?.timezone ?? "Asia/Kuala_Lumpur");
  const entries = await journalService.list(db, user.id, today);
  const savedScenarios = (await scenariosService.list(db, user.id))
    .filter((s) => s.status === "saved")
    .map((s) => ({ id: s.id, name: s.name }));
  const due = entries.filter((entry) => entry.reviewDue);

  return (
    <>
      <PageHeader
        title="Decision Journal"
        description="Annotate what was going on when you spent — one-off periods stop distorting your baselines, and decisions get reviewed against what actually happened."
      />

      <div className="flex flex-col gap-4">
        {due.length > 0 ? (
          <section
            aria-labelledby="journal-review-heading"
            className="flex flex-col gap-3 rounded-card border border-hairline bg-card p-4"
          >
            <h2 id="journal-review-heading" className="text-[15px] font-semibold text-ink">
              Outcome reviews due
            </h2>
            {due.map((entry) => (
              <div key={entry.id} className="rounded-control bg-sunken px-3 py-2">
                <p className="text-[13px] text-ink">
                  <span className="font-medium">{entry.title}</span>
                  {entry.expectedOutcome &&
                  (entry.expectedOutcome as { saveMinorPerMonth?: number }).saveMinorPerMonth ? (
                    <>
                      {" "}
                      — expected to save{" "}
                      {formatMinor(
                        (entry.expectedOutcome as { saveMinorPerMonth: number }).saveMinorPerMonth,
                        currency,
                      )}
                      /month
                    </>
                  ) : null}
                </p>
                <div className="mt-2">
                  <OutcomeReviewForm entryId={entry.id} />
                </div>
              </div>
            ))}
          </section>
        ) : null}

        <NewEntryForm scenarios={savedScenarios} />

        {entries.length === 0 ? (
          <EmptyState
            title="No journal entries yet"
            description="Example: mark December as “Travel — one-time” and January's budget suggestions and anomaly baselines will exclude that spending, telling you exactly what they left out."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-col gap-1.5 rounded-card border border-hairline bg-card px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-medium text-ink">{entry.title}</span>
                  <Badge variant={entry.kind === "decision" ? "info" : undefined}>
                    {KIND_LABELS[entry.kind] ?? entry.kind}
                  </Badge>
                  {entry.excludeFromBaselines ? (
                    <Badge variant="attention">Excluded from baselines</Badge>
                  ) : null}
                  {entry.outcomeReview ? (
                    <Badge variant="positive">
                      Outcome:{" "}
                      {(entry.outcomeReview as { verdict: string }).verdict === "happened"
                        ? "happened"
                        : (entry.outcomeReview as { verdict: string }).verdict === "partly"
                          ? "partly"
                          : "didn't happen"}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-[12.5px] text-ink-muted">
                  {formatIsoDate(entry.startsOn, "en-MY")}
                  {entry.endsOn ? ` – ${formatIsoDate(entry.endsOn, "en-MY")}` : ""}
                  {entry.reviewOn && !entry.outcomeReview
                    ? ` · review on ${formatIsoDate(entry.reviewOn, "en-MY")}`
                    : ""}
                  {entry.links.length > 0 ? ` · ${entry.links.length} linked item(s)` : ""}
                </p>
                {entry.body ? <p className="text-[13px] text-ink-secondary">{entry.body}</p> : null}
                {entry.outcomeReview && (entry.outcomeReview as { note?: string | null }).note ? (
                  <p className="text-[12.5px] text-ink-muted">
                    Review note: {(entry.outcomeReview as { note: string }).note}
                  </p>
                ) : null}
                <div className="self-end">
                  <DeleteEntryButton entryId={entry.id} />
                </div>
              </li>
            ))}
          </ul>
        )}

        <Banner variant="info">
          Journal entries never change transactions or reports. &quot;Excluded from baselines&quot;
          only affects what the intelligence layer treats as normal — and every affected insight
          says exactly what it left out.
        </Banner>
      </div>
    </>
  );
}
