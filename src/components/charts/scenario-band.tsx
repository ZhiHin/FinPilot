"use client";

import {
  CartesianGrid,
  ComposedChart,
  Area,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMinor, formatMinorCompact } from "@/lib/money";

const AXIS_TICK = { fill: "var(--text-muted)", fontSize: 11 };

function shortDayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export interface ScenarioBandPoint {
  date: string;
  /** Scenario bands. */
  conservativeMinor: number;
  expectedMinor: number;
  optimisticMinor: number;
  /** Baseline (no scenario) expected path — rendered dashed per UX 4.6. */
  baselineMinor: number;
  /** Optional second scenario expected path (compare view). */
  secondMinor?: number;
}

/**
 * Scenario projection per UX 4.6: solid expected line + translucent
 * optimistic/conservative band for the scenario, dashed line = baseline
 * without the scenario. The Table tab is the accessible alternative.
 */
export function ScenarioBandChart({
  data,
  currency,
  scenarioLabel = "Scenario",
  secondLabel,
}: {
  data: ScenarioBandPoint[];
  currency: string;
  scenarioLabel?: string;
  secondLabel?: string;
}) {
  const shaped = data.map((point) => ({
    ...point,
    bandBase: point.conservativeMinor,
    bandSpan: point.optimisticMinor - point.conservativeMinor,
  }));
  return (
    <ResponsiveContainer width="100%" height={280}>
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
            if (name === "bandSpan") return null;
            if (name === "bandBase") return [formatMinor(Number(value), currency), "Conservative"];
            return [formatMinor(Number(value), currency), String(name)];
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
          dataKey="baselineMinor"
          name="Baseline (no scenario)"
          stroke="var(--chart-2)"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="expectedMinor"
          name={scenarioLabel}
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        {secondLabel ? (
          <Line
            type="monotone"
            dataKey="secondMinor"
            name={secondLabel}
            stroke="var(--chart-3)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ) : null}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
