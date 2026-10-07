/**
 * Changing a Mate's face: the picker New Mate uses (`MateFacePicker`), opened on the face the
 * Mate wears, the face drawn big as each colour and shape is picked, and one button that saves it
 * (`ZeropsChangeFaceDialog.logic.ts` holds the words and the rules).
 *
 * Save writes nothing when the face picked is the one worn; it just closes. While the platform
 * answers, the button says *Saving…* in its own room, so it keeps its width, and neither button
 * takes a press. A refusal keeps the dialog open and says the platform's reason beside the
 * buttons, on a line that is always there, the face picked still picked. Taken, it closes the way
 * a dialog does — fading as the Mate's rows behind it take the face — and its host lets it go
 * once that has finished (`onOpenChangeComplete`).
 */
import type { ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import { useId, useState } from "react";

import { cn } from "~/lib/utils";
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
import { MateFacePicker } from "./MateFacePicker";
import { changeFaceWords, sameFace } from "./ZeropsChangeFaceDialog.logic";

export function ZeropsChangeFaceForm({
  name,
  face,
  pending,
  error,
  onCancel,
  onSave,
}: {
  /** The Mate's name, as its menu says it. */
  readonly name: string;
  /** The face it wears now (`mateFaceOf`): the one the dialog opens on. */
  readonly face: ZeropsMateFace;
  /** The platform is answering the press. */
  readonly pending: boolean;
  /** The platform's reason for refusing the last press; `null` where it did not. */
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onSave: (face: ZeropsMateFace) => void;
}) {
  const id = useId();
  const [picked, setPicked] = useState(face);
  const words = changeFaceWords(name);

  return (
    <form
      aria-describedby={`${id}-reason`}
      className="flex min-h-0 flex-col"
      data-zerops-surface="change-face-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        if (sameFace(picked, face)) onCancel();
        else onSave(picked);
      }}
    >
      <DialogHeader>
        <DialogTitle>{words.title}</DialogTitle>
        <DialogDescription>{words.description}</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <MateFacePicker
          face={picked}
          onPickShape={(shape) => {
            if (!pending) setPicked((current) => ({ ...current, shape }));
          }}
          onPickTint={(tint) => {
            if (!pending) setPicked((current) => ({ ...current, tint }));
          }}
        />
      </DialogPanel>
      <DialogFooter>
        <p
          className="me-auto min-h-4 self-center text-line leading-4 text-status-failed-text"
          id={`${id}-reason`}
          role="alert"
        >
          {error}
        </p>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button aria-busy={pending || undefined} disabled={pending} type="submit">
          <span className="grid">
            <span className={cn("col-start-1 row-start-1", pending && "invisible")}>
              {words.submit}
            </span>
            <span className={cn("col-start-1 row-start-1", !pending && "invisible")}>
              {words.pending}
            </span>
          </span>
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ZeropsChangeFaceDialog({
  open,
  onOpenChange,
  onOpenChangeComplete,
  ...form
}: Parameters<typeof ZeropsChangeFaceForm>[0] & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Its opening or closing has finished moving: a closed one may go. */
  readonly onOpenChangeComplete?: ((open: boolean) => void) | undefined;
}) {
  return (
    <Dialog
      onOpenChange={onOpenChange}
      {...(onOpenChangeComplete === undefined ? {} : { onOpenChangeComplete })}
      open={open}
    >
      <DialogPopup className="max-w-lg">
        <ZeropsChangeFaceForm {...form} />
      </DialogPopup>
    </Dialog>
  );
}
