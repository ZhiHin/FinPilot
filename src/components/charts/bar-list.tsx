import Link from "next/link";

import { AmountText } from "@/components/ui/amount-text";

export interface BarListItem {
  key: string;
  label: string;
  detail?: string | null;
  amountMinor: number;
  href?: string | null;
}

/**
 * Ranked single-hue bar list (categories, merchants) — an HTML alternative to
 * a bar chart that is itself accessible: real text, real links, amounts via
 * AmountText. Bars are proportional to the largest absolute value.
 */
export function BarList({
  items,
  currency,
  hueVar = "--chart-2",
}: {
  items: BarListItem[];
  currency: string;
  hueVar?: string;
}) {
  const max = Math.max(1, ...items.map((item) => Math.abs(item.amountMinor)));
  return (
    <ol className="flex flex-col gap-2">
      {items.map((item) => {
        const widthPct = Math.max(2, Math.round((Math.abs(item.amountMinor) / max) * 100));
        const label = (
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[13px] text-ink">
              {item.label}
              {item.detail ? (
                <span className="ml-1.5 text-[11.5px] text-ink-muted">{item.detail}</span>
              ) : null}
            </span>
            <AmountText
              amountMinor={item.amountMinor}
              currency={currency}
              className="text-[13px]"
            />
          </span>
        );
        return (
          <li key={item.key}>
            {item.href ? (
              <Link href={item.href} className="block rounded-control px-1 py-0.5 hover:bg-sunken">
                {label}
                <span
                  className="mt-1 block h-1.5 rounded-chip"
                  style={{ width: `${widthPct}%`, background: `var(${hueVar})` }}
                  aria-hidden="true"
                />
              </Link>
            ) : (
              <div className="px-1 py-0.5">
                {label}
                <span
                  className="mt-1 block h-1.5 rounded-chip"
                  style={{ width: `${widthPct}%`, background: `var(${hueVar})` }}
                  aria-hidden="true"
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
