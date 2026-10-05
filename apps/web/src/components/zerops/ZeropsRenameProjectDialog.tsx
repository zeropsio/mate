/**
 * Renaming a project, wherever it is offered — the projects screen's row and the project's own page.
 *
 * The dialog stays until HQ answers (M04, e2e 2026-10-03: closing at once left a slow rename
 * unseen and a refused one unsaid): it closes once HQ takes the name and keeps HQ's refusal for
 * another try. Every project of the application is named after it in Zerops, so the dialog waits
 * for those renames too: one Zerops refuses is said, with its reason, and Retry sends the same
 * targets again (`useRenameGroup`).
 */
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { ZeropsGroup } from "@t3tools/client-runtime/zerops";
import { useState } from "react";

import {
  projectRenameLeftNotice,
  renamesLeft,
  type ProjectRename,
  type ProjectRenameFailure,
} from "../../zerops/projectRenames.logic";
import { useRenameGroup } from "../../zerops/useRenameGroup";
import { ZeropsRenameDialog } from "./ZeropsRenameDialog";

export function ZeropsRenameProjectDialog({
  group,
  onClose,
}: {
  readonly group: ZeropsGroup;
  readonly onClose: () => void;
}) {
  const { rename, retry } = useRenameGroup();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The projects Zerops refused, as planned: HQ has the name, a retry is theirs alone.
  const [left, setLeft] = useState<ReadonlyArray<ProjectRename>>([]);

  const settled = (failures: ReadonlyArray<ProjectRenameFailure>) => {
    if (failures.length === 0) {
      onClose();
      return;
    }
    setLeft(renamesLeft(failures));
    setPending(false);
    setError(projectRenameLeftNotice(failures));
  };

  return (
    <ZeropsRenameDialog
      description="Mate shows the new name, and its projects in Zerops are renamed to match."
      error={error}
      // An unread name's id is a handle, not a name to edit.
      initialValue={group.nameSource === "unread" ? "" : group.name}
      label="Project name"
      onCancel={onClose}
      onOpenChange={(open) => {
        // Escape and the backdrop wait for HQ too: its refusal needs the dialog to land in.
        if (!open && !pending) onClose();
      }}
      onSubmit={(name) => {
        setPending(true);
        setError(null);
        (left.length > 0 ? retry(left) : rename(group, name)).then(settled, (cause: unknown) => {
          setPending(false);
          setError(zeropsErrorMessage(cause));
        });
      }}
      open
      pending={pending}
      // A retry sends exactly the targets planned: the name is HQ's now and is not asked again.
      readOnly={left.length > 0}
      submitLabel={left.length > 0 ? "Retry" : "Rename"}
      title="Rename the project"
      validate={(value) => (value.trim().length === 0 ? "Give the project a name." : undefined)}
    />
  );
}
