"use client";

import { Command, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { SpotlightRoot } from "@/components/motion/spotlight-root";
import { cn } from "@/lib/cn";

import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { CommandPalette } from "./command-palette";
import { Dock } from "./dock";

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
        "relative flex items-center gap-3 rounded-control px-3 py-2 text-[13px] font-medium",
        "transition-[background-color,color,transform] duration-150",
        isActive(item.href)
          ? "bg-accent-soft text-accent"
          : "text-ink-secondary hover:bg-sunken hover:text-ink motion-safe:hover:translate-x-0.5",
        compact && "flex-col gap-1 px-2 py-1.5 text-[11.5px] motion-safe:hover:translate-x-0",
      )}
    >
      {/* Instrument tick marking the current station. */}
      {isActive(item.href) && !compact ? (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r bg-accent"
        />
      ) : null}
      <span aria-hidden>{item.icon}</span>
      <span>{item.label}</span>
    </Link>
  );

  const mobileSlots = navPrimary.slice(0, 3);

  return (
    <div className="min-h-dvh bg-page">
      <SpotlightRoot />

      {/* Header — brand lives here now that there is no sidebar to hold it. */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-hairline bg-card/80 px-4 backdrop-blur-xl sm:px-6">
        <Link href="/overview" className="press flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-control bg-accent text-[13px] font-bold text-on-accent"
          >
            F
          </span>
          <span className="font-display text-[16px] font-semibold tracking-tight text-ink">
            FinPilot
          </span>
        </Link>
        {/* Search lives in the dock beside the destinations; the topbar keeps
            only the controls that have nowhere else to be. */}
        <div className="ml-auto flex items-center gap-1.5">
          {headerControls}
          {userMenu}
        </div>
      </header>

      {/* Content — full width, with room at the bottom for the dock. */}
      <main id="main-content" className="px-4 pb-24 pt-6 sm:px-6 lg:pb-32 lg:px-8">
        <div className="mx-auto w-full max-w-[1400px]">{children}</div>
      </main>

      {/* Desktop primary navigation */}
      <Dock
        items={navPrimary}
        onSearch={() => setPaletteOpen(true)}
        searchIcon={<Command aria-hidden />}
        onMore={() => setMoreOpen(true)}
        moreIcon={<Menu aria-hidden />}
      />

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
          {/* On desktop the dock already shows every primary destination, so
              this menu carries the secondary ones; on mobile it carries both. */}
          <div className="flex flex-col gap-0.5" onClick={() => setMoreOpen(false)}>
            <nav aria-label="Secondary" className="flex flex-col gap-0.5">
              {navSecondary.map((item) => navLink(item))}
            </nav>
            <div className="my-2 border-t border-hairline lg:hidden" />
            <div className="flex flex-col gap-0.5 lg:hidden">
              {navPrimary.slice(3).map((item) => navLink(item))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
