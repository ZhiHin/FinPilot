"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/cn";

import type { NavItem } from "./app-shell";

/**
 * The dock: primary navigation as a floating pill at the bottom of the
 * viewport instead of a left sidebar, so every screen gets the full width —
 * which matters most on the wide data tables.
 *
 * Items magnify with the cursor. The scale is written straight to each item's
 * style on an animation frame; React never re-renders while the pointer moves.
 * Magnification is skipped for reduced-motion visitors and coarse pointers,
 * where there is no hover to track — the dock stays a plain, fully usable row.
 */
export function Dock({
  items,
  onSearch,
  searchIcon,
  onMore,
  moreLabel = "More",
  moreIcon,
}: {
  items: NavItem[];
  onSearch: () => void;
  searchIcon: React.ReactNode;
  onMore: () => void;
  moreLabel?: string;
  moreIcon: React.ReactNode;
}) {
  const pathname = usePathname();
  const listRef = useRef<HTMLDivElement>(null);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const allowed =
      window.matchMedia("(prefers-reduced-motion: no-preference)").matches &&
      window.matchMedia("(pointer: fine)").matches;
    if (!allowed) return;

    const cells = () => Array.from(list.querySelectorAll<HTMLElement>("[data-dock-cell]"));
    let frame = 0;
    let pointerX: number | null = null;

    const apply = () => {
      frame = 0;
      for (const cell of cells()) {
        if (pointerX === null) {
          cell.style.removeProperty("--dock-scale");
          cell.style.removeProperty("--dock-lift");
          continue;
        }
        const rect = cell.getBoundingClientRect();
        const distance = Math.abs(pointerX - (rect.left + rect.width / 2));
        // Falls off to nothing about two cells away.
        const influence = Math.max(0, 1 - distance / 140);
        const eased = influence * influence;
        cell.style.setProperty("--dock-scale", String(1 + eased * 0.5));
        cell.style.setProperty("--dock-lift", `${eased * -7}px`);
      }
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };

    const onMove = (event: PointerEvent) => {
      pointerX = event.clientX;
      schedule();
    };
    const onLeave = () => {
      pointerX = null;
      schedule();
    };

    list.addEventListener("pointermove", onMove, { passive: true });
    list.addEventListener("pointerleave", onLeave, { passive: true });
    return () => {
      list.removeEventListener("pointermove", onMove);
      list.removeEventListener("pointerleave", onLeave);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const cellClass =
    "dock-cell group relative flex w-[5.25rem] flex-col items-center gap-1.5 rounded-control px-1 py-2 " +
    "text-[10.5px] font-medium leading-tight";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 hidden justify-center pb-5 lg:flex">
      <nav
        aria-label="Primary"
        className="dock pointer-events-auto flex items-end gap-1 rounded-[1.35rem] px-2 py-1.5"
      >
        <div ref={listRef} className="flex items-end gap-1">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              data-dock-cell
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                cellClass,
                isActive(item.href)
                  ? "bg-accent-soft text-accent"
                  : "text-ink-secondary hover:text-ink",
              )}
            >
              {isActive(item.href) ? (
                <span aria-hidden className="absolute -top-0.5 h-1 w-1 rounded-full bg-accent" />
              ) : null}
              <span aria-hidden className="dock-glyph h-6 [&_svg]:h-5 [&_svg]:w-5">
                {item.icon}
              </span>
              <span className="w-full truncate text-center">{item.label}</span>
            </Link>
          ))}
        </div>

        <span aria-hidden className="mx-1 h-9 w-px self-center bg-hairline" />

        <button
          type="button"
          onClick={onSearch}
          data-dock-cell
          title="Search & actions (Ctrl K)"
          className={cn(cellClass, "text-ink-secondary hover:text-ink")}
        >
          <span aria-hidden className="dock-glyph h-6 [&_svg]:h-5 [&_svg]:w-5">
            {searchIcon}
          </span>
          <span>Search</span>
        </button>

        <button
          type="button"
          onClick={onMore}
          data-dock-cell
          className={cn(cellClass, "text-ink-secondary hover:text-ink")}
        >
          <span aria-hidden className="dock-glyph h-6 [&_svg]:h-5 [&_svg]:w-5">
            {moreIcon}
          </span>
          <span>{moreLabel}</span>
        </button>
      </nav>
    </div>
  );
}
