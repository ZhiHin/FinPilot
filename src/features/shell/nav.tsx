import {
  ArrowLeftRight,
  Bell,
  ChartNoAxesCombined,
  FlaskConical,
  Import,
  LayoutDashboard,
  NotebookPen,
  PiggyBank,
  Repeat,
  Settings,
  Sparkles,
  Target,
  Wallet,
} from "lucide-react";

import type { NavItem } from "@/components/shell/app-shell";
import { t } from "@/lib/i18n";

const ICON_CLASS = "h-4 w-4";

/** Primary/secondary navigation per the Phase 0 information architecture. */
export function getPrimaryNav(): NavItem[] {
  return [
    {
      href: "/overview",
      label: t("nav.overview"),
      icon: <LayoutDashboard className={ICON_CLASS} />,
    },
    {
      href: "/transactions",
      label: t("nav.transactions"),
      icon: <ArrowLeftRight className={ICON_CLASS} />,
    },
    { href: "/budget", label: t("nav.budget"), icon: <PiggyBank className={ICON_CLASS} /> },
    { href: "/goals", label: t("nav.goals"), icon: <Target className={ICON_CLASS} /> },
    { href: "/recurring", label: t("nav.recurring"), icon: <Repeat className={ICON_CLASS} /> },
    {
      href: "/analytics",
      label: t("nav.analytics"),
      icon: <ChartNoAxesCombined className={ICON_CLASS} />,
    },
    {
      href: "/scenarios",
      label: t("nav.scenarios"),
      icon: <FlaskConical className={ICON_CLASS} />,
    },
    { href: "/insights", label: t("nav.insights"), icon: <Sparkles className={ICON_CLASS} /> },
  ];
}

export function getSecondaryNav(): NavItem[] {
  return [
    { href: "/accounts", label: t("nav.accounts"), icon: <Wallet className={ICON_CLASS} /> },
    { href: "/journal", label: t("nav.journal"), icon: <NotebookPen className={ICON_CLASS} /> },
    { href: "/imports", label: t("nav.imports"), icon: <Import className={ICON_CLASS} /> },
    {
      href: "/notifications",
      label: t("nav.notifications"),
      icon: <Bell className={ICON_CLASS} />,
    },
    {
      href: "/settings/profile",
      label: t("nav.settings"),
      icon: <Settings className={ICON_CLASS} />,
    },
  ];
}
