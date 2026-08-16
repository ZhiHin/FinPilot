import { cn } from "@/lib/cn";

/**
 * Helpful empty state: explains what the screen will show and offers a next
 * action. Used honestly for future-phase placeholders (spec §6 G3).
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-strongline px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? <div className="text-ink-muted">{icon}</div> : null}
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {description ? (
        <p className="max-w-md text-[13px] text-ink-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
