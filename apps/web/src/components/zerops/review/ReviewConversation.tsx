/**
 * What was said on a change, and the one box to say something back.
 *
 * Two verbs, told apart by what they set in motion rather than by a line explaining them: the
 * box invites "Comment, or tell Nova what to change…", **Comment** keeps the words on the change
 * for everyone on it, and **Ask Nova** — with the Mate's face — keeps them there too and hands them
 * to the Mate, who changes the code. Ask is offered only for the person's own Mate: only it can
 * push to the change's branch.
 *
 * The box is one quiet line that grows as it is written in (`field-sizing: content`); ⌘↵ in it
 * comments, never merges.
 * What was typed is kept for the change while the tab is open, so closing the review loses
 * nothing; once HQ took it, it is the change's and no draft — the box shows it, off, until the
 * conversation holds it, and says so while HQ reconnects. A press made before the conversation is
 * read says it waits for that read; words whose answer was lost stay a draft until HQ shows them. While the conversation is read it holds the room of the comments the change has; one
 * that cannot be read says so, with *Try again*, and the box still takes words. Only people comment on a change (SPEC §3.2a): each remark wears its speaker's initial.
 *
 * A hand-off is visible to both sides: on a colleague's change the box says whom the words reach
 * (`reaches`), its Mate's owner gets one press that hands the Mate what others said since its last
 * push (`answer`), and a person who may only read reads so where the box would be (`readOnly`).
 */
import {
  changeAskLabel,
  changeConversationCount,
  historyAge,
  type ChangeRemark,
} from "@t3tools/client-runtime/zerops";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { useState, type KeyboardEvent, type ReactElement } from "react";

import { Skeleton } from "~/components/ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import type { ChangeDiscussion } from "~/zerops/useChangeDiscussion";

import { PersonAvatar, MateFace } from "../primitives";
import { remarkFold, type ReviewFrame } from "./ZeropsReview.logic";
import { ReviewFailed, ReviewSection, type ReviewFoldState } from "./ZeropsReviewSurface";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Text } from "~/components/ui/text";

/** What was being written on each change, kept while the tab is open. */
const drafts = new Map<string, string>();

/** The person's own Mate that Ask hands the words to, in its face where it is known. */
interface Asker {
  readonly name: string;
  readonly tint: MateTintId | undefined;
  readonly shape?: MateShapeId | undefined;
}

export function ReviewConversation({
  frame,
  draftKey,
  comments,
  remarks,
  count,
  asker,
  commentable,
  readOnly = false,
  reaches,
  answer,
  now,
  onAsk,
  fold,
}: {
  readonly frame: ReviewFrame;
  /** The change the draft belongs to. */
  readonly draftKey: string;
  readonly comments: ChangeDiscussion;
  readonly remarks: ReadonlyArray<ChangeRemark>;
  /** How many comments the change has, as HQ counts them: the room its conversation holds. */
  readonly count?: number | undefined;
  /** The person's own Mate that wrote the change: the one Ask hands the words to. */
  readonly asker: Asker | undefined;
  /**
   * HQ's rule lets the person say something on the change (`comment_change`): without it the box
   * is not offered — Ask keeps the words on the change too.
   */
  readonly commentable: boolean;
  /** HQ's rule lets the person read the change and nothing more: said where the box would be. */
  readonly readOnly?: boolean | undefined;
  /** On a colleague's change: its Mate's owner, whom a comment reaches. */
  readonly reaches?: string | undefined;
  /** For the Mate's owner: hands it the comments others left since its last push. */
  readonly answer?: { readonly label: string; readonly onPress: () => void } | undefined;
  readonly now: number;
  /** Keeps the words on the change and hands them to the Mate. */
  readonly onAsk: (said: string) => Promise<void>;
  /** Folded to its row, in the sheet: one click away. */
  readonly fold?: ReviewFoldState | undefined;
}) {
  const { state } = comments;
  return (
    <ReviewSection
      count={state.kind === "read" ? changeConversationCount(remarks) : undefined}
      fold={fold}
      title="Conversation"
    >
      {state.kind === "reading" ? (
        <RemarksSkeleton count={count ?? 0} frame={frame} />
      ) : state.kind === "failed" ? (
        <ReviewFailed
          onRetry={comments.retry}
          reason={state.reason}
          what="The conversation couldn't be read."
        />
      ) : (
        <Remarks frame={frame} now={now} remarks={remarks} />
      )}
      {answer === undefined || state.kind !== "read" ? null : (
        <Button
          data-zerops-surface="change-answer-comments"
          onClick={answer.onPress}
          size="sm"
          variant="link"
        >
          {answer.label}
        </Button>
      )}
      {commentable ? (
        <SayBox asker={asker} comments={comments} draftKey={draftKey} onAsk={onAsk} />
      ) : readOnly ? (
        <Text className="mt-1.5" render={<p />} variant="description">
          You have Read access, so you can read this conversation.
        </Text>
      ) : null}
      {commentable && asker === undefined && reaches !== undefined ? (
        <Text className="mt-1.5" render={<p />} variant="description">
          {reaches} sees this on the change.
        </Text>
      ) : null}
    </ReviewSection>
  );
}

