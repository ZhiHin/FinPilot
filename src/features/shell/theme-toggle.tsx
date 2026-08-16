"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTransition } from "react";

import { updateThemeAction } from "@/features/settings/actions";

const SEQUENCE = ["system", "light", "dark"] as const;
type Theme = (typeof SEQUENCE)[number];

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

/** Cycles system → light → dark; persisted to preferences server-side. */
export function ThemeToggle({ current }: { current: Theme }) {
  const [pending, startTransition] = useTransition();
  const next = SEQUENCE[(SEQUENCE.indexOf(current) + 1) % SEQUENCE.length];
  const Icon = ICONS[current];
  const label = `Theme: ${current}. Switch to ${next}.`;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => updateThemeAction(next))}
      aria-label={label}
      title={label}
      className="rounded-control p-2 text-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-60"
    >
      <Icon aria-hidden className="h-4 w-4" />
    </button>
  );
}
