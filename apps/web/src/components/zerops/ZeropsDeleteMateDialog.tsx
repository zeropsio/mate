/**
 * Deleting a Mate: one paragraph that says what goes, one field that asks for its name, one
 * button that does it (`ZeropsDeleteMateDialog.logic.ts` holds the words and the rules).
 *
 * The button stays shut until the name is typed as it is spelled, and Enter presses it only then.
 * While the platform answers, it says *Deleting…* and neither button takes a press; the two words
 * hold one room, so the button keeps its width and nothing beside it moves. A refusal keeps the
 * dialog open and says the platform's reason under the field, on a line that is always there.
 */
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
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { deleteMateConfirmed, type DeleteMateWords } from "./ZeropsDeleteMateDialog.logic";

export function ZeropsDeleteMateForm({
  name,
  cleanup = false,
  words,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  /** The Mate's name, as the field asks for it. */
  readonly name: string;
  readonly words: DeleteMateWords;
  /** The project is gone; this press retires only its retained access key. */
  readonly cleanup?: boolean;
  /** The platform is answering the press. */
  readonly pending: boolean;
  /** The platform's reason for refusing the last press; `null` where it did not. */
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const confirmed = cleanup || deleteMateConfirmed(typed, name);

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
        <DialogTitle>{cleanup ? `${name} was deleted` : words.title}</DialogTitle>
        <DialogDescription>
          <span className="block text-pretty">
            {cleanup
              ? "Its deletion could not finish. Try again to finish removing its HQ records and access."
              : words.body}
          </span>
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="space-y-1.5">
          {!cleanup ? (
            <>
              <Label htmlFor={`${id}-name`}>{words.label}</Label>
              <Input
                aria-describedby={`${id}-reason`}
                autoComplete="off"
                autoFocus
                id={`${id}-name`}
                onChange={(event) => {
                  setTyped(event.target.value);
                }}
                readOnly={pending}
                spellCheck={false}
                value={typed}
              />
            </>
          ) : null}
          <p className="min-h-4 text-xs text-status-failed-text" id={`${id}-reason`} role="alert">
            {error}
          </p>
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="ghost">
          {cleanup ? "Close" : "Cancel"}
        </Button>
        <Button
          aria-label={
            pending
              ? cleanup
                ? "Finishing deletion…"
                : words.pending
              : cleanup
                ? "Try again"
                : words.submit
          }
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
              {cleanup ? "Try again" : words.submit}
            </span>
            <span
              aria-hidden={!pending}
              className={cn("col-start-1 row-start-1", !pending && "invisible")}
            >
              {cleanup ? "Finishing deletion…" : words.pending}
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
