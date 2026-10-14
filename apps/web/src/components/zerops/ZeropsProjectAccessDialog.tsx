/**
 * *Project access…*, from a Mate's ···: who reaches the Mate's Zerops project, as people chips —
 * a Mate is a project like any other, and Zerops keeps its access the same way.
 */
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { ProjectAccess } from "./projects/ProjectPeople";

export function ZeropsProjectAccessDialog({
  projectId,
  name,
  onClose,
}: {
  readonly projectId: string;
  /** The Mate's name. */
  readonly name: string;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Project access</DialogTitle>
          <DialogDescription>Who reaches {name}’s project in Zerops, and how.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ProjectAccess heading={false} kind="mate" name={name} projectId={projectId} />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
