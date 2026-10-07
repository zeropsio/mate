/**
 * Handing a Mate to a person (guide 0.8, D11).
 *
 * A Mate belongs to whoever created it — the platform makes its creator the
 * project's `OWNER` — so a Mate made *for* a colleague, a leaver's, or one
 * being reassigned needs somebody to say whose it is now. That somebody is an
 * org owner or admin, and what they write is a per-project role override.
 *
 * One list, one verb. The list is the org's people as HQ answers them as the
 * picker opens (`handoverCandidates`: its active people, never one of its
 * integration tokens), and nobody is picked until the person picks; picking one
 * raises them to `OWNER` here, which is what makes the Mate open for them and
 * theirs to rename. Nothing else on the project moves. The dialog stays while
 * the platform answers, and says its refusal.
 */
import type { HqHandoverCandidate } from "@t3tools/shared/hqStream";
import { useId, useState } from "react";

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
  readRefused,
}: {
  readonly projectName: string;
  /** Whom HQ lets the Mate be handed over to. */
  readonly candidates: ReadonlyArray<HqHandoverCandidate>;
  /** The organization whose people are still being read, while there is nobody to pick yet. */
  readonly readingOrganization?: string | undefined;
  /** The organization whose people could not be read, and the way to read them again. */
  readonly readFailed?:
    | { readonly organization: string; readonly onReadAgain: () => void }
    | undefined;
  /** The organization whose people HQ refused to list: its word, nothing to try again. */
  readonly readRefused?: { readonly organization: string } | undefined;
  readonly onCancel: () => void;
  readonly onSubmit: (clientUserId: string) => void;
  /** The platform is answering the hand-over. */
  readonly pending: boolean;
  /** Why the platform refused it, in its words; null before a refusal. */
  readonly error: string | null;
}) {
  const id = useId();
  const [selected, setSelected] = useState("");
  const candidate = candidates.find((person) => person.clientUserId === selected);
  const canSubmit =
    !pending &&
    readingOrganization === undefined &&
    readFailed === undefined &&
    readRefused === undefined &&
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
          Whoever you pick becomes this Mate's single owner. Previous owner grants are removed;
          everyone else's access follows their organization and project permissions. Personal agent
          logins stay with their signer: the new owner must use their own account to run an agent.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-member`}>Owner</Label>
          <select
            aria-busy={readingOrganization === undefined ? undefined : true}
            autoFocus
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
            disabled={
              pending ||
              readingOrganization !== undefined ||
              readFailed !== undefined ||
              readRefused !== undefined
            }
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
              <option key={candidate.clientUserId} value={candidate.clientUserId}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
        {readRefused === undefined ? null : (
          <p className="mt-3 text-sm text-foreground" role="alert">
            HQ refused to list {readRefused.organization}'s people.
          </p>
        )}
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
        <Button disabled={pending} onClick={onCancel} type="button" variant="ghost">
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
    <Dialog
      open
      onOpenChange={(next) => {
        // A hand-over the platform is answering is seen through: its refusal has somewhere to land.
        if (!next && form.pending) return;
        onOpenChange(next);
      }}
    >
      <DialogPopup>
        <ZeropsAssignMateForm {...form} />
      </DialogPopup>
    </Dialog>
  );
}
