import { PlusIcon } from "lucide-react";

export function SidebarThreadListEmpty({
  projectGroups,
  roleOffered,
  openNewZeropsProject,
  scopedProjectGroup,
}: {
  projectGroups: ReadonlyArray<unknown>;
  roleOffered: { readonly newProject: boolean };
  openNewZeropsProject: () => void;
  scopedProjectGroup: { readonly displayName: string } | null;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
      {projectGroups.length === 0 ? (
        <>
          <span>No projects yet</span>
          {roleOffered.newProject ? (
            <button
              type="button"
              onClick={openNewZeropsProject}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-sidebar-border px-2.5 py-1 text-2xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
            >
              <PlusIcon className="-mx-0.5 size-3" />
              New project
            </button>
          ) : null}
        </>
      ) : scopedProjectGroup ? (
        `No threads in ${scopedProjectGroup.displayName} yet`
      ) : (
        "No threads yet"
      )}
    </div>
  );
}

export function SidebarThreadSearchEmpty({
  threadSearch,
}: {
  threadSearch: { readonly isPending: boolean; readonly incomplete: boolean };
}) {
  return (
    <p role="status" className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground">
      {threadSearch.isPending
        ? "Searching thread messages…"
        : threadSearch.incomplete
          ? "Some conversations could not be searched."
          : "No threads found"}
    </p>
  );
}