function Remarks({
  frame,
  remarks,
  now,
}: {
  readonly frame: ReviewFrame;
  readonly remarks: ReadonlyArray<ChangeRemark>;
  readonly now: number;
}) {
  const [all, setAll] = useState(false);
  if (remarks.length === 0) return null;
  const { hidden } = remarkFold({ frame, total: remarks.length, all });
  return (
    // Marks in a 20 px column, words beside them; then the one box.
    <ol className="mb-3.5 grid gap-3.5">
      {hidden === 0 ? null : (
        <li>
          <Button
            className="ml-5.5"
            onClick={() => {
              setAll(true);
            }}
            size="sm"
            variant="link"
          >
            Show {hidden} earlier
          </Button>
        </li>
      )}
      {remarks.slice(hidden).map((remark) => (
        <li
          className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-0.5 *:first:row-span-2"
          data-zerops-surface="zerops-change-remark"
          key={remark.id}
        >
          <PersonAvatar name={remark.speaker} size={20} />
          <span className="flex min-w-0 items-baseline gap-2 text-body font-medium">
            {remark.speaker}
            <span className="font-normal text-muted-foreground tabular-nums">
              {historyAge(remark.at, now)}
            </span>
          </span>
          <p className="col-start-2 text-body leading-5.5 wrap-anywhere whitespace-pre-wrap">
            {remark.body}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** The room of the comments being read: one line each, the dialog's newest three. */
function RemarksSkeleton({
  count,
  frame,
}: {
  readonly count: number;
  readonly frame: ReviewFrame;
}) {
  if (count === 0) return null;
  const { hidden } = remarkFold({ frame, total: count, all: false });
  return (
    // A comment on its way holds a one-line comment's room: its mark, its name, its line.
    <ol aria-busy="true" className="mb-3.5 grid gap-3.5">
      {hidden === 0 ? null : (
        <li
          aria-hidden="true"
          className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-0.5 h-6"
        />
      )}
      {Array.from({ length: count - hidden }, (_, index) => (
        <li
          aria-hidden="true"
          className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-0.5 h-11"
          key={index}
        >
          <Skeleton className="row-span-2 size-5" shape="pill" surface="card" />
          <Skeleton className="my-1.25 h-2.5 w-24" shape="pill" surface="card" />
          <Skeleton className="my-1.5 h-2.5 w-[64%]" shape="pill" surface="card" />
        </li>
      ))}
    </ol>
  );
}

function SayBox({
  draftKey,
  comments,
  asker,
  onAsk,
}: {
  readonly draftKey: string;
  readonly comments: ChangeDiscussion;
  readonly asker: Asker | undefined;
  readonly onAsk: (said: string) => Promise<void>;
}) {
  const [said, setSaid] = useState(() => drafts.get(draftKey) ?? "");
  const [trouble, setTrouble] = useState<string | null>(null);
  const { say, saying, waiting, pending, landed } = comments;
  const empty = said.trim().length === 0;

  const write = (next: string) => {
    setSaid(next);
    if (next.length === 0) drafts.delete(draftKey);
    else drafts.set(draftKey, next);
  };
  // Words whose answer was lost are the change's once HQ shows them as the person's: no draft.
  const [cleared, setCleared] = useState<string | null>(null);
  if (landed !== null && landed !== cleared) {
    setCleared(landed);
    if (said.trim() === landed) write("");
    setTrouble(null);
  }
  const comment = async () => {
    const body = said.trim();
    if (body.length === 0 || saying) return;
    const refusal = await say(body);
    setTrouble(refusal);
    if (refusal === null) write("");
  };
  const ask = async () => {
    const body = said.trim();
    if (body.length === 0 || saying) return;
    write("");
    await onAsk(body);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.repeat) {
      event.preventDefault();
      void comment();
    }
  };

  return (
    <>
      {/* The one box: a quiet line that grows as it is written in, its two verbs at its end. */}
      <div className="flex items-end gap-1.5 rounded-card bg-card py-1.25 ps-3 pe-1.25 inset-ring-1 inset-ring-foreground/12 transition-shadow duration-150 ease-out-strong focus-within:inset-ring-foreground/22 focus-within:ring-3 focus-within:ring-ring/24">
        <Textarea
          aria-label="Say something on this change"
          className="flex-1"
          onChange={(event) => {
            write(event.target.value);
          }}
          onKeyDown={onKeyDown}
          placeholder={
            asker === undefined
              ? "Comment on this change…"
              : `Comment, or tell ${asker.name} what to change…`
          }
          readOnly={pending !== null}
          rows={1}
          size="line"
          value={pending?.body ?? said}
        />
        <SayVerb
          explains="Adds it to the change's conversation, for everyone on it"
          off={saying || empty}
          onPress={() => {
            void comment();
          }}
          verb={<Button data-zerops-primary-action="Comment" size="sm" variant="ghost" />}
        >
          Comment
        </SayVerb>
        {asker === undefined ? null : (
          <SayVerb
            explains={`${asker.name} changes the code; your words stay on the change too`}
            off={saying || empty}
            onPress={() => {
              void ask();
            }}
            verb={<Button size="sm" variant="secondary" />}
          >
            {asker.tint === undefined ? null : (
              <MateFace shape={asker.shape} size={16} state="idle" tint={asker.tint} />
            )}
            {changeAskLabel(asker.name)}
          </SayVerb>
        )}
      </div>
      {trouble === null ? null : (
        <p className="mt-1.5 text-body leading-4.5 text-status-failed-text">{trouble}</p>
      )}
      {waiting ? (
        <p className="mt-1.5 text-body leading-4.5 text-status-failed-text">
          Sends once HQ has read the conversation.
        </p>
      ) : null}
      {pending?.reconnecting === true ? (
        <p className="mt-1.5 text-body leading-4.5 text-status-failed-text">
          HQ is reconnecting. Your comment shows here once HQ has it.
        </p>
      ) : null}
    </>
  );
}

/**
 * One of the box's verbs, with what it does a hover away. Off while there is nothing to say, yet
 * still hovered: what it would do is worth knowing before a word is written.
 */
function SayVerb({
  verb,
  explains,
  off,
  onPress,
  children,
}: {
  readonly verb: ReactElement;
  readonly explains: string;
  readonly off: boolean;
  readonly onPress: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-disabled={off ? "true" : undefined}
        onClick={() => {
          if (!off) onPress();
        }}
        render={verb}
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>{explains}</TooltipPopup>
    </Tooltip>
  );
}
