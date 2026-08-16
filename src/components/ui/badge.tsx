import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-chip px-2.5 py-0.5 text-[11.5px] font-medium tracking-[0.01em]",
  {
    variants: {
      variant: {
        neutral: "bg-sunken text-ink-secondary",
        info: "bg-info-soft text-info",
        positive: "bg-positive-soft text-positive",
        attention: "bg-attention-soft text-attention",
        risk: "bg-risk-soft text-risk",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
