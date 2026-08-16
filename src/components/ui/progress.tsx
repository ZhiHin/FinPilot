import { cn } from "@/lib/cn";

/** Progress bar; pace-aware color variants arrive with budgets (Phase 5). */
export function Progress({
  value,
  max = 100,
  label,
  className,
}: {
  value: number;
  max?: number;
  label: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className={cn("h-2 w-full overflow-hidden rounded-chip bg-sunken", className)}
    >
      <div className="h-full rounded-chip bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}
