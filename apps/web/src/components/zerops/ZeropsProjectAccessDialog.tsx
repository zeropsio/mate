/**
 * *Project access…*, from a Mate's ···: who reaches the Mate's Zerops project. A Mate of an app
 * shows it read only, linked to its column on the app's page, where it is changed with the app's
 * other places; a Mate on its own is changed here, as people chips.
 */
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { PlaceAccess, ProjectAccess, useProjectGroup } from "./projects/ProjectPeople";

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
  const group = useProjectGroup(projectId);
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
          {group === undefined ? (
            <ProjectAccess heading={false} kind="mate" name={name} projectId={projectId} />
          ) : (
            <PlaceAccess
              groupId={group.groupId}
              groupName={group.name}
              kind="mate"
              name={name}
              onLeave={onClose}
              projectId={projectId}
            />
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
