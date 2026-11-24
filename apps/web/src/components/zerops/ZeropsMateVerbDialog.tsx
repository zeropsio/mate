import type { ReactNode } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { MATE_VERB_LABELS, type MateComputerVerb } from "./ZeropsMateVerbDialog.logic";

/** Confirming what a Mate's computer is asked to do: restart, or stop with its whole project. */
export function ZeropsMateVerbDialog({
  verb,
  name,
  body,
  pending,
  error,
  onCancel,
  onConfirm,
  feedback,
  confirmLabel,
}: {
  readonly verb: MateComputerVerb;
  readonly name: string;
  readonly body: string;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly feedback?: ReactNode;
  readonly confirmLabel?: string | undefined;
}) {
  const labels = MATE_VERB_LABELS[verb];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{`${labels.press} ${name}`}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        {feedback === null || feedback === undefined ? null : <DialogPanel>{feedback}</DialogPanel>}
        {error === null ? null : (
          <DialogPanel>
            <p role="alert">{error}</p>
          </DialogPanel>
        )}
        <DialogFooter>
          <Button onClick={onCancel} variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={onConfirm}
            variant={verb === "stop" ? "destructive" : "primary"}
          >
            {confirmLabel ?? (pending ? labels.pending : labels.press)}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
