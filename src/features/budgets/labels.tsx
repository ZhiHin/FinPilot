import { Badge } from "@/components/ui/badge";
import type { BudgetHealth, BudgetMode } from "@/server/services/budgets";

export const BUDGET_MODE_LABELS: Record<BudgetMode, string> = {
  fixed: "Fixed",
  flexible: "Flexible",
  rollover: "Rollover",
  zero_based: "Zero-based",
};

export const BUDGET_MODE_HELP: Record<BudgetMode, string> = {
  fixed: "Set amounts per category; each cycle starts fresh.",
  flexible: "Guide amounts per category; overspending one just informs the others.",
  rollover: "Unspent amounts carry into the next cycle automatically.",
  zero_based: "Plan every ringgit of expected income until nothing is unallocated.",
};

/**
 * Health is always label + variant, never color alone (design doc §3).
 * Warning colors appear only where intervention helps.
 */
export function HealthBadge({ health }: { health: BudgetHealth | "no_budget" }) {
  switch (health) {
    case "on_track":
      return <Badge variant="positive">On track</Badge>;
    case "watch":
      return <Badge variant="attention">Watch</Badge>;
    case "at_risk":
      return <Badge variant="attention">At risk</Badge>;
    case "exceeded":
      return <Badge variant="risk">Exceeded</Badge>;
    case "not_started":
      return <Badge>Not started</Badge>;
    case "no_activity":
      return <Badge>No activity</Badge>;
    case "no_budget":
      return <Badge variant="info">No budget</Badge>;
    default:
      return <Badge>{health}</Badge>;
  }
}
