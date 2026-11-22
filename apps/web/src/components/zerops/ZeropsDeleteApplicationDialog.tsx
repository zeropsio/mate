/**
 * Deleting a project with its code: what goes and what stays, listed (`deleteApplicationWords`),
 * one field that asks for its name, one button that does it. The button stays shut until HQ said
 * what the project holds and the name is typed as it is spelled. While it runs it says
 * *Deleting…*; a stage Zerops did not delete or HQ's refusal keeps the dialog open and says why,
 * under the field. Opened confirmed — by its last Mate's Delete — it starts once HQ let go of
 * that Mate (`applicationDeletionHold`); the button stays shut while a Mate holds it.
 */
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useId, useRef, useState } from "react";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

import { cn } from "~/lib/utils";
import { useDeleteApplication } from "./useDeleteApplication";
import { useDeleteApplicationDialog } from "./deleteApplicationDialog";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { hqPlacementsAtom } from "~/state/zerops";
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
import {
  applicationDeletionHold,
  applicationHoldings,
  deleteApplicationWords,
  type DeleteApplicationTarget,
  type DeleteApplicationWords,
} from "./ZeropsDeleteApplicationDialog.logic";
import { DeleteApplicationLists } from "./ZeropsDeleteApplicationLists";
import { deleteMateConfirmed } from "./ZeropsDeleteMateDialog.logic";

export function ZeropsDeleteApplicationForm({
  name,
  words,
  confirmed: confirmedBefore = false,
  hold,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  /** The project's name, as the field asks for it. */
  readonly name: string;
  readonly words: DeleteApplicationWords;
  /** Confirmed in its last Mate's Delete: no field asks again. */
  readonly confirmed?: boolean;
  /** Why it cannot start yet (`applicationDeletionHold`); absent once it can. */
  readonly hold?: { readonly words: string; readonly failed: boolean } | undefined;
  readonly pending: boolean;
  /** Why the last press did not delete it; `null` where it did not fail. */
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const confirmed =
    hold === undefined &&
    (confirmedBefore || (words.goes !== undefined && deleteMateConfirmed(typed, name)));
  const reason = error ?? hold?.words ?? null;

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="delete-application-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!confirmed || pending) return;
        onConfirm();
      }}
    >
      <DialogHeader>
        <DialogTitle>{words.title}</DialogTitle>
        <DialogDescription>This can't be undone.</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="space-y-3">
          <DeleteApplicationLists words={words} />
          <div className="space-y-1.5">
            {confirmedBefore ? null : (
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
            )}
            <p
              className={cn(
                "min-h-4 text-xs",
                error === null && hold?.failed !== true
                  ? "text-muted-foreground"
                  : "text-status-failed-text",
              )}
              id={`${id}-reason`}
              role="alert"
            >
              {reason}
            </p>
          </div>
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button
          aria-busy={pending || undefined}
          aria-label={pending ? words.pending : words.submit}
          data-zerops-surface="delete-application-confirm"
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

function ZeropsDeleteApplicationDialog({
  target,
  confirmed,
  onClose,
}: {
  readonly target: DeleteApplicationTarget;
  readonly confirmed: boolean;
  readonly onClose: () => void;
}) {
  const remove = useDeleteApplication();
  const detail = useHqAppDetail(target.appId);
  const words = deleteApplicationWords(target, applicationHoldings(detail));
  const hold = applicationDeletionHold(useAtomValue(hqPlacementsAtom), target.appId);
  const deleted = useRef(new Set<string>());
  const active = useRef(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    setPending(true);
    setError(null);
    remove(target, deleted.current).then(
      () => {
        if (active.current) onClose();
      },
      (cause: unknown) => {
        if (!active.current) return;
        setPending(false);
        setError(zeropsErrorMessage(cause));
      },
    );
  };
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  // Its last Mate's Delete confirmed it: it starts when HQ's structure lets it, once.
  const started = useRef(false);
  const free = hold === undefined;
  useEffect(() => {
    if (confirmed && free && !started.current) {
      started.current = true;
      run();
    }
  }, [confirmed, free]);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogPopup className="max-w-md">
        <ZeropsDeleteApplicationForm
          confirmed={confirmed}
          error={error}
          hold={hold}
          name={target.name}
          onCancel={onClose}
          onConfirm={run}
          pending={pending}
          words={words}
        />
      </DialogPopup>
    </Dialog>
  );
}

/** Mounted once: the open project's Delete dialog, if any (`useDeleteApplicationDialog`). */
export function ZeropsDeleteApplicationHost() {
  const request = useDeleteApplicationDialog((state) => state.request);
  const close = useDeleteApplicationDialog((state) => state.close);
  if (request === null) return null;
  return (
    <ZeropsDeleteApplicationDialog
      confirmed={request.confirmed === true}
      key={request.target.appId}
      onClose={close}
      target={request.target}
    />
  );
}
