import { cloneElement, isValidElement, useId } from "react";

import { cn } from "@/lib/cn";

/**
 * Label + help + error wiring for a single control. The child control receives
 * id / aria-invalid / aria-describedby automatically.
 */
export function FormField({
  label,
  help,
  errors,
  className,
  children,
}: {
  label: string;
  help?: string;
  errors?: string[];
  className?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const hasError = Boolean(errors && errors.length > 0);

  const describedBy =
    [hasError ? errorId : null, help ? helpId : null].filter(Boolean).join(" ") || undefined;

  const control = isValidElement(children)
    ? cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id,
        "aria-invalid": hasError ? "true" : undefined,
        "aria-describedby": describedBy,
      })
    : children;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-secondary">
        {label}
      </label>
      {control}
      {hasError ? (
        <p id={errorId} className="text-[13px] text-risk">
          {errors!.join(" ")}
        </p>
      ) : null}
      {help ? (
        <p id={helpId} className="text-[13px] text-ink-muted">
          {help}
        </p>
      ) : null}
    </div>
  );
}
