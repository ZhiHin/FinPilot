"use client";

import { Command, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/cn";

import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { CommandPalette } from "./command-palette";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** For honest labeling of future-phase destinations in menus. */
  phaseNote?: string;
}

export interface ShellUser {
  name: string;
  email: string;
}

/**
 * Responsive authenticated shell: desktop left sidebar (≥1024px), compact mobile
 * bottom navigation (5 slots incl. the command button), header with privacy/theme
 * controls (passed in as headerControls) and user menu.
 */
export function AppShell({
  navPrimary,
  navSecondary,
  headerControls,
  userMenu,
  children,
}: {
  navPrimary: NavItem[];
  navSecondary: NavItem[];
  headerControls: React.ReactNode;
  userMenu: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const navLink = (item: NavItem, compact = false) => (
    <Link
      key={item.href}
      href={item.href}
      aria-current={isActive(item.href) ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-control px-3 py-2 text-[13px] font-medium transition-colors",
        isActive(item.href)
          ? "bg-accent-soft text-accent"
          : "text-ink-secondary hover:bg-sunken hover:text-ink",
        compact && "flex-col gap-1 px-2 py-1.5 text-[11.5px]",
      )}
    >
      <span aria-hidden>{item.icon}</span>
      <span>{item.label}</span>
    </Link>
  );

  const mobileSlots = navPrimary.slice(0, 3);

  return (
    <div className="min-h-dvh bg-page">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-hairline bg-card px-3 py-4 lg:flex">
        <Link href="/overview" className="mb-6 flex items-center gap-2 px-3">
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-control bg-accent text-[13px] font-bold text-on-accent"
          >
            F
          </span>
          <span className="text-[15px] font-semibold text-ink">FinPilot</span>
        </Link>
        <nav aria-label="Primary" className="flex flex-col gap-0.5">
          {navPrimary.map((item) => navLink(item))}
        </nav>
        <div className="my-4 border-t border-hairline" />
        <nav aria-label="Secondary" className="flex flex-col gap-0.5">
          {navSecondary.map((item) => navLink(item))}
        </nav>
        <div className="mt-auto px-3 pt-4 text-[11.5px] text-ink-muted">
          Educational information, not financial advice.
        </div>
      </aside>

      {/* Header */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-hairline bg-card px-4 lg:pl-64">
        <span className="text-[15px] font-semibold text-ink lg:hidden">FinPilot</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden items-center gap-2 rounded-control border border-hairline px-3 py-1.5 text-[13px] text-ink-muted hover:text-ink sm:flex"
          >
            <Command aria-hidden className="h-3.5 w-3.5" />
            <span>Search &amp; actions</span>
            <kbd className="rounded bg-sunken px-1.5 text-[11px]">Ctrl K</kbd>
          </button>
          {headerControls}
          {userMenu}
        </div>
      </header>

      {/* Content */}
      <main id="main-content" className="px-4 pb-24 pt-6 sm:px-6 lg:pb-10 lg:pl-[17rem] lg:pr-8">
        <div className="mx-auto w-full max-w-[1200px]">{children}</div>
      </main>

      {/* Mobile bottom navigation: 3 primary + command + More */}
      <nav
        aria-label="Quick navigation"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-hairline bg-card px-1 py-1 lg:hidden"
      >
        {mobileSlots.map((item) => navLink(item, true))}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex flex-col items-center gap-1 rounded-control px-2 py-1.5 text-[11.5px] font-medium text-ink-secondary hover:bg-sunken"
        >
          <Command aria-hidden className="h-5 w-5" />
          <span>Actions</span>
        </button>
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex flex-col items-center gap-1 rounded-control px-2 py-1.5 text-[11.5px] font-medium text-ink-secondary hover:bg-sunken"
        >
          <Menu aria-hidden className="h-5 w-5" />
          <span>More</span>
        </button>
      </nav>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={[...navPrimary, ...navSecondary]}
      />

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle className="mb-3 text-[15px] font-semibold text-ink">
            All destinations
          </DialogTitle>
          <div className="flex flex-col gap-0.5" onClick={() => setMoreOpen(false)}>
            {[...navPrimary.slice(3), ...navSecondary].map((item) => navLink(item))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
