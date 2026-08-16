"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import type { NavItem } from "./app-shell";

/**
 * ⌘K / Ctrl-K command menu. Phase 1 scope: navigation commands only —
 * "Add transaction", "Import statement", and "Ask AI" join it with their phases.
 */
export function CommandPalette({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: NavItem[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const handleOpenChange = (next: boolean) => {
    if (!next) setQuery("");
    onOpenChange(next);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) setQuery("");
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const filtered = useMemo(
    () => items.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase())),
    [items, query],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="top-24 max-w-md -translate-y-0 p-3">
        <DialogTitle className="sr-only">Command menu</DialogTitle>
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Go to…"
          aria-label="Search destinations"
        />
        <ul className="mt-2 max-h-72 overflow-y-auto" role="listbox" aria-label="Destinations">
          {filtered.map((item) => (
            <li key={item.href}>
              <button
                type="button"
                onClick={() => {
                  handleOpenChange(false);
                  router.push(item.href);
                }}
                className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-left text-[13px] text-ink hover:bg-sunken"
              >
                <span aria-hidden className="text-ink-muted">
                  {item.icon}
                </span>
                {item.label}
              </button>
            </li>
          ))}
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-[13px] text-ink-muted">No matches.</li>
          ) : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
