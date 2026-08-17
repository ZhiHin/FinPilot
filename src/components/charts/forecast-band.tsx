"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMinor, formatMinorCompact } from "@/lib/money";

const AXIS_TICK = { fill: "var(--text-muted)", fontSize: 11 };

/** "2026-08-25" → "25 Aug" for daily axis ticks. */
function shortDayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export interface ForecastBandPoint {
  date: string;
  conservativeMinor: number;
  expectedMinor: number;
  optimisticMinor: number;
}

/**
 * Forecast band per the design doc §4: expected = solid slot-1 line; the
 * optimistic/conservative band = translucent fill of the same hue. One axis,
 * no animations; the table view is the accessible alternative.
 */
export function ForecastBandChart({
  data,
  currency,
}: {
  data: ForecastBandPoint[];
  currency: string;
}) {
  // Recharts renders a band as a stacked pair: transparent base at the
  // conservative line, translucent fill up to the optimistic line.
  const shaped = data.map((point) => ({
    ...point,
    bandBase: point.conservativeMinor,
    bandSpan: point.optimisticMinor - point.conservativeMinor,
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={shaped} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={shortDayLabel}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: "var(--chart-grid)" }}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={(v: number) => formatMinorCompact(v, currency)}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <Tooltip
          formatter={(value, name) => {
            if (name === "bandBase") return [formatMinor(Number(value), currency), "Conservative"];
            if (name === "bandSpan") return null;
            return [formatMinor(Number(value), currency), "Expected"];
          }}
          labelFormatter={(date) => shortDayLabel(String(date))}
          contentStyle={{
            background: "var(--surface-raised)",
            border: "1px solid var(--border-hairline)",
            borderRadius: 10,
            color: "var(--text-primary)",
            fontSize: 13,
          }}
        />
        <Area
          dataKey="bandBase"
          stackId="band"
          stroke="none"
          fill="transparent"
          isAnimationActive={false}
        />
        <Area
          dataKey="bandSpan"
          stackId="band"
          stroke="none"
          fill="var(--chart-1)"
          fillOpacity={0.16}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="expectedMinor"
          name="Expected"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
