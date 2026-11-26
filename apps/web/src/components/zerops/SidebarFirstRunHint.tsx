import { EmptyState } from "../ui/empty";
import { Card } from "~/components/ui/card";

/**
 * The menu at an account's first run (`useAccountFirstRun`): nothing to list yet, so one dashed
 * place where the first project and its Mate will stand, saying so (the kit's EmptyState row).
 * Dashed, never grey bars: rows in grey read as rows still loading.
 */
export function SidebarFirstRunHint() {
  return (
    <Card className="mx-0.5 mt-1" data-zerops-surface="sidebar-first-run" variant="slot">
      <div className="px-1">
        <EmptyState size="row">Your projects and their Mates appear here.</EmptyState>
      </div>
    </Card>
  );
}
