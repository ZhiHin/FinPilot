import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/cn";

/** Styled native select — accessible by default, sufficient for Phase 1 forms. */
export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        className={cn(
          "w-full appearance-none rounded-control border border-strongline bg-raised px-3 py-2 pr-9 text-[15px] text-ink",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
      />
    </div>
  );
}
