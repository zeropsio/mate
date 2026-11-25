/**
 * Deleting a Mate: one paragraph that says what goes, one field that asks for its name, one
 * button that does it (`ZeropsDeleteMateDialog.logic.ts` holds the words and the rules).
 *
 * The button stays shut until the name is typed as it is spelled, and Enter presses it only then.
 * While the platform answers, it says *Deleting…* and neither button takes a press; the two words
 * hold one room, so the button keeps its width and nothing beside it moves. A refusal keeps the
 * dialog open and says the platform's reason under the field, on a line that is always there.
 *
 * The last Mate of its project asks whether the project stays or goes too (app-lifecycle.md,
 * Karel 2026-10-22): kept, its code, changes, stage and production stay for the next Mate; deleted
 * too, the project's own Delete lists what goes and the field asks for the project's name.
 */
import { useId, useState } from "react";

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
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Radio, RadioGroup } from "../ui/radio-group";
import { DeleteApplicationLists } from "./ZeropsDeleteApplicationLists";
import type { DeleteApplicationWords } from "./ZeropsDeleteApplicationDialog.logic";
import { deleteMateConfirmed, type DeleteMateWords } from "./ZeropsDeleteMateDialog.logic";

export function ZeropsDeleteMateForm({
  name,
  words,
  application,
  failed,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  /** The Mate's name, as the field asks for it. */
  readonly name: string;
  readonly words: DeleteMateWords;
  /** Its project, where it is the project's last Mate and the person may delete the project. */
  readonly application?:
    | { readonly name: string; readonly words: DeleteApplicationWords }
    | undefined;
  /** The last deletion failed: the row's line and Zerops' answer, where it refused. */
  readonly failed?: { readonly line: string; readonly details: string | null } | undefined;
  /** The platform is answering the press. */
  readonly pending: boolean;
  /** The platform's reason for refusing the last press; `null` where it did not. */
  readonly error: string | null;
  readonly onCancel: () => void;
  /** `alsoApplication`: the person chose to delete its project too. */
  readonly onConfirm: (alsoApplication: boolean) => void;
}) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const [also, setAlso] = useState<"keep" | "delete">("keep");
  const alsoApplication = application !== undefined && also === "delete";
  const confirmed = alsoApplication
    ? application.words.goes !== undefined && deleteMateConfirmed(typed, application.name)
    : deleteMateConfirmed(typed, name);
  const submit = alsoApplication ? `Delete ${name} and ${application.name}` : words.submit;

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="delete-mate-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!confirmed || pending) return;
        onConfirm(alsoApplication);
      }}
    >
      <DialogHeader>
        <DialogTitle>{words.title}</DialogTitle>
        <DialogDescription>
          <span className="block text-pretty">{words.body}</span>
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        {application !== undefined ? (
          <div className="mb-4 space-y-3" data-zerops-surface="delete-mate-application">
            <p className="text-body">{`${name} is the last Mate of ${application.name}.`}</p>
            <RadioGroup
              aria-label={`What happens to ${application.name}`}
              onValueChange={(value) => {
                setAlso(value === "delete" ? "delete" : "keep");
                setTyped("");
              }}
              value={also}
            >
              <label className="flex items-start gap-2 text-body">
                <Radio disabled={pending} value="keep" />
                <span>
                  <span className="block">{`Keep ${application.name}`}</span>
                  <span className="block text-muted-foreground">
                    Its code, changes, stage and production stay. You can start a Mate on it again.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-body">
                <Radio disabled={pending} value="delete" />
                <span>{`Delete ${application.name} too`}</span>
              </label>
            </RadioGroup>
            {alsoApplication ? <DeleteApplicationLists words={application.words} /> : null}
          </div>
        ) : null}
        {failed === undefined ? null : (
          <Failure
            cause={failed.line}
            className="mb-4"
            details={failed.details ?? undefined}
            size="line"
          />
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>
            {alsoApplication ? application.words.label : words.label}
          </Label>
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
          <p
            className="min-h-4 text-caption text-status-failed-text"
            id={`${id}-reason`}
            role="alert"
          >
            {error}
          </p>
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button
          aria-label={pending ? words.pending : submit}
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
              {submit}
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
