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
  const words = operationEndWords(kind, name);
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
      <AlertDialog onOpenChange={setAsking} open={asking}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{words.title}</AlertDialogTitle>
            <AlertDialogDescription>{words.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>
            <Button
              onClick={() => {
                setAsking(false);
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
    </>
  );
}
