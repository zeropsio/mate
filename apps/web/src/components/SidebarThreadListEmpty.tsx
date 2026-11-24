import { PlusIcon } from "lucide-react";

import { Button } from "./ui/button";

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
    <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-caption text-muted-foreground/60">
      {projectGroups.length === 0 ? (
        <>
          <span>No projects yet</span>
          {roleOffered.newProject ? (
            <Button variant="sidebar" size="xs" onClick={openNewZeropsProject}>
              <PlusIcon />
              New project
            </Button>
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
    <p role="status" className="px-2 py-6 text-center text-caption text-sidebar-muted-foreground">
      {threadSearch.isPending
        ? "Searching thread messages…"
        : threadSearch.incomplete
          ? "Some conversations could not be searched."
          : "No threads found"}
    </p>
  );
}
