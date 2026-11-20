/**
 * The menu at an account's first run (`useAccountFirstRun`): nothing to list yet, so one dashed
 * place where the first project and its Mate will stand, saying so. Dashed, never grey bars: rows
 * in grey read as rows still loading.
 */
export function SidebarFirstRunHint() {
  return (
    <p
      className="mx-0.5 mt-1 rounded-lg border border-dashed border-sidebar-border px-3 py-2.5 text-xs leading-4 text-sidebar-muted-foreground"
      data-zerops-surface="sidebar-first-run"
    >
      Your projects and their Mates appear here.
    </p>
  );
}
