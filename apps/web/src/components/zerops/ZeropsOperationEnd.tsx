/** The End of an operation HQ offers it on, asked once more before it is sent. */
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { operationEndWords } from "./ZeropsOperationEnd.logic";

/** The confirmation of an End, for a surface that opens it from its own press (a menu's row). */
export function ZeropsOperationEndDialog({
  kind,
  name,
  open,
  onOpenChange,
  onEnd,
}: {
  /** The operation's kind, which decides what the confirmation says stays. */
  readonly kind: string;
  /** What the person knows it by. */
  readonly name: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onEnd: () => void;
}) {
  const words = operationEndWords(kind, name);
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{words.title}</AlertDialogTitle>
          <AlertDialogDescription>{words.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>
          <Button
            onClick={() => {
              onOpenChange(false);
              onEnd();
            }}
            type="button"
            variant="destructive"
          >
            End it
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

export function ZeropsOperationEnd({
  kind,
  name,
  disabled = false,
  onEnd,
}: {
  /** The operation's kind, which decides what the confirmation says stays. */
  readonly kind: string;
  /** What the person knows it by. */
  readonly name: string;
  readonly disabled?: boolean;
  readonly onEnd: () => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button
        disabled={disabled}
        onClick={() => setAsking(true)}
        size="sm"
        type="button"
        variant="destructive-ghost"
      >
        End
      </Button>
      <ZeropsOperationEndDialog
        kind={kind}
        name={name}
        onEnd={onEnd}
        onOpenChange={setAsking}
        open={asking}
      />
    </>
  );
}
