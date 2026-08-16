"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";

export function PasswordInput({ className, ...props }: React.ComponentProps<"input">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        className={cn(
          "w-full rounded-control border border-strongline bg-raised px-3 py-2 pr-11 text-[15px] text-ink",
          "placeholder:text-ink-muted disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-control p-2 text-ink-muted hover:text-ink"
      >
        {visible ? (
          <EyeOff aria-hidden className="h-4 w-4" />
        ) : (
          <Eye aria-hidden className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
