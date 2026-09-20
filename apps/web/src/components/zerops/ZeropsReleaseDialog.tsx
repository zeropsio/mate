/**
 * *Release*, confirmed against what it would actually put in front of people.
 *
 * It was one click on a verb whose only warning was a hover, and a hover is
 * not a thing a keyboard or a phone has: the list of changes lived in a
 * tooltip nobody saw before the tag was cut. A release is the one action in
 * the menu that reaches somebody outside the account, so it asks — with the
 * changes spelled out and the tag it would create named (the owner,
 * 2026-09-19: "the release button should show dialog with summary as
 * confirm").
 *
 * Structural only: what the list says is `release.ts`'s summary (R5).
 */
import {
  releaseContentsSummary,
  type ReleaseContentsSummary,
} from "@t3tools/client-runtime/zerops";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

/** How many changes the confirm spells out before it starts counting. */
export const RELEASE_CHANGES_SHOWN = 12;

export function ZeropsReleaseConfirm({
  contents,
  tag,
  releasing,
  onConfirm,
}: {
  readonly contents:
    | ReadonlyArray<{ readonly commits: ReadonlyArray<{ sha: string; subject: string }> }>
    | undefined;
  /** The version it would tag, where the flow suggested one. */
  readonly tag: string | undefined;
  readonly releasing: boolean;
  readonly onConfirm: () => void;
}) {
  const summary: ReleaseContentsSummary = releaseContentsSummary(
    contents ?? [],
    RELEASE_CHANGES_SHOWN,
  );
  return (
    <DialogPanel>
      <DialogHeader>
        <DialogTitle>{tag === undefined ? "Release" : `Release ${tag}`}</DialogTitle>
        <DialogDescription>
          {summary.total === 0
            ? // What a release lists is what is merged (D28) — never what a stage
              // happens to be running, which a group may not even have. The
              // sentence said "what the stage does" and tied the reader's
              // decision to a place the tag does not consult.
              "Nothing is waiting: production already runs every commit on main."
            : summary.total === 1
              ? "One change goes live."
              : `${String(summary.total)} changes go live.`}
        </DialogDescription>
      </DialogHeader>
      {summary.total === 0 ? null : (
        <ul
          className="my-2 flex max-h-64 flex-col gap-1 overflow-y-auto"
          data-zerops-surface="release-confirm-contents"
        >
          {summary.subjects.map((subject) => (
            <li className="text-sm wrap-anywhere text-foreground" key={subject}>
              {subject}
            </li>
          ))}
          {summary.more === 0 ? null : (
            <li className="text-sm text-muted-foreground">+{summary.more} more</li>
          )}
        </ul>
      )}
      <DialogFooter>
        <DialogClose
          render={
            <Button size="sm" variant="ghost">
              Cancel
            </Button>
          }
        />
        <Button
          data-zerops-primary-action="Release"
          disabled={releasing || summary.total === 0}
          onClick={onConfirm}
          size="sm"
        >
          {releasing ? "Releasing\u2026" : "Release"}
        </Button>
      </DialogFooter>
    </DialogPanel>
  );
}

export function ZeropsReleaseDialog({
  open,
  onOpenChange,
  ...confirm
}: Parameters<typeof ZeropsReleaseConfirm>[0] & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-lg">
        <ZeropsReleaseConfirm {...confirm} />
      </DialogPopup>
    </Dialog>
  );
}
