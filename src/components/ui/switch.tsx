"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@/lib/cn";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-chip border border-transparent transition-colors",
        "data-[state=checked]:bg-accent data-[state=unchecked]:bg-strongline",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "block h-5 w-5 rounded-chip bg-raised shadow transition-transform",
          "data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-0.5",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
