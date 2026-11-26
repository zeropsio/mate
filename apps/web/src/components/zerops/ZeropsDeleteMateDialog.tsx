/**
 * Deleting a Mate: one paragraph that says what goes, one field that asks for its name, one
 * button that does it (`ZeropsDeleteMateDialog.logic.ts` holds the words and the rules).
 *
 * The button stays shut until the name is typed as it is spelled, and Enter presses it only then.
 * While the platform answers, it says *Deleting…* and neither button takes a press; the two words
 * hold one room, so the button keeps its width and nothing beside it moves. A refusal keeps the
 * dialog open and says the platform's reason under the field, on a line that is always there.
 *
 * Its words end with what stays of its project (`deletionOffer`). The last Mate of a project the
 * person may delete whole never opens it: its Delete offers the choice of the Mate alone or the
 * whole project (`ZeropsDeleteApplicationDialog`).
 */
import { useState } from "react";

import { cn } from "~/lib/utils";
import { Failure } from "~/components/ui/failure";
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
import { deleteMateConfirmed, type DeleteMateWords } from "./ZeropsDeleteMateDialog.logic";
import { ZeropsConfirmName } from "./ZeropsConfirmName";

export function ZeropsDeleteMateForm({
  name,
  words,
  failed,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  /** The Mate's name, as the field asks for it. */
  readonly name: string;
  readonly words: DeleteMateWords;
  /** The last deletion failed: the row's line and Zerops' answer, where it refused. */
  readonly failed?: { readonly line: string; readonly details: string | null } | undefined;
  /** The platform is answering the press. */
  readonly pending: boolean;
  /** The platform's reason for refusing the last press; `null` where it did not. */
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const confirmed = deleteMateConfirmed(typed, name);

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="delete-mate-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!confirmed || pending) return;
        onConfirm();
      }}
    >
      <DialogHeader>
        <DialogTitle>{words.title}</DialogTitle>
        <DialogDescription>
          <span className="block text-pretty">{words.body}</span>
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        {failed === undefined ? null : (
          <Failure
            cause={failed.line}
            className="mb-4"
            details={failed.details ?? undefined}
            size="line"
          />
        )}
        <div className="space-y-1.5">
          <ZeropsConfirmName
            autoFocus
            name={name}
            onTyped={setTyped}
            pending={pending}
            subject="Mate"
            typed={typed}
          />
          {error === null ? null : <Failure cause={error} role="alert" size="line" />}
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button
          aria-label={pending ? words.pending : words.submit}
          aria-busy={pending || undefined}
          disabled={!confirmed || pending}
          type="submit"
          variant="destructive"
        >
          <span className="grid">
            <span
              aria-hidden={pending}
              className={cn("col-start-1 row-start-1", pending && "invisible")}
            >
              {words.submit}
            </span>
            <span
              aria-hidden={!pending}
              className={cn("col-start-1 row-start-1", !pending && "invisible")}
            >
              {words.pending}
            </span>
          </span>
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ZeropsDeleteMateDialog({
  open,
  onOpenChange,
  ...form
}: Parameters<typeof ZeropsDeleteMateForm>[0] & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-md">
        <ZeropsDeleteMateForm {...form} />
      </DialogPopup>
    </Dialog>
  );
}
