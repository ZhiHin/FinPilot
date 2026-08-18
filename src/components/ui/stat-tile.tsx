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
    <div className={cn("lift reveal rounded-card border border-hairline bg-card p-4", className)}>
      <div className="eyebrow">{label}</div>
      <div className="num-readout mt-1.5 text-[24px] font-medium leading-[30px] text-ink">
        {children}
      </div>
      {detail ? <div className="mt-1 text-[13px] text-ink-muted">{detail}</div> : null}
    </div>
  );
}
