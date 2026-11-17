/**
 * Messages between a person's Mates, as a conversation draws them: the message another Mate sent
 * this one ("From Fen · Acme Docs", or "Fen answered"), with that Mate's face, opening the run it
 * started; and the quiet line at the conversation's end while an answer is awaited.
 */
import { useAtomValue } from "@effect/atom-react";
import { shownHqMateIdentitiesAtom } from "@t3tools/client-runtime/data";
import { mateAnswerWaitLine } from "@t3tools/client-runtime/zerops/model";
import { type MateMessageItem, mateMessageSenderName } from "@t3tools/contracts";

import { MateFace } from "./primitives";

/** The words a message's row opens with: whom it is from, or whose answer it is. */
function mateMessageHeading(item: MateMessageItem): string {
  const name = mateMessageSenderName(item.from);
  if (item.kind === "answer") return `${name} answered`;
  const project = item.from.projectName.trim();
  return project === "" || project === name ? `From ${name}` : `From ${name} · ${project}`;
}

/** The sending Mate's face, as the menu wears it; a neutral one where this account names none. */
function SenderFace({ projectId }: { readonly projectId: string }) {
  const identity = useAtomValue(shownHqMateIdentitiesAtom)[projectId];
  return (
    <MateFace
      size={20}
      state="idle"
      tint={identity?.tint ?? "slate"}
      {...(identity === undefined ? {} : { shape: identity.shape })}
    />
  );
}

export function MateMessageRow({
  item,
  text,
}: {
  readonly item: MateMessageItem;
  readonly text: string;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-2xl border border-border/70 bg-card px-4 py-2.5"
      data-zerops-surface="mate-message"
    >
      <p className="flex min-w-0 items-center gap-2 text-line text-muted-foreground">
        <SenderFace projectId={item.from.projectId} />
        <span className="min-w-0 truncate">{mateMessageHeading(item)}</span>
      </p>
      <p className="max-h-60 min-w-0 overflow-y-auto text-prose break-words whitespace-pre-wrap text-foreground">
        {text}
      </p>
    </div>
  );
}

/** The conversation's quiet end while it waits for another Mate's answer: no run, no motion. */
export function MateAnswerWaitLine({ names }: { readonly names: ReadonlyArray<string> }) {
  return (
    <p
      className="flex min-w-0 items-center gap-2 text-line text-muted-foreground"
      data-zerops-surface="mate-answer-wait"
    >
      <span className="min-w-0 truncate">{mateAnswerWaitLine(names)}</span>
    </p>
  );
}
