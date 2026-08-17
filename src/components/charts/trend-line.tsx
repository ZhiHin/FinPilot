"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMinor, formatMinorCompact } from "@/lib/money";

import { formatBp, shortMonthLabel } from "./format";

const AXIS_TICK = { fill: "var(--text-muted)", fontSize: 11 };

const TOOLTIP_STYLE = {
  background: "var(--surface-raised)",
  border: "1px solid var(--border-hairline)",
  borderRadius: 10,
  color: "var(--text-primary)",
  fontSize: 13,
} as const;

/** Single-series money trend (net position, savings amount) — slot 1, one axis. */
export function MoneyTrendLine({
  data,
  currency,
  seriesName,
}: {
  data: Array<{ month: string; valueMinor: number }>;
  currency: string;
  seriesName: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart
        data={data}
        accessibilityLayer={false}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
      >
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis
          dataKey="month"
          tickFormatter={shortMonthLabel}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: "var(--chart-grid)" }}
        />
        <YAxis
          tickFormatter={(v: number) => formatMinorCompact(v, currency)}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <Tooltip
          formatter={(value) => [formatMinor(Number(value), currency), seriesName]}
          labelFormatter={(month) => shortMonthLabel(String(month))}
          contentStyle={TOOLTIP_STYLE}
        />
        <Line
          type="monotone"
          dataKey="valueMinor"
          name={seriesName}
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={{ r: 2.5, fill: "var(--chart-1)" }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Savings-rate trend in percent; months without income show a gap, never 0%. */
export function RateTrendLine({ data }: { data: Array<{ month: string; rateBp: number | null }> }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart
        data={data}
        accessibilityLayer={false}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
      >
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis
          dataKey="month"
          tickFormatter={shortMonthLabel}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: "var(--chart-grid)" }}
        />
        <YAxis
          tickFormatter={(v: number) => formatBp(v)}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <Tooltip
          formatter={(value) => [formatBp(Number(value)), "Savings rate"]}
          labelFormatter={(month) => shortMonthLabel(String(month))}
          contentStyle={TOOLTIP_STYLE}
        />
        <Line
          type="monotone"
          dataKey="rateBp"
          name="Savings rate"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={{ r: 2.5, fill: "var(--chart-1)" }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
