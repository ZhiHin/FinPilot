import { CircleAlert } from "lucide-react";

import { cn } from "@/lib/cn";

/** Friendly error state — never raw provider/database text (spec §6). */
export function ErrorState({
  title = "Something went wrong",
  description = "Please try again. If it keeps happening, sign out and back in.",
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-card border border-hairline bg-card px-6 py-12 text-center",
        className,
      )}
    >
      <CircleAlert aria-hidden className="h-6 w-6 text-risk" />
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      <p className="max-w-md text-[13px] text-ink-secondary">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
