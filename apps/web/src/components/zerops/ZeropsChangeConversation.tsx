/**
 * The conversation on a change, and the two things saying something can do.
 *
 * A change's page reported facts and offered nothing to do about any of them
 * ("no buttons, no comments, no passing actions to agent" — the owner,
 * 2026-09-19). This is the missing half: what has been said, drawn on the same
 * spine the menu and the history draw work on, and a box under it whose two
 * verbs differ by one thing.
 *
 * **Comment** says it on the change and stays here. **Ask <Mate>** says it
 * *and* opens that Mate's conversation with the request already written, so
 * the change keeps the record and the agent gets the instruction. It stops at
 * composing — the person presses send, as everywhere a prompt is prefilled
 * (spec §5.4).
 *
 * A Mate speaks under its bot login and is named here, never shown as
 * `mate-abc123`; that resolution and the sentence handed over are
 * `changeConversation.ts`'s (R5).
 */
import {
  changeAskLabel,
  changeAskPrompt,
  historyAge,
  preferredMateTint,
  type ChangeRemark,
} from "@t3tools/client-runtime/zerops";
import { useCallback, useState } from "react";

import type { ZeropsChangeComments } from "~/zerops/useZeropsChangeComments";
import { useNowMs } from "~/zerops/useNowMs";

import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Avatar, MateFace } from "./primitives";
import { RAIL_BLANK, RAIL_COLUMN, RAIL_LINE } from "./rail";

/** A person's initials from whatever we know them by. */
function initialsOf(name: string): string {
  const parts = name.split(/[\s._-]+/u).filter((part) => part.length > 0);
  const letters = parts.slice(0, 2).map((part) => part[0] ?? "");
  return (letters.join("") || name.slice(0, 1)).toUpperCase();
}

