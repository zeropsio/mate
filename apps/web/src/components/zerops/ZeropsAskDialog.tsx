/**
 * Handing something to a Mate, confirmed — and then actually sent.
 *
 * `needs a rebase` was a coloured word with a tooltip: it did not read as
 * something you could press, and pressing it only wrote a sentence into a
 * composer somewhere else and left it there (the owner, 2026-09-19: "needs a
 * button should be a proper button and it should open dialog which would then
 * not only put the text into an agent, but actually send it… similar
 * principles to the release / merge").
 *
 * So it asks in the shape *Release* and *Merge* ask in: what is wrong, who
 * will deal with it, and the exact words they will be sent — quoted rather
 * than described, because the person is authorising that text and nothing
 * else. On *Send* the Mate's conversation opens with the turn already running.
 *
 * Structural only: the sentence is `projectFlow.ts`'s (R5).
 */
import { changeAskLabel } from "@t3tools/client-runtime/zerops";
import type { MateTintId } from "@t3tools/shared/brand";

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
import { MateFace } from "./primitives";

export function ZeropsAskConfirm({
  ask,
  mateName,
  tint,
  what,
  sending,
  onConfirm,
}: {
  /** The exact words the Mate is sent. */
  readonly ask: string;
  readonly mateName: string | undefined;
  /** The Mate's colour, so the face here is the face everywhere else. */
  readonly tint: MateTintId | undefined;
  /** What is wrong, in the words the row that offered this used. */
  readonly what: string;
  readonly sending: boolean;
  readonly onConfirm: () => void;
}) {
  const who = mateName ?? "the Mate";
  return (
    <DialogPanel>
      <DialogHeader>
        <DialogTitle>{changeAskLabel(mateName)}</DialogTitle>
        <DialogDescription>
          {what} Nobody reading this is going to do it by hand, so {who} is asked to.
        </DialogDescription>
      </DialogHeader>
      <div className="my-2 flex min-w-0 items-start gap-3" data-zerops-surface="ask-confirm">
        {tint === undefined ? null : <MateFace size="md" state="idle" tint={tint} />}
        {/* Quoted, not paraphrased: this is the text being authorised. */}
        <p className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2 text-sm wrap-anywhere text-foreground">
          {ask}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        It is sent straight away and {who} starts working; you can stop it in the conversation.
      </p>
      <DialogFooter>
        <DialogClose
          render={
            <Button size="sm" variant="ghost">
              Cancel
            </Button>
          }
        />
        <Button data-zerops-primary-action="Send" disabled={sending} onClick={onConfirm} size="sm">
          {sending ? "Sending…" : "Send"}
        </Button>
      </DialogFooter>
    </DialogPanel>
  );
}

export function ZeropsAskDialog({
  open,
  onOpenChange,
  ...confirm
}: Parameters<typeof ZeropsAskConfirm>[0] & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-lg">
        <ZeropsAskConfirm {...confirm} />
      </DialogPopup>
    </Dialog>
  );
}
