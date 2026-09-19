/**
 * *Merge*, confirmed against the change it would actually land.
 *
 * The menu draws a change as one truncated line with the verb beside it —
 * `…lo by Mat… [Merge]` — and one click squashed it onto `main`. A squash
 * cannot be undone the way a release can be rolled back to the tag before it,
 * and the row the verb sits on does not even say what it is merging (the
 * owner, 2026-09-19: "does the merge button have the same confirmation as
 * release?").
 *
 * So it asks, with the same shape *Release* asks in: the change's whole title
 * rather than the menu's truncation, who wrote it, what its checks said, and
 * what merging it sets in motion.
 *
 * Structural only: the sentence is `projectFlow.ts`'s (R5).
 */
import { mergeConsequence, type FlowPullRequest } from "@t3tools/client-runtime/zerops";

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
import { checkDotTone } from "./ZeropsGitBlock";
import { StatusDot } from "./primitives";

export function ZeropsMergeConfirm({
  pull,
  mateName,
  merging,
  onConfirm,
}: {
  readonly pull: FlowPullRequest;
  /** What the Mate that wrote it is called, where a Mate did. */
  readonly mateName: string | undefined;
  readonly merging: boolean;
  readonly onConfirm: () => void;
}) {
  const checks = checkDotTone(pull);
  // A Mate's change names its Mate or says nothing: `pull.author` on one of
  // those is the bot login, which is never a thing to show a person.
  const who = pull.mateProjectId === undefined ? pull.author : mateName;
  return (
    <DialogPanel>
      <DialogHeader>
        <DialogTitle>Merge #{pull.number}</DialogTitle>
        <DialogDescription>{mergeConsequence(pull)}</DialogDescription>
      </DialogHeader>
      <div className="my-2 flex flex-col gap-2" data-zerops-surface="merge-confirm-change">
        {/* The whole title, and only it: the heading above already carries
            the number and the row below names who wrote it. The menu row this
            verb sits on shows as much of this as a 260px column allows, which
            is not enough to merge on. */}
        <p className="text-sm wrap-anywhere text-foreground">{pull.title}</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Repository</dt>
          <dd className="min-w-0 truncate text-foreground">{pull.repository}</dd>
          {who === undefined ? null : (
            <>
              <dt className="text-muted-foreground">Written by</dt>
              <dd className="min-w-0 truncate text-foreground">{who}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Checks</dt>
          <dd className="min-w-0 text-foreground">
            {pull.checkWord === undefined || checks === undefined ? (
              "Nothing ran"
            ) : (
              <StatusDot label={pull.checkWord} sentence tone={checks} />
            )}
          </dd>
        </dl>
      </div>
      <DialogFooter>
        <DialogClose
          render={
            <Button size="sm" variant="ghost">
              Cancel
            </Button>
          }
        />
        <Button data-zerops-primary-action="Merge" disabled={merging} onClick={onConfirm} size="sm">
          {merging ? "Merging…" : "Merge"}
        </Button>
      </DialogFooter>
    </DialogPanel>
  );
}

export function ZeropsMergeDialog({
  open,
  onOpenChange,
  ...confirm
}: Parameters<typeof ZeropsMergeConfirm>[0] & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-lg">
        <ZeropsMergeConfirm {...confirm} />
      </DialogPopup>
    </Dialog>
  );
}
