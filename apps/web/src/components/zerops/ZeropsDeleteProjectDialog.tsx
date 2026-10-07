/**
 * Deleting a project that holds nothing, from its menu on the projects screen (E2E 2026-10-03,
 * F5). Unless dismissed, the dialog follows HQ: it closes once HQ deleted the project and keeps HQ's
 * refusal — the project is no longer empty — for another look.
 */
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { ZeropsGroup } from "@t3tools/client-runtime/zerops";
import type { HqAppContents } from "@t3tools/client-runtime/zerops/hq";
import { useEffect, useRef, useState } from "react";

import { useDeleteGroup } from "../../zerops/useDeleteGroup";
import { Dialog, DialogPopup } from "../ui/dialog";
import { ZeropsDeleteProjectForm } from "./ZeropsDeleteProjectForm";

export function ZeropsDeleteProjectDialog({
  group,
  contents,
  onClose,
}: {
  readonly group: ZeropsGroup;
  readonly contents: HqAppContents | undefined;
  readonly onClose: () => void;
}) {
  const remove = useDeleteGroup();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const close = () => {
    if (!active.current) return;
    active.current = false;
    onClose();
  };
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) close();
      }}
      open
    >
      <DialogPopup className="max-w-md">
        <ZeropsDeleteProjectForm
          error={error}
          contents={contents}
          name={group.name}
          onCancel={close}
          onConfirm={() => {
            if (pending || contents?.empty !== true) return;
            setPending(true);
            setError(null);
            remove(group).then(close, (cause: unknown) => {
              setPending(false);
              setError(zeropsErrorMessage(cause));
            });
          }}
          pending={pending}
        />
      </DialogPopup>
    </Dialog>
  );
}
