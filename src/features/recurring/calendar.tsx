import { AmountText } from "@/components/ui/amount-text";
import { paydayFor, type CycleAnchor } from "@/lib/cycles";
import { nextExpected, type RecurringFrequency } from "@/lib/recurrence";
import { cn } from "@/lib/cn";
import type { PatternRow } from "@/server/services/recurring";

/**
 * Month-grid bill calendar (UX doc §4.5): server-rendered, semantic (each day
 * is a list of dues), with payday and cluster markers. The list view is the
 * table alternative for this visualization.
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Project a pattern's due dates inside [monthStart, monthEnd]. */
function duesInMonth(pattern: PatternRow, monthStart: string, monthEnd: string): string[] {
  if (pattern.frequency === "custom" || pattern.status !== "active") return [];
  const dues: string[] = [];
  let cursor = pattern.nextExpectedOn;
  for (let guard = 0; guard < 8 && cursor <= monthEnd; guard++) {
    if (cursor >= monthStart) dues.push(cursor);
    cursor = nextExpected(cursor, pattern.frequency as RecurringFrequency);
  }
  return dues;
}

export function BillCalendar({
  patterns,
  month, // "YYYY-MM"
  paydayAnchor,
  today,
}: {
  patterns: PatternRow[];
  month: string;
  paydayAnchor: CycleAnchor | null;
  today: string;
}) {
  const [year, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${pad(daysInMonth)}`;
  const firstWeekday = new Date(Date.UTC(year, m - 1, 1)).getUTCDay(); // 0 = Sunday

  const byDay = new Map<string, Array<{ name: string; amountMinor: number; currency: string }>>();
  for (const pattern of patterns) {
    if (pattern.direction !== "outflow") continue;
    for (const due of duesInMonth(pattern, monthStart, monthEnd)) {
      const list = byDay.get(due) ?? [];
      list.push({
        name: pattern.name,
        amountMinor: pattern.typicalAmountMinor,
        currency: pattern.currency,
      });
      byDay.set(due, list);
    }
  }
  const payday = paydayAnchor ? paydayFor(year, m, paydayAnchor) : null;
  const monthLabel = new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, m - 1, 15)));

  const cells: Array<{ date: string | null; day: number | null }> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ date: null, day: null });
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ date: `${month}-${pad(day)}`, day });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null });
  const weeks: Array<typeof cells> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div className="rounded-card border border-hairline bg-card p-4">
      <h2 className="mb-3 text-[15px] font-semibold text-ink">{monthLabel}</h2>
      <table
        aria-label={`Bill calendar for ${monthLabel}: expected bills with amounts, payday marked`}
        className="w-full table-fixed border-separate border-spacing-1 text-[11.5px]"
      >
        <thead>
          <tr>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => (
              <th
                key={weekday}
                scope="col"
                className="px-1 py-1 text-left font-medium uppercase tracking-wide text-ink-muted"
              >
                {weekday}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((cell, cellIndex) =>
                cell.date === null ? (
                  <td key={`pad-${cellIndex}`} aria-hidden className="min-h-16" />
                ) : (
                  <td
                    key={cell.date}
                    className={cn(
                      "min-h-16 rounded-control border border-hairline p-1 align-top",
                      cell.date === today && "border-strongline bg-sunken",
                    )}
                  >
                    <div className="flex items-baseline justify-between">
                      <span
                        className={cn(
                          "num",
                          cell.date === today ? "font-semibold text-ink" : "text-ink-muted",
                        )}
                      >
                        {cell.day}
                      </span>
                      {payday === cell.date ? (
                        <span className="rounded-chip bg-positive-soft px-1.5 text-[10px] font-semibold text-positive">
                          Payday
                        </span>
                      ) : null}
                    </div>
                    {byDay.has(cell.date) ? (
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {byDay.get(cell.date)!.map((due, i) => (
                          <li
                            key={i}
                            className="truncate rounded-[4px] bg-accent-soft px-1 py-0.5 text-accent"
                          >
                            {due.name}{" "}
                            <span className="num">
                              <AmountText amountMinor={due.amountMinor} currency={due.currency} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11.5px] text-ink-muted">
        Dates and amounts are estimates projected from your history. The List view holds the same
        information as text.
      </p>
    </div>
  );
}
