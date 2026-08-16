"use client";

import { formatMinor } from "@/lib/money";
import { cn } from "@/lib/cn";

import { usePrivacy } from "../providers/privacy-provider";

const MASK = "•••••";

/**
 * The only way money is rendered (design doc §5): tabular numerals, locale
 * formatting from lib/money, and privacy masking that preserves layout width.
 */
export function AmountText({
  amountMinor,
  currency,
  locale,
  className,
}: {
  amountMinor: number;
  currency: string;
  locale?: string;
  className?: string;
}) {
  const { hidden } = usePrivacy();

  if (hidden) {
    return (
      <span className={cn("num", className)} aria-label="Amount hidden">
        {currency === "MYR" ? `RM ${MASK}` : `${currency} ${MASK}`}
      </span>
    );
  }
  return <span className={cn("num", className)}>{formatMinor(amountMinor, currency, locale)}</span>;
}
