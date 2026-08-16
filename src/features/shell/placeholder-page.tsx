import { CalendarClock } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Honest future-phase placeholder (spec §6 G3): names exactly which phase
 * delivers the screen — no fake UI, no dead controls.
 */
export function PlaceholderPage({
  title,
  description,
  phase,
  phaseScope,
}: {
  title: string;
  description: string;
  phase: number;
  phaseScope: string;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={<CalendarClock aria-hidden className="h-6 w-6" />}
        title={`${title} is not built yet`}
        description={`This screen arrives in Phase ${phase} (${phaseScope}). Nothing here is simulated — FinPilot only shows working features.`}
      />
    </>
  );
}
