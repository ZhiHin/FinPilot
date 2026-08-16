import { cn } from "@/lib/cn";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("rounded-card border border-hairline bg-card", className)} {...props} />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-col gap-1 p-4 pb-0 sm:p-6 sm:pb-0", className)} {...props} />
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2 className={cn("text-[19px] font-semibold leading-[26px] text-ink", className)} {...props} />
  );
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-4 sm:p-6", className)} {...props} />;
}
