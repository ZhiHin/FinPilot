"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Chart kit shell (ADR-009): every chart ships with a title, a plain-language
 * description, and a Table tab holding the same data — the table is the
 * canonical accessible/screen-reader path, the drawing is `role="img"`.
 */
export function ChartCard({
  title,
  description,
  chart,
  table,
  footer,
  interactive = false,
}: {
  title: string;
  /** One plain sentence: what the chart shows and how to read it. */
  description: string;
  chart: React.ReactNode;
  table: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * Set when the chart content contains real links/controls (e.g. a bar list
   * with drill-downs) — those must not sit inside a role="img" drawing.
   */
  interactive?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>{title}</CardTitle>
          <p className="mt-1 text-[13px] text-ink-muted">{description}</p>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="chart">
          <TabsList aria-label={`${title}: view as`}>
            <TabsTrigger value="chart">Chart</TabsTrigger>
            <TabsTrigger value="table">Table</TabsTrigger>
          </TabsList>
          <TabsContent value="chart">
            {interactive ? (
              <div aria-label={`${title}. ${description}`}>{chart}</div>
            ) : (
              <div
                role="img"
                aria-label={`${title}. ${description} The Table tab holds the same data.`}
              >
                {chart}
              </div>
            )}
          </TabsContent>
          <TabsContent value="table">
            <div className="overflow-x-auto">{table}</div>
          </TabsContent>
        </Tabs>
        {footer}
      </CardContent>
    </Card>
  );
}

/** Simple data table used as the accessible alternative for every chart. */
export function ChartDataTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: string[];
  rows: Array<Array<React.ReactNode>>;
}) {
  return (
    <table className="w-full text-[13px]">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-hairline text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
          {headers.map((header, i) => (
            <th
              key={header}
              scope="col"
              className={i === 0 ? "px-2 py-1.5 font-medium" : "px-2 py-1.5 text-right font-medium"}
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, rowIndex) => (
          <tr key={rowIndex} className="border-b border-hairline last:border-0">
            {cells.map((cell, i) => (
              <td key={i} className={i === 0 ? "px-2 py-1.5" : "num px-2 py-1.5 text-right"}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
