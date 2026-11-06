/**
 * *Set up Mate* on an existing project, confirmed first (security review 1, 5): what it adds to
 * the project, and what it does to what runs there. Its container comes isolated in its own
 * import (`envIsolation: service@zcp` on it), so the Mate's key and its agent's login reach none of
 * the project's own services, and none of them is touched for that.
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

/** What it does to a project's own services, said before it is pressed. */
export const SET_UP_MATE_ISOLATION_LINE =
  "Its key stays its own: none of the project's services can read it, and none of them restarts.";

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
            {`This adds a Mate container to ${name}, with its coding agent, and records the Mate in your HQ. ${SET_UP_MATE_ISOLATION_LINE}`}
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
