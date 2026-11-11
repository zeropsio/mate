/**
 * Handing a Mate to a person: a Mate made *for* a colleague, a leaver's, one being reassigned, or
 * one whose key Zerops refused needs somebody to say whose it is now. Whoever HQ says may hand it
 * over picks; HQ moves its project's `OWNER` override and gives it a new key.
 *
 * One list, one verb. The list is the organization's active members as Zerops answers the person's
 * own read (`mateHandOver.logic.ts`), and nobody is picked until the person picks. The dialog stays
 * while HQ answers, and says its refusal or where it stopped; Hand it over asks again.
 */
import { useId, useState } from "react";

import type { HandOverCandidate } from "../../zerops/mateHandOver.logic";

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
import { Label } from "../ui/label";

export function ZeropsAssignMateForm({
  projectName,
  candidates,
  onCancel,
  onSubmit,
  pending,
  error,
  readingOrganization,
  readFailed,
}: {
  readonly projectName: string;
  /** Whom the Mate may be handed over to. */
  readonly candidates: ReadonlyArray<HandOverCandidate>;
  /** The organization whose people are still being read, while there is nobody to pick yet. */
  readonly readingOrganization?: string | undefined;
  /** The organization whose people could not be read, and the way to read them again. */
  readonly readFailed?:
    | { readonly organization: string; readonly onReadAgain: () => void }
    | undefined;
  readonly onCancel: () => void;
  /** The person picked, by their person id (HQ's `ownerUserId`). */
  readonly onSubmit: (ownerUserId: string) => void;
  /** HQ is answering the hand-over. */
  readonly pending: boolean;
  /** Why HQ refused it or where it stopped, in its words; null before either. */
  readonly error: string | null;
}) {
  const id = useId();
  const [selected, setSelected] = useState("");
  const candidate = candidates.find((person) => person.userId === selected);
  const canSubmit =
    !pending &&
    readingOrganization === undefined &&
    readFailed === undefined &&
    candidate !== undefined;

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="assign-mate"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        onSubmit(selected);
      }}
    >
      <DialogHeader>
        <DialogTitle>Hand {projectName} over</DialogTitle>
        <DialogDescription>
          Whoever you pick becomes this Mate's single owner, and it gets a new key. Previous owner
          grants are removed; everyone else's access follows their organization and project
          permissions. Personal agent logins stay with their signer: the new owner must use their
          own account to run an agent.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-member`}>Owner</Label>
          <select
            aria-busy={readingOrganization === undefined ? undefined : true}
            autoFocus
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
            disabled={pending || readingOrganization !== undefined || readFailed !== undefined}
            id={`${id}-member`}
            onChange={(event) => {
              setSelected(event.target.value);
            }}
            value={candidate === undefined ? "" : selected}
          >
            <option disabled value="">
              {readingOrganization === undefined
                ? "Pick a person"
                : `Reading ${readingOrganization}…`}
            </option>
            {candidates.map((candidate) => (
              <option key={candidate.userId} value={candidate.userId}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
        {readFailed === undefined ? null : (
          <div className="mt-3 flex flex-col items-start gap-3">
            <p className="text-sm text-foreground" role="alert">
              Couldn't read {readFailed.organization}'s members from Zerops.
            </p>
            <Button onClick={readFailed.onReadAgain} size="sm" type="button" variant="secondary">
              Try again
            </Button>
          </div>
        )}
      </DialogPanel>
      <DialogFooter>
        <p
          className="me-auto min-h-4 self-center text-line leading-4 text-status-failed-text"
          role="alert"
        >
          {error}
        </p>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button aria-busy={pending || undefined} disabled={!canSubmit} type="submit">
          Hand it over
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ZeropsAssignMateDialog({
  onOpenChange,
  ...form
}: Parameters<typeof ZeropsAssignMateForm>[0] & {
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup>
        <ZeropsAssignMateForm {...form} />
      </DialogPopup>
    </Dialog>
  );
}
