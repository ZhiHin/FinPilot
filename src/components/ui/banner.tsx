import { AlertTriangle, CircleAlert, CircleCheck, Info } from "lucide-react";

import { cn } from "@/lib/cn";

const STYLES = {
  info: { box: "bg-info-soft text-info", Icon: Info },
  positive: { box: "bg-positive-soft text-positive", Icon: CircleCheck },
  attention: { box: "bg-attention-soft text-attention", Icon: AlertTriangle },
  risk: { box: "bg-risk-soft text-risk", Icon: CircleAlert },
} as const;

/** Inline callout. Color is always paired with an icon and text (design doc §1). */
export function Banner({
  variant = "info",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { variant?: keyof typeof STYLES }) {
  const { box, Icon } = STYLES[variant];
  return (
    <div
      role={variant === "risk" ? "alert" : "status"}
      className={cn("flex items-start gap-2.5 rounded-control p-3 text-[13px]", box, className)}
      {...props}
    >
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="text-ink [&>strong]:font-semibold">{children}</div>
    </div>
  );
}
