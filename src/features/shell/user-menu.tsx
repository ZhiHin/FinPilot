"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { LogOut, Settings } from "lucide-react";
import Link from "next/link";

import { signOutAction } from "@/features/auth/actions";

export function UserMenu({ name, email }: { name: string; email: string }) {
  const initial = (name || email).charAt(0).toUpperCase();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Account menu"
        className="grid h-8 w-8 place-items-center rounded-chip bg-accent-soft text-[13px] font-semibold text-accent"
      >
        {initial}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-56 rounded-card border border-hairline bg-raised p-1.5 shadow-raised"
        >
          <div className="px-2.5 py-2">
            <div className="truncate text-[13px] font-semibold text-ink">{name || email}</div>
            <div className="truncate text-[11.5px] text-ink-muted">{email}</div>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-hairline" />
          <DropdownMenu.Item asChild>
            <Link
              href="/settings/profile"
              className="flex cursor-pointer items-center gap-2 rounded-control px-2.5 py-2 text-[13px] text-ink outline-none data-[highlighted]:bg-sunken"
            >
              <Settings aria-hidden className="h-4 w-4 text-ink-muted" />
              Settings
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <button
              type="button"
              onClick={() => signOutAction()}
              className="flex w-full cursor-pointer items-center gap-2 rounded-control px-2.5 py-2 text-left text-[13px] text-ink outline-none data-[highlighted]:bg-sunken"
            >
              <LogOut aria-hidden className="h-4 w-4 text-ink-muted" />
              Sign out
            </button>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
