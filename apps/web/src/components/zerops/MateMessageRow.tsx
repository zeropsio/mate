/**
 * Messages between a person's Mates, as a conversation draws them (the owner, 2026-11-17: "in the
 * color of the bot or something, to make it distinct", "classic show more"):
 *
 * - Another Mate's message, or its answer, wears that Mate's hue: its face and name in it, its
 *   words drawn as a message's are, folded past a message's length behind Show more.
 * - While this Mate waits for an answer, the asked Mate stands at the conversation's bottom, as work
 *   that runs on elsewhere does: its face live, what was asked and since when, its conversation a
 *   press away. A bare line there said nothing of whether anyone was at it.
 */
import { useAtomValue } from "@effect/atom-react";
import { shownHqMateIdentitiesAtom } from "@t3tools/client-runtime/data";
import {
  type MateMessageItem,
  mateMessageSenderName,
  type ScopedThreadRef,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import { createContext, type ReactNode, use, useCallback, useState } from "react";

import { mateActivityAtom } from "../../zerops/mateActivityAtoms";
import { useOpenMate } from "../../zerops/useOpenMate";
import ChatMarkdown from "../ChatMarkdown";
import type { AwaitedMateAnswer } from "../chat/MessagesTimeline.logic";
import { DetailRow, spanOf } from "../chat/DetailRow";
import { FOLD_FADE_MASK, foldsLikeAMessage } from "../chat/RunChat";
import { Button } from "../ui/button";
import { MateFace } from "./primitives";

/**
 * Opens another Mate's conversation by its project: the conversation pane gives it (`OpenMateProvider`
 * around its `KeptTimelines`, under the router); where none is given, as in a design harness, a row opens nothing.
 */
export const OpenMateContext = createContext<((projectId: string) => void) | null>(null);

/** Gives the conversation pane's rows a way to open another Mate, as every door opens one. */
export function OpenMateProvider({ children }: { readonly children: ReactNode }) {
  const openMate = useOpenMate();
  const open = useCallback((projectId: string) => openMate({ projectId }), [openMate]);
  return <OpenMateContext value={open}>{children}</OpenMateContext>;
}

/** A Mate's face and hue as the menu wears them; a neutral one where this account names none. */
function useMateLook(projectId: string) {
  const identity = useAtomValue(shownHqMateIdentitiesAtom)[projectId];
  return {
    tint: identity?.tint ?? "slate",
    ...(identity === undefined ? {} : { shape: identity.shape }),
  };
}

/** What follows the sender's name: its project for a message, that it answered for an answer. */
function headingRest(item: MateMessageItem, name: string): string | null {
  if (item.kind === "answer") return "answered";
  const project = item.from.projectName.trim();
  return project === "" || project === name ? null : project;
}

export function MateMessageRow({
  item,
  text,
  markdownCwd,
  threadRef,
  skills,
}: {
  readonly item: MateMessageItem;
  readonly text: string;
  readonly markdownCwd: string | undefined;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
}) {
  const look = useMateLook(item.from.projectId);
  const name = mateMessageSenderName(item.from);
  const rest = headingRest(item, name);
  const [expanded, setExpanded] = useState(false);
  // Its words fold as a person's and the Mate's own do: one rule for every message.
  const folds = foldsLikeAMessage(text);
  const folded = folds && !expanded;
  return (
    <article
      className="mate-letter flex min-w-0 flex-col gap-2 rounded-2xl px-4 pt-3 pb-2"
      data-mate-tint={look.tint}
      data-zerops-surface="mate-message"
    >
      <header className="flex min-w-0 items-center gap-2 text-line">
        <MateFace size={24} state="idle" {...look} />
        <span className="mate-letter-from min-w-0 truncate">{name}</span>
        {rest === null ? null : (
          <span className="min-w-0 truncate text-muted-foreground">
            {item.kind === "answer" ? rest : `· ${rest}`}
          </span>
        )}
      </header>
      <div
        className={folded ? "relative min-w-0 max-h-44 overflow-hidden" : "min-w-0"}
        data-mate-message-folded={folded ? "true" : "false"}
        style={folded ? { WebkitMaskImage: FOLD_FADE_MASK, maskImage: FOLD_FADE_MASK } : undefined}
      >
        <ChatMarkdown cwd={markdownCwd} skills={skills} text={text} threadRef={threadRef} />
      </div>
      {folds ? (
        <div className="-ml-2 flex">
          <Button
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {expanded ? "Show less" : "Show more"}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

/** The first line of what was asked; "Your message" where its words were not read. */
const askedTitle = (awaited: AwaitedMateAnswer): string =>
  awaited.words
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "") ?? "Your message";

/**
 * One answer awaited: what was asked, the asked Mate's state now, since when; it opens that Mate.
 * Its mark is busy whatever the Mate is doing: the question is open until its answer comes. Where
 * the head names one Mate the row says only its state; under several, whose state it is.
 */
function AwaitedAnswerRow({
  awaited,
  named,
}: {
  readonly awaited: AwaitedMateAnswer;
  readonly named: boolean;
}) {
  const activity = useAtomValue(mateActivityAtom(awaited.projectId));
  const openMate = use(OpenMateContext);
  // Its state as its menu row says it; "Idle" where the row's words have none for nothing going on.
  const state = activity === undefined ? undefined : (activity.status?.label ?? "Idle");
  const word = named ? (state === undefined ? awaited.name : `${awaited.name} · ${state}`) : state;
  return (
    <DetailRow
      onOpen={openMate === null ? undefined : () => openMate(awaited.projectId)}
      time={spanOf(awaited.askedAt, null)}
      title={askedTitle(awaited)}
      tone="busy"
      word={word}
    />
  );
}

/** "Fia's answer", "answers from Fia and Sage". */
function awaitedWords(awaited: ReadonlyArray<AwaitedMateAnswer>): string {
  const names = [...new Set(awaited.map((entry) => entry.name))];
  if (names.length <= 1) return `Waiting for ${names[0] ?? "another Mate"}'s answer`;
  return `Waiting for answers from ${names.slice(0, -1).join(", ")} and ${names.at(-1)!}`;
}

/**
 * The conversation's bottom while it waits for other Mates' answers: the first asked Mate's face
 * in its live state (working on it, idle, asleep), and a row per message asked.
 */
export function MateAnswerWait({
  awaited,
}: {
  readonly awaited: ReadonlyArray<AwaitedMateAnswer>;
}) {
  const first = awaited[0]!;
  const look = useMateLook(first.projectId);
  const activity = useAtomValue(mateActivityAtom(first.projectId));
  const several = new Set(awaited.map((entry) => entry.projectId)).size > 1;
  return (
    <section
      aria-label={awaitedWords(awaited)}
      className="run-tray run-tray-whole @container/panel animate-panel-in text-card-foreground motion-reduce:animate-none"
      data-zerops-surface="mate-answer-wait"
    >
      <div className="run-now">
        <MateFace size={24} state={activity?.face ?? "idle"} {...look} />
        <span className="run-now-words run-now-head">
          <span className="run-now-verb">{awaitedWords(awaited)}</span>
        </span>
      </div>
      <ul className="run-band grid">
        {awaited.map((entry) => (
          <AwaitedAnswerRow awaited={entry} key={entry.id} named={several} />
        ))}
      </ul>
    </section>
  );
}
