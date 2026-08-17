"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMinor, formatMinorCompact } from "@/lib/money";

import { shortMonthLabel } from "./format";

export interface MonthlyFlowPoint {
  month: string; // "YYYY-MM"
  incomeMinor: number;
  expenseMinor: number;
  savingsMinor: number;
}

const AXIS_TICK = { fill: "var(--text-muted)", fontSize: 11 };

/**
 * Income vs expense per month — grouped bars, fixed slots 1 (income) and
 * 2 (expense), one axis, no animations (motion discipline is global).
 */
export function IncomeExpenseBars({
  data,
  currency,
}: {
  data: MonthlyFlowPoint[];
  currency: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart
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
          width={52}
        />
        <Tooltip
          formatter={(value) => formatMinor(Number(value), currency)}
          labelFormatter={(month) => shortMonthLabel(String(month))}
          cursor={{ fill: "var(--chart-grid)" }}
          contentStyle={{
            background: "var(--surface-raised)",
            border: "1px solid var(--border-hairline)",
            borderRadius: 10,
            color: "var(--text-primary)",
            fontSize: 13,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12.5 }} />
        <Bar dataKey="incomeMinor" name="Income" fill="var(--chart-1)" isAnimationActive={false} />
        <Bar
          dataKey="expenseMinor"
          name="Expenses"
          fill="var(--chart-2)"
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Net cash flow (savings) per month — diverging rule: positive months blue,
 * negative months red, neutral grey midline.
 */
export function SavingsBars({ data, currency }: { data: MonthlyFlowPoint[]; currency: string }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart
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
          axisLine={{ stroke: "var(--chart-diverging-mid)", strokeWidth: 2 }}
        />
        <YAxis
          tickFormatter={(v: number) => formatMinorCompact(v, currency)}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <Tooltip
          formatter={(value) => [formatMinor(Number(value), currency), "Net cash flow"]}
          labelFormatter={(month) => shortMonthLabel(String(month))}
          cursor={{ fill: "var(--chart-grid)" }}
          contentStyle={{
            background: "var(--surface-raised)",
            border: "1px solid var(--border-hairline)",
            borderRadius: 10,
            color: "var(--text-primary)",
            fontSize: 13,
          }}
        />
        <Bar dataKey="savingsMinor" name="Net cash flow" isAnimationActive={false}>
          {data.map((point) => (
            <Cell
              key={point.month}
              fill={point.savingsMinor < 0 ? "var(--chart-8)" : "var(--chart-1)"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
