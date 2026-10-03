/**
 * Naming a project, wherever it is offered — the projects screen's row and the project's own page.
 *
 * The dialog stays until HQ answers (M04, e2e 2026-10-03: closing at once left a slow rename
 * unseen and a refused one unsaid): it closes once HQ takes the name and keeps HQ's refusal for
 * another try. The name is HQ's alone; the project's Zerops projects keep their own.
 */
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { ZeropsGroup } from "@t3tools/client-runtime/zerops";
import { useState } from "react";

import { useRenameGroup } from "../../zerops/useRenameGroup";
import { ZeropsRenameDialog } from "./ZeropsRenameDialog";

export function ZeropsRenameProjectDialog({
  group,
  onClose,
}: {
  readonly group: ZeropsGroup;
  readonly onClose: () => void;
}) {
  const rename = useRenameGroup();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unnamed = group.nameSource === "id";

  return (
    <ZeropsRenameDialog
      description="The name is kept in HQ. The project's Zerops projects keep their own names."
      error={error}
      initialValue={unnamed ? "" : group.name}
      label="Project name"
      onCancel={onClose}
      onOpenChange={(open) => {
        // Escape and the backdrop wait for HQ too: its refusal needs the dialog to land in.
        if (!open && !pending) onClose();
      }}
      onSubmit={(name) => {
        setPending(true);
        setError(null);
        rename(group, name).then(onClose, (cause: unknown) => {
          setPending(false);
          setError(zeropsErrorMessage(cause));
        });
      }}
      open
      pending={pending}
      submitLabel="Rename"
      title={unnamed ? "Name this project" : "Rename the project"}
      validate={(value) => (value.trim().length === 0 ? "Give the project a name." : undefined)}
    />
  );
}
