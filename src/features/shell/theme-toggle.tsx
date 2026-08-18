"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore, useTransition } from "react";

import { updateThemeAction } from "@/features/settings/actions";

type Theme = "system" | "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Server render assumes light; the client corrects it on hydration. */
function useSystemPrefersDark(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
}

/**
 * Light/dark switch. Two states only — "Match system" still exists, but it
 * belongs in Settings → Preferences rather than in a control you tap in
 * passing.
 *
 * When the stored preference is "system" the server cannot know which way it
 * resolved, so the resolved value comes from the media query on the client.
 * That keeps the first click going the way the user expects, instead of
 * switching them to the mode they are already looking at.
 */
export function ThemeToggle({ current }: { current: Theme }) {
  const [pending, startTransition] = useTransition();
  const systemPrefersDark = useSystemPrefersDark();

  const resolved: "light" | "dark" =
    current === "system" ? (systemPrefersDark ? "dark" : "light") : current;
  const next = resolved === "dark" ? "light" : "dark";
  const Icon = resolved === "dark" ? Moon : Sun;
  const label = `Theme: ${resolved}. Switch to ${next}.`;

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
