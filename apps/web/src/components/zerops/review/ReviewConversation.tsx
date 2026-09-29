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
 * that cannot be read says so, with *Try again*, and the box still takes words.
 */
import {
  changeAskLabel,
  changeConversationCount,
  historyAge,
  preferredMateTint,
  type ChangeRemark,
} from "@t3tools/client-runtime/zerops";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { useState, type KeyboardEvent, type ReactElement } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import type { ZeropsChangeComments } from "~/zerops/useZeropsChangeComments";

import { Avatar, MateFace } from "../primitives";
import { remarkFold, type ReviewFrame } from "./ZeropsReview.logic";
import { ReviewFailed, ReviewSection } from "./ZeropsReviewSurface";

/** What was being written on each change, kept while the tab is open. */
const drafts = new Map<string, string>();

/** A Mate's face as a review draws it: its tint, and the shape its person picked. */
export interface MateFaceOf {
  readonly tint: MateTintId;
  readonly shape: MateShapeId;
}

/** The person's own Mate that Ask hands the words to, in its face where it is known. */
interface Asker {
  readonly name: string;
  readonly tint: MateTintId | undefined;
  readonly shape?: MateShapeId | undefined;
}

/**
 * A remark a Mate made, in that Mate's face — the project's own record of it — and, for a
 * Mate the project no longer lists, the tint its name asks for.
 */
function RemarkFace({
  face,
  speaker,
}: {
  readonly face: MateFaceOf | undefined;
  readonly speaker: string;
}) {
  return (
    <MateFace
      shape={face?.shape}
      size="sm"
      state="idle"
      tint={face?.tint ?? preferredMateTint(speaker)}
    />
  );
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
  mateFaces,
  now,
  onAsk,
}: {
  readonly frame: ReviewFrame;
  /** The change the draft belongs to. */
  readonly draftKey: string;
  readonly comments: ZeropsChangeComments;
  readonly remarks: ReadonlyArray<ChangeRemark>;
  /** How many comments the change has, as the flow read it: the room its conversation holds. */
  readonly count: number | undefined;
  /** The person's own Mate that wrote the change: the one Ask hands the words to. */
  readonly asker: Asker | undefined;
  /** The project's Mates by project: a remark one of them made wears its face. */
  readonly mateFaces?: ReadonlyMap<string, MateFaceOf> | undefined;
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
      ) : state.kind === "no-gitea" ? (
        <p className="rv-note">Sign in to Gitea to read what was said here.</p>
      ) : (
        <Remarks frame={frame} mateFaces={mateFaces} now={now} remarks={remarks} />
      )}
      <SayBox asker={asker} comments={comments} draftKey={draftKey} onAsk={onAsk} />
    </ReviewSection>
  );
}

function Remarks({
  frame,
  remarks,
  mateFaces,
  now,
}: {
  readonly frame: ReviewFrame;
  readonly remarks: ReadonlyArray<ChangeRemark>;
  readonly mateFaces: ReadonlyMap<string, MateFaceOf> | undefined;
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
          {remark.mateProjectId === undefined ? (
            <Avatar className="rv-remark-avatar" initials={initialOf(remark.speaker)} size="sm" />
          ) : (
            <RemarkFace face={mateFaces?.get(remark.mateProjectId)} speaker={remark.speaker} />
          )}
          <span className="rv-remark-who">
            {remark.speaker}
            {remark.at === undefined ? null : (
              <span className="rv-remark-at">{historyAge(remark.at, now)}</span>
            )}
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
  readonly comments: ZeropsChangeComments;
  readonly asker: Asker | undefined;
  readonly onAsk: (said: string) => Promise<void>;
}) {
  const [said, setSaid] = useState(() => drafts.get(draftKey) ?? "");
  const [trouble, setTrouble] = useState<string | null>(null);
  const { say, saying, state } = comments;
  const off = saying || state.kind === "no-gitea";
  const empty = said.trim().length === 0;

  const write = (next: string) => {
    setSaid(next);
    if (next.length === 0) drafts.delete(draftKey);
    else drafts.set(draftKey, next);
  };
  const comment = async () => {
    const body = said.trim();
    if (body.length === 0 || off) return;
    const refusal = await say(body);
    setTrouble(refusal);
    if (refusal === null) write("");
  };
  const ask = async () => {
    const body = said.trim();
    if (body.length === 0 || off) return;
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
      <div className="rv-say" data-off={state.kind === "no-gitea" ? "" : undefined}>
        <textarea
          aria-label="Say something on this change"
          className="rv-say-box"
          disabled={state.kind === "no-gitea"}
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
          off={off || empty}
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
            off={off || empty}
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
