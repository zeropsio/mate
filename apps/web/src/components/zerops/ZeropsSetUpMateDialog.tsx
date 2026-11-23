/**
 * *Set up Mate* on an existing project, confirmed first (security review 1, 5): what it does to
 * this project. Before a new container's import the project's isolation becomes
 * `service service@zcp` (env) and `vpn service@zcp` (SSH), so the Mate's key and its agent's login
 * reach none of the project's own services and none restarts. A zcp service the project already
 * holds takes the key and Mate settings and is restarted.
 */
import type { SetUpMateEffect } from "./ZeropsProjectRow.logic";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

/** What the press does to this project, said before it is pressed. */
const setUpMateWords = (name: string, effect: SetUpMateEffect): string => {
  switch (effect) {
    case "adds-container":
      return `This adds a Mate container to ${name}, with its coding agent, and records the Mate in your HQ. Its key stays its own: none of the project's services can read it, and none of them restarts.`;
    case "restarts-container":
      return `This turns on the Mate in the zcp service ${name} already has: it writes a new key and Mate settings there and restarts that service. The project's other services do not restart.`;
    case "unread":
      return `This records the Mate in your HQ. If ${name} already has a zcp service, it writes a new key and Mate settings there and restarts that service; otherwise it adds a Mate container. The project's other services do not restart.`;
  }
};

export function ZeropsSetUpMateDialog({
  name,
  effect,
  onCancel,
  onConfirm,
}: {
  readonly name: string;
  readonly effect: SetUpMateEffect;
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
          <DialogDescription>{setUpMateWords(name, effect)}</DialogDescription>
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
