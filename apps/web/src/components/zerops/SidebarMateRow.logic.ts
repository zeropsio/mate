/**
 * What a Mate's row in the left menu draws, read from what the row knows —
 * pure, so each rule has its table.
 */
import { pullRequestBlocked, type FlowPullRequest } from "@t3tools/client-runtime/zerops";
import type { MateMarkState } from "@t3tools/shared/brand";

import type { ZeropsAgentActivity } from "~/zerops/agentActivity";

/** Whose Mate it is, as the mark before its name draws it. */
export interface OwnerMark {
  /** One letter, on the person's own hue where there is no picture. */
  readonly initial: string;
  /** The person's hue, 0–359: one person, one colour, on every row. */
  readonly hue: number;
  readonly picture: string | null;
  /** What the mark says to somebody who cannot see it, and on hover. */
  readonly label: string;
}

/**
 * The person as a 16 px mark: their picture, or their initial on a colour of
 * their own. The hue is read off the name, so it is the same on every row and
 * every reload without anything stored.
 */
export function ownerMark(owner: {
  readonly name: string;
  readonly initials: string;
  readonly avatarUrl: string | null;
}): OwnerMark {
  let hash = 5381;
  for (const character of owner.name) {
    hash = (hash * 33 + (character.codePointAt(0) ?? 0)) % 1_000_003;
  }
  return {
    initial: (owner.initials.trim().charAt(0) || owner.name.trim().charAt(0)).toLocaleUpperCase(),
    hue: hash % 360,
    picture: owner.avatarUrl !== null && owner.avatarUrl.length > 0 ? owner.avatarUrl : null,
    label: `${owner.name}'s Mate`,
  };
}

/**
 * The one colour a change row's pull-request mark may wear (S3): red where
 * its checks fail — broken — and amber where it has fallen behind `main` and
 * no longer merges — it didn't go through. Everything else is the mark's own
 * grey: checks running, Gitea still working the answer out, or nothing wrong.
 * The verdict itself lives in the review, not on the row; a change drawn from
 * memory says nothing until Gitea says it again.
 */
export function changeMarkTone(
  pull: Pick<FlowPullRequest, "number" | "mergeability" | "checks">,
  remembered: boolean,
): "failed" | "attention" | undefined {
  if (remembered) return undefined;
  if (pull.checks === "failing") return "failed";
  return pullRequestBlocked(pull)?.kind === "behind" ? "attention" : undefined;
}

/**
 * A Mate's row in one of its states (M7): no status word says it — the
 * face, a dot and the content itself do.
 */
export type MateRowState = "idle" | "working" | "needs" | "unread" | "failed" | "paused";

/** The right of the name: when it last did something, the run's clock, or when it picks up. */
export type MateRowSlot =
  | { readonly kind: "age" }
  | { readonly kind: "clock"; readonly since: string }
  | { readonly kind: "paused"; readonly until: string }
  | { readonly kind: "none" };

/** The third line: the Mate's words in the state's ink, its live step, or the dots holding the line. */
export type MateRowReply =
  | {
      readonly kind: "words";
      readonly text: string;
      /** Muted at rest, the second ink unread, full ink as a question, red as an error. */
      readonly tone: "muted" | "ink-2" | "ink" | "failed";
    }
  | { readonly kind: "live"; readonly words: string; readonly code: string | undefined }
  | { readonly kind: "pending" }
  | undefined;

export interface MateRowView {
  readonly state: MateRowState;
  /** The face it wears: the one mapping's, but still where it stands stopped on an error. */
  readonly face: MateMarkState;
  readonly slot: MateRowSlot;
  /** The dot before the age: amber needs you, blue unread, red broken (S3). */
  readonly dot: "attention" | "unread" | "failed" | undefined;
  /** Finished and not seen: the name at 600. */
  readonly strongName: boolean;
  /** The second line: the person's last ask, whatever step the Mate is on. */
  readonly ask: string | undefined;
  readonly reply: MateRowReply;
}

/**
 * What a Mate's row says, from what its conversation says (`activity`, the
 * one resolver's reading, R5) and the face it wears (`mateFaceFor`):
 *
 * | state               | face                     | right of the name   | third line               |
 * | ------------------- | ------------------------ | ------------------- | ------------------------ |
 * | idle, seen          | still                    | age                 | its last words, muted    |
 * | working             | turns, glances           | the run's clock     | its live step, or dots   |
 * | needs you           | hops, waits with the "o" | amber dot + age     | the question, in ink     |
 * | finished, not seen  | pops, smiles             | blue dot + age      | its last words, 2nd ink  |
 * | stopped on an error | still                    | red dot + age       | the error's line, red    |
 *
 * The second line is always the person's last ask. A row with no answer is
 * simply shorter; while words are coming — a run on, or a message sent and
 * its run not started — the third line keeps its place with the dots.
 */
export function mateRowView(
  activity: ZeropsAgentActivity | undefined,
  face: MateMarkState,
): MateRowView {
  if (activity === undefined) {
    return {
      state: "idle",
      face,
      slot: { kind: "none" },
      dot: undefined,
      strongName: false,
      ask: undefined,
      reply: undefined,
    };
  }
  const ask = activity.task ?? activity.subject;
  const words = activity.snippet;
  const said = (tone: "muted" | "ink-2" | "ink" | "failed"): MateRowReply =>
    words === undefined
      ? activity.awaitingWords === true
        ? { kind: "pending" }
        : undefined
      : { kind: "words", text: words, tone };
  const age: MateRowSlot = ask === undefined ? { kind: "none" } : { kind: "age" };
  const state = mateRowState(activity, face);
  const view = (reply: MateRowReply, slot: MateRowSlot = age) => ({
    state,
    face: state === "failed" ? ("idle" as const) : face,
    slot,
    dot:
      state === "needs"
        ? ("attention" as const)
        : state === "unread"
          ? ("unread" as const)
          : state === "failed"
            ? ("failed" as const)
            : undefined,
    strongName: state === "unread",
    ask,
    reply: ask === undefined ? undefined : reply,
  });
  switch (state) {
    case "working":
      return view(
        activity.liveStep === undefined
          ? { kind: "pending" }
          : { kind: "live", words: activity.liveStep.words, code: activity.liveStep.code },
        { kind: "clock", since: activity.at },
      );
    case "needs":
      return view(
        activity.question === undefined
          ? said("ink")
          : { kind: "words", text: activity.question, tone: "ink" },
      );
    case "failed":
      return view(
        activity.errorLine === undefined
          ? said("muted")
          : { kind: "words", text: activity.errorLine, tone: "failed" },
      );
    case "unread":
      return view(said("ink-2"));
    case "paused":
      return view(said("muted"), { kind: "paused", until: activity.pausedUntil ?? activity.at });
    case "idle":
      return view(said("muted"));
  }
}

/** Which of the table's states a row is in: what waits on the person first. */
function mateRowState(activity: ZeropsAgentActivity, face: MateMarkState): MateRowState {
  // Paused at a usage limit it sleeps, whatever its last turn said: a turn
  // that hits the limit ends failed — "Claude usage limit reached…" — with
  // the pause standing, and the resume picks the work up without anybody
  // (`mateMarkStateForThread`). What waits on a person still wakes it: its
  // face is not asleep then.
  if (face === "sleep" && activity.pausedUntil !== undefined) return "paused";
  if (activity.kind === "failed") return "failed";
  if (face === "needs") return "needs";
  if (
    activity.kind === "working" ||
    activity.kind === "connecting" ||
    activity.kind === "monitoring"
  )
    return "working";
  return activity.unread ? "unread" : "idle";
}
