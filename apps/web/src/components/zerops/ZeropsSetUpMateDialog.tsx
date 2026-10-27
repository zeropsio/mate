/**
 * *Set up Mate* on an existing project, confirmed first (security review 1, 5): what it adds to
 * the project, and what it does to what runs there. Its close-off moves the project to `service`
 * env isolation — so the Mate's key and its agent's login reach none of the project's own services
 * — and a project not isolated yet restarts the services that run its code once for that.
 */
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

/** What the close-off does to a project's own services, said before it is pressed. */
export const SET_UP_MATE_RESTART_LINE =
  "While its project is closed off, its services that run code restart once, unless it is closed off already.";

export function ZeropsSetUpMateDialog({
  name,
  onCancel,
  onConfirm,
}: {
  readonly name: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{`Set up Mate in ${name}`}</DialogTitle>
          <DialogDescription>
            {`This adds a Mate container to ${name}, with its coding agent, and records the Mate in your HQ. ${SET_UP_MATE_RESTART_LINE}`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onCancel} variant="ghost">
            Cancel
          </Button>
          <Button onClick={onConfirm}>Set up Mate</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