export function ZeropsChangeConversation({
  change,
  comments,
  mateName,
  onAsk,
  remarks,
}: {
  readonly change: {
    readonly repository: string;
    readonly number: number;
    readonly title: string;
    readonly mateProjectId: string | undefined;
  };
  readonly comments: ZeropsChangeComments;
  /** What the Mate that owns this change is called, where one does. */
  readonly mateName: string | undefined;
  /** Writes the request into that Mate's composer and goes there. */
  readonly onAsk: (mateProjectId: string | undefined, ask: string) => void;
  readonly remarks: ReadonlyArray<ChangeRemark>;
}) {
  const [said, setSaid] = useState("");
  const [trouble, setTrouble] = useState<string | null>(null);
  const now = useNowMs();
  const { say, saying, state } = comments;
  const { mateProjectId, number, repository, title } = change;
  const askLabel = changeAskLabel(mateName);

  const comment = useCallback(async () => {
    const body = said.trim();
    if (body.length === 0) return;
    const refusal = await say(body);
    setTrouble(refusal);
    if (refusal === null) setSaid("");
  }, [said, say]);

  const ask = useCallback(async () => {
    const body = said.trim();
    // The change keeps the record of what was asked; the Mate gets the
    // instruction either way, because the instruction is the point.
    if (body.length > 0) setTrouble(await say(body));
    onAsk(mateProjectId, changeAskPrompt({ number, repository, said: body, title }));
    setSaid("");
  }, [mateProjectId, number, onAsk, repository, said, say, title]);

  return (
    <div className="flex flex-col" data-zerops-surface="zerops-change-conversation">
      {state.kind === "no-gitea" ? (
        <ConversationNote>Sign in to Gitea to read what was said here.</ConversationNote>
      ) : state.kind === "failed" ? (
        <ConversationNote>{state.reason}</ConversationNote>
      ) : state.kind === "reading" ? (
        <ConversationNote>Reading the conversation&hellip;</ConversationNote>
      ) : remarks.length === 0 ? null : (
        <ul className="flex flex-col">
          {remarks.map((remark, index) => (
            <Remark first={index === 0} key={remark.id} last={false} now={now} remark={remark} />
          ))}
        </ul>
      )}

      {/* What is being written is the next thing on this line, so it hangs off
          the same rail rather than floating under it. */}
      <div className="flex min-w-0 items-stretch gap-2.5">
        <span className={RAIL_COLUMN}>
          {/* Pinned to the box's first line rather than centred in it: a tall
              textarea would otherwise hang the node halfway down its side. */}
          <span
            aria-hidden="true"
            className={remarks.length === 0 ? "h-5 w-px" : "h-5 w-px bg-[var(--zerops-rail)]"}
          />
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full border border-[var(--zerops-rail)] bg-background"
          />
          <span aria-hidden="true" className={RAIL_BLANK} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2 pt-2">
          <Textarea
            aria-label="Say something on this change"
            className="min-h-20 resize-y"
            disabled={state.kind === "no-gitea"}
            onChange={(event) => {
              setSaid(event.target.value);
            }}
            placeholder={
              mateName === undefined
                ? "Say something on this change…"
                : `Say something, or tell ${mateName} what to change…`
            }
            value={said}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              data-zerops-primary-action="Comment"
              disabled={saying || said.trim().length === 0 || state.kind === "no-gitea"}
              onClick={() => {
                void comment();
              }}
              size="sm"
              variant="outline"
            >
              {saying ? "Saying…" : "Comment"}
            </Button>
            <Button
              disabled={saying || state.kind === "no-gitea"}
              onClick={() => {
                void ask();
              }}
              size="sm"
              variant="outline"
            >
              {/* The Mate's own face tells the two verbs apart, so neither has to
                compete with the one primary this page has. */}
              {mateName === undefined ? null : (
                <MateFace size="dot" state="idle" tint={preferredMateTint(mateName)} />
              )}
              {askLabel}
            </Button>
          </div>
          {/* What the second verb does with what is typed, said once rather than
            discovered by pressing it. */}
          <p className="text-xs text-muted-foreground">
            {said.trim().length === 0
              ? "Asking with an empty box hands the whole change over."
              : "Asking says it here too, then opens the conversation."}
          </p>
          {trouble === null ? null : (
            <p className="text-xs text-[var(--zerops-status-failed-text)]">{trouble}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Remark({
  first,
  last,
  now,
  remark,
}: {
  readonly first: boolean;
  readonly last: boolean;
  /** One clock for the list: rows a moment apart must not disagree by a minute. */
  readonly now: number;
  readonly remark: ChangeRemark;
}) {
  return (
    <li className="flex min-w-0 items-stretch gap-2.5" data-zerops-surface="zerops-change-remark">
      <span className={RAIL_COLUMN}>
        {/* Pinned to the first line: a comment is as tall as what somebody
            wrote, and a centred face drifts down the rail as the body grows. */}
        <span
          aria-hidden="true"
          className={first ? "h-2 w-px" : "h-2 w-px bg-[var(--zerops-rail)]"}
        />
        {/* A Mate wears its face; a person gets the open disc the history
            gives a commit nobody is running. Both are 20px, so the rail runs
            through their shared centre rather than jogging at every turn. */}
        {remark.mateProjectId === undefined ? (
          <Avatar
            className="size-5 border border-[var(--zerops-rail)] bg-background text-[9px]"
            initials={initialsOf(remark.speaker)}
            size="sm"
          />
        ) : (
          <MateFace size="sm" state="idle" tint={preferredMateTint(remark.speaker)} />
        )}
        <span aria-hidden="true" className={last ? RAIL_BLANK : RAIL_LINE} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate text-sm leading-5 font-medium">{remark.speaker}</span>
          {remark.at === undefined ? null : (
            <span className="shrink-0 text-[11px] leading-5 text-muted-foreground tabular-nums">
              {/* The age, not the date. The commits under this list already say
                  `40m` and `1h`; a remark from an hour ago that read `Sep 19`
                  put two clocks on one page. */}
              {historyAge(remark.at, now)}
            </span>
          )}
        </span>
        <span className="text-sm leading-5 whitespace-pre-wrap text-muted-foreground">
          {remark.body}
        </span>
      </span>
    </li>
  );
}

function ConversationNote({ children }: { readonly children: React.ReactNode }) {
  return <p className="py-4 text-sm text-muted-foreground">{children}</p>;
}
