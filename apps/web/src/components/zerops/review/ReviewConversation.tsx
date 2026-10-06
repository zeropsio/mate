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
 * nothing. While the conversation is read it holds the room of the comments the change has; one
 * that cannot be read says so, with *Try again*, and the box still takes words. Only people comment on a change (SPEC §3.2a): each remark wears its speaker's initial.
 */
import {
  changeAskLabel,
  changeConversationCount,
  historyAge,
  type ChangeRemark,
} from "@t3tools/client-runtime/zerops";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { useState, type KeyboardEvent, type ReactElement } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import type { ChangeDiscussion } from "~/zerops/useChangeDiscussion";

import { Avatar, MateFace } from "../primitives";
import { remarkFold, type ReviewFrame } from "./ZeropsReview.logic";
import { ReviewFailed, ReviewSection } from "./ZeropsReviewSurface";

/** What was being written on each change, kept while the tab is open. */
const drafts = new Map<string, string>();

/** The person's own Mate that Ask hands the words to, in its face where it is known. */
interface Asker {
  readonly name: string;
  readonly tint: MateTintId | undefined;
  readonly shape?: MateShapeId | undefined;
}

/** A person's mark: the first letter they are known by, which a 20 px disc holds at 12 px. */
function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase();
}

export function ReviewConversation({
  frame,
  draftKey,
  comments,
  remarks,
  count,
  asker,
  commentable,
  now,
  onAsk,
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
  readonly now: number;
  /** Keeps the words on the change and hands them to the Mate. */
  readonly onAsk: (said: string) => Promise<void>;
}) {
  const { state } = comments;
  return (
    <ReviewSection
      aside={state.kind === "read" ? changeConversationCount(remarks) : undefined}
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
      {commentable ? (
        <SayBox asker={asker} comments={comments} draftKey={draftKey} onAsk={onAsk} />
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
    <ol className="rv-remarks">
      {hidden === 0 ? null : (
        <li>
          <button
            className="rv-textbtn rv-fold"
            data-fold="remarks"
            onClick={() => {
              setAll(true);
            }}
            type="button"
          >
            Show {hidden} earlier
          </button>
        </li>
      )}
      {remarks.slice(hidden).map((remark) => (
        <li className="rv-remark" data-zerops-surface="zerops-change-remark" key={remark.id}>
          <Avatar className="rv-remark-avatar" initials={initialOf(remark.speaker)} size="sm" />
          <span className="rv-remark-who">
            {remark.speaker}
            <span className="rv-remark-at">{historyAge(remark.at, now)}</span>
          </span>
          <p className="rv-remark-body">{remark.body}</p>
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
    <ol aria-busy="true" className="rv-remarks">
      {hidden === 0 ? null : <li aria-hidden="true" className="rv-remark-skeleton" data-fold="" />}
      {Array.from({ length: count - hidden }, (_, index) => (
        <li aria-hidden="true" className="rv-remark-skeleton" key={index}>
          <span />
          <span />
          <span />
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
  const { say, saying } = comments;
  const empty = said.trim().length === 0;

  const write = (next: string) => {
    setSaid(next);
    if (next.length === 0) drafts.delete(draftKey);
    else drafts.set(draftKey, next);
  };
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
      <div className="rv-say">
        <textarea
          aria-label="Say something on this change"
          className="rv-say-box"
          onChange={(event) => {
            write(event.target.value);
          }}
          onKeyDown={onKeyDown}
          placeholder={
            asker === undefined
              ? "Comment on this change…"
              : `Comment, or tell ${asker.name} what to change…`
          }
          rows={1}
          value={said}
        />
        <SayVerb
          explains="Adds it to the change's conversation, for everyone on it"
          off={saying || empty}
          onPress={() => {
            void comment();
          }}
          verb={
            <button className="rv-say-comment" data-zerops-primary-action="Comment" type="button" />
          }
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
            verb={<button className="rv-say-ask" type="button" />}
          >
            {asker.tint === undefined ? null : (
              <MateFace
                className="size-4"
                shape={asker.shape}
                size="dot"
                state="idle"
                tint={asker.tint}
              />
            )}
            {changeAskLabel(asker.name)}
          </SayVerb>
        )}
      </div>
      {trouble === null ? null : <p className="rv-say-trouble">{trouble}</p>}
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
