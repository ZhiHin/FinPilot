"use client";

import { Eye, EyeOff } from "lucide-react";

import { usePrivacy } from "../providers/privacy-provider";

/** Masks/unmasks every AmountText on the page; persists per device. */
export function PrivacyToggle({ hideLabel, showLabel }: { hideLabel: string; showLabel: string }) {
  const { hidden, toggle } = usePrivacy();
  const label = hidden ? showLabel : hideLabel;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-pressed={hidden}
      title={label}
      className="rounded-control p-2 text-ink-muted hover:bg-sunken hover:text-ink"
    >
      {hidden ? (
        <EyeOff aria-hidden className="h-4 w-4" />
      ) : (
        <Eye aria-hidden className="h-4 w-4" />
      )}
    </button>
  );
}
