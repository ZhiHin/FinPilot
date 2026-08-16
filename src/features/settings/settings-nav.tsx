"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

const ITEMS = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/preferences", label: "Preferences" },
  { href: "/settings/categories", label: "Categories & tags" },
  { href: "/settings/security", label: "Security" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/privacy", label: "Privacy & AI" },
  { href: "/settings/data", label: "Data" },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="mb-6 flex flex-wrap gap-1 border-b border-hairline pb-2">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={pathname === item.href ? "page" : undefined}
          className={cn(
            "rounded-control px-3 py-1.5 text-[13px] font-medium",
            pathname === item.href
              ? "bg-accent-soft text-accent"
              : "text-ink-secondary hover:bg-sunken hover:text-ink",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
