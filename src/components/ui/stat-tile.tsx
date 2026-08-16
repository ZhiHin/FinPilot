import { cn } from "@/lib/cn";

/** Labeled figure tile for dashboard summaries. */
export function StatTile({
  label,
  children,
  detail,
  className,
}: {
  label: string;
  children: React.ReactNode;
  detail?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-card border border-hairline bg-card p-4", className)}>
      <div className="text-[13px] text-ink-secondary">{label}</div>
      <div className="mt-1 text-[24px] font-semibold leading-[30px] text-ink">{children}</div>
      {detail ? <div className="mt-1 text-[13px] text-ink-muted">{detail}</div> : null}
    </div>
  );
}
