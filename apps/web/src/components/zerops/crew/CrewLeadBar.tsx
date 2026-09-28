/**
 * The lead's bar (PRD §4.6): where a writer's chat shows its copy of the code,
 * the lead's says what it does instead — it plans and reviews, and has no copy.
 */
import { CREW_LEAD_ROLE_LINE } from "@t3tools/client-runtime/zerops/crew/phrases";

export function CrewLeadBar() {
  return (
    <div className="flex w-full shrink-0 justify-center px-5 sm:px-6" data-crew-lead-bar>
      <p className="flex min-h-8 w-full max-w-3xl items-center text-xs text-muted-foreground">
        {CREW_LEAD_ROLE_LINE}
      </p>
    </div>
  );
}
