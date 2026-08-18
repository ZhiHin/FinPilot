import { cn } from "@/lib/cn";

export function PageHeader({
  title,
  description,
  actions,
  className,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
  /** Optional instrument legend above the title. */
  eyebrow?: string;
}) {
  return (
    <div className={cn("mb-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="animate-rise">
          {eyebrow ? <div className="eyebrow mb-1">{eyebrow}</div> : null}
          <h1 className="text-[26px] font-semibold leading-[32px] text-ink">{title}</h1>
          {description ? (
            <p className="mt-1 text-[13px] text-ink-secondary">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="horizon animate-horizon mt-4" aria-hidden />
    </div>
  );
}
