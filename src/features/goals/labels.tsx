import { Badge } from "@/components/ui/badge";
import type { GoalTimeStatus, GoalType } from "@/server/services/goals";

export const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  emergency: "Emergency fund",
  purchase: "Purchase",
  travel: "Travel",
  education: "Education",
  debt_payoff: "Debt payoff",
  custom: "Custom",
};

/** Status is always text + variant, never color alone. */
export function TimeStatusBadge({ status }: { status: GoalTimeStatus }) {
  switch (status) {
    case "completed":
      return <Badge variant="positive">Target reached</Badge>;
    case "ahead":
      return <Badge variant="positive">Ahead</Badge>;
    case "on_track":
      return <Badge variant="positive">On track</Badge>;
    case "behind":
      return <Badge variant="attention">Behind</Badge>;
    case "overdue":
      return <Badge variant="risk">Past target date</Badge>;
    case "no_target_date":
      return <Badge>No target date</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

/** "2027-08" → "Aug 2027" for estimated-completion displays. */
export function formatMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-MY", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, m - 1, 15)));
}
