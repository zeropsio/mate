import { EmptyState } from "../ui/empty";

/**
 * The menu at an account's first run (`useAccountFirstRun`): nothing to list yet, so one dashed
 * place where the first project and its Mate will stand, saying so (the kit's EmptyState row).
 * Dashed, never grey bars: rows in grey read as rows still loading.
 */
export function SidebarFirstRunHint() {
  return (
    <div
      className="mx-0.5 mt-1 rounded-card border border-dashed border-sidebar-border px-1"
      data-zerops-surface="sidebar-first-run"
    >
      <EmptyState size="row">Your projects and their Mates appear here.</EmptyState>
    </div>
  );
}
