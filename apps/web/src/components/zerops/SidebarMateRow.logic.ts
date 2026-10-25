import type { MatePresence } from "@t3tools/shared/hqMates";
import { personMark } from "./primitives/person.logic";
import { messagePreviewText } from "@t3tools/shared/messagePreview";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  lastKnownMateWords,
  mateAwaySettling,
  mateUnreachableWords,
} from "../../zerops/lastKnownMate.logic";
import { pullRequestName, type AutomatedKeyState } from "../../zerops/automatedMate.logic";
import { mateStatus } from "../../zerops/mateStatus.logic";
import { TASK_STATUS_WORDS, type TaskStatus } from "../../zerops/taskStatus";
import { mateFailureWords, usageLimitWords } from "../../zerops/noticeWords";
/**
 * What a Mate's row in the left menu draws, read from what the row knows —
 * pure, so each rule has its table.
 */
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  matePose,
  pullRequestBlocked,
  type MateLife,
  type MatePoseFacts,
  type FlowPullRequest,
  type ZeropsGroupPendingMember,
} from "@t3tools/client-runtime/zerops";
import { CREW_SET_UP_WORD } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewStatus } from "@t3tools/contracts";
import type { MateMarkState } from "@t3tools/shared/brand";
import { shareEqual } from "@t3tools/shared/structuralSharing";

import { mateFaceOf, restingWhenFree, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import type { MateComing } from "@t3tools/client-runtime/data";
import { MATE_STAND_UP_MESSAGE } from "~/zerops/mateStandUp";
import { backgroundWorkWords, nowLineWords } from "../chat/runCard.logic";
import { STOPPING_WORDS } from "~/zerops/conversationStop.logic";

import { formatWorkingTime } from "./SidebarZeropsTree.logic";

/**
 * The props a Mate's row is handed read anew on each draw of the menu — whose it is, whether it
 * is still coming up — and compared by what they say. Every other prop is the same value or a
 * change: the activity, the menu and the verbs stand while they say the same (`matesActivityOf`).
 */
const READ_ANEW: ReadonlySet<string> = new Set([
  "owner",
  "coming",
  "crew",
  "change",
  // A project's row: its previews, and its changes and release, read anew from its flow.
  "apps",
  "review",
]);

/**
 * Whether a memoised Mate's row may skip its redraw: every prop the same, the ones read anew
 * (`READ_ANEW`) the same in what they say. A streaming Mate redraws the menu on every event of
 * its chat; only the rows whose own props changed redraw with it, and switching Mates redraws the
 * two whose `active` changed.
 */
export function mateRowPropsEqual<P extends object>(previous: P, next: P): boolean {
  const before = previous as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  if (keys.length !== Object.keys(before).length) return false;
  return keys.every(
    (key) =>
      Object.hasOwn(before, key) &&
      (Object.is(before[key], after[key]) ||
        (READ_ANEW.has(key) && shareEqual(before[key], after[key]) === before[key])),
  );
}

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
 * The person as a 16 px mark: their picture, or their letter on a colour of their own
 * (`personMark`), the same as every other surface draws them.
 */
export function ownerMark(owner: {
  readonly name: string;
  readonly initials: string;
  readonly avatarUrl: string | null;
}): OwnerMark {
  const mark = personMark({ name: owner.name, picture: owner.avatarUrl });
  return {
    initial: mark.letter || owner.initials.trim().charAt(0).toLocaleUpperCase(),
    hue: mark.hue,
    picture: mark.picture,
    label: `${owner.name}'s Mate`,
  };
}

/**
 * Whose Mate it is, as the seat before its name draws it:
 * - `person` — its owner, named by the member list: their picture or initial;
 * - `unnamed` — its records name somebody the member list has not named: not
 *   read yet, the read failed, or they are not in it. A neutral disc keeps
 *   the place, so nothing moves when they are read, and nothing is worth an
 *   error;
 * - `nobody` — its records name nobody: no `OWNER` entry, and nobody has
 *   signed its agent in. An empty seat, the "no assignee" convention, with
 *   the state in words: it is nobody's until somebody signs it in.
 */
export type OwnerSeat =
  | { readonly kind: "person"; readonly mark: OwnerMark }
  | { readonly kind: "unnamed" }
  | { readonly kind: "nobody"; readonly label: string };

export interface MateOwnerView {
  readonly seat: OwnerSeat;
  /** The row's second line where it says nothing else: nobody has signed its agent in. */
  readonly signInLine: string | undefined;
  /** That sign-in is the viewer's to make: they added the Mate. The line in ink, the amber dot. */
  readonly waitsOnViewer: boolean;
}

const NOBODY_SIGNED_IN = "Nobody has signed in yet";
const WAITING_FOR_YOUR_SIGN_IN = "Waiting for your sign-in";
const WAITING_FOR_SIGN_IN = "Waiting for sign-in";
const NOBODY_OWNS = "No owner yet. Whoever signs in its coding agent owns it.";

/**
 * Whose seat a Mate's row draws, and whether it says that nobody has signed
 * its agent in (the owner, 2026-09-29: "mate without auth / owner should have
 * the state specially handled"):
 *
 * | its records                   | the member list | seat           | never asked                       |
 * | ----------------------------- | --------------- | -------------- | --------------------------------- |
 * | name nobody                   | —               | the empty seat | the line                          |
 * | an `OWNER`, nobody signed in  | named           | their picture  | the line                          |
 * | an `OWNER`, nobody signed in  | not named yet   | a neutral disc | the line                          |
 * | somebody signed in            | named           | their picture  | nothing: a row as tall as it says |
 * | somebody signed in            | not named       | a neutral disc | nothing                           |
 *
 * The line takes the row's second line only where nothing was asked: a Mate
 * somebody has talked to says what was asked, and the seat alone says it is
 * nobody's. It is a fact with nothing to press on it: the row's own press
 * opens the Mate, whose conversation holds the sign-in (the owner,
 * 2026-09-29, of a *Sign in* on the row: it did nothing there, and stood on
 * the row's edge).
 *
 * To the person who made it — named by HQ's record, whether New project or Add a Mate made it, or
 * by its stand-up's record on a Mate recorded before HQ kept its maker — the line says it waits
 * on them: "Waiting for your sign-in", in ink, with the amber dot of what needs them (board D1,
 * 2026-09-30). One state, one phrase whichever flow made it (run 4, 2026-10-02). A Mate whose
 * sign-in somebody is waited for never reads like a failure (the owner, 2026-10-01): anybody else
 * reads that it waits for a sign-in, quietly, and a viewer not known yet reads nothing. A Mate
 * that names nobody reads the fact. A Mate that runs on an agent that needs no sign-in (Cursor,
 * OpenCode…: HQ's overview) waits on nobody's sign-in and says none of it; its maker holds its
 * seat, as its records name them.
 */
export function mateOwnerView(input: {
  readonly owner:
    | { readonly name: string; readonly initials: string; readonly avatarUrl: string | null }
    | undefined;
  /**
   * What its records say (`mateOwnerRecords`): `named` unknown while HQ has not named its owner; a
   * Mate that runs on an agent Mate signs nobody in to (HQ's overview) waits on no sign-in.
   */
  readonly records: {
    readonly named: boolean | undefined;
    readonly signedIn: boolean;
    readonly runsWithoutSignIn?: boolean | undefined;
  };
  /** The row already says what was asked under the name. */
  readonly asked: boolean;
  /**
   * Whether HQ names anybody who signed its agents in (its project's `everSignedIn`): `some`, `none`,
   * or `undefined` while HQ has not said — then the row says nothing of a sign-in.
   */
  readonly hqSigners: "some" | "none" | undefined;
  /**
   * What HQ holds of the Mate (its presence's `overview`), `undefined` with no presence at all.
   * Whether anybody signed its agent in is HQ's to say only once it has heard the Mate (`live` or
   * `stored`); otherwise the row says nothing of a sign-in.
   */
  readonly overview: MatePresence["overview"] | undefined;
  /** Who added it, as HQ's stand-up record names them (`readZeropsMembership(…).standUp`). */
  readonly standUpBy?: string | undefined;
  /** Who made it, as HQ's record names them (`readZeropsMembership(…).madeBy`). */
  readonly madeBy?: string | undefined;
  /** The Zerops user looking, when known. */
  readonly viewer?: string | undefined;
  /**
   * Its link is made, so its page can show the sign-in. Until then the row says the words and
   * does not wait on the viewer: the page is still connecting, and the dot would ask for what
   * the page cannot offer yet.
   */
  readonly linked?: boolean | undefined;
}): MateOwnerView {
  const { owner, records } = input;
  const seat: OwnerSeat =
    owner !== undefined
      ? { kind: "person", mark: ownerMark(owner) }
      : records.named === false
        ? { kind: "nobody", label: NOBODY_OWNS }
        : { kind: "unnamed" };
  if (
    records.signedIn ||
    input.hqSigners !== "none" ||
    (input.overview !== "live" && input.overview !== "stored") ||
    input.asked ||
    records.runsWithoutSignIn === true
  ) {
    return { seat, signInLine: undefined, waitsOnViewer: false };
  }
  const viewer = input.viewer !== undefined && input.viewer.length > 0 ? input.viewer : undefined;
  const awaited = input.madeBy ?? input.standUpBy;
  if (awaited === undefined) {
    return { seat, signInLine: NOBODY_SIGNED_IN, waitsOnViewer: false };
  }
  // Whose sign-in it waits for, never a failure — and nothing until it is known who is looking.
  if (viewer === undefined) return { seat, signInLine: undefined, waitsOnViewer: false };
  const yours = awaited === viewer;
  return {
    seat,
    signInLine: yours ? WAITING_FOR_YOUR_SIGN_IN : WAITING_FOR_SIGN_IN,
    waitsOnViewer: yours && input.linked === true,
  };
}

/** What a Mate's face can wear on its corner: a person's picture, or nobody's empty seat. */
export type BadgeSeat = Exclude<OwnerSeat, { readonly kind: "unnamed" }>;

/**
 * What the corner of a Mate's face wears in the menu (the owner, 2026-09-30:
 * "(face) Cleo" before the name read as a person called Cleo): a colleague's
 * picture, or the empty seat of a Mate nobody has signed in; the viewer's own
 * Mate nothing, and one whose owner the member list has not named yet nothing
 * either — it may be the viewer's, and a badge only ever arrives.
 */
export function ownerBadge(seat: OwnerSeat, isViewer: boolean): BadgeSeat | null {
  if (seat.kind === "nobody") return seat;
  return seat.kind === "person" && !isViewer ? seat : null;
}

/**
 * Whether a Mate's row reads as not the viewer's — its face paler under its
 * owner's badge (the owner, 2026-09-30: "the not yours should have the avatar
 * bigger and maybe some other small visual diff also"): a colleague's, and
 * nobody's until somebody signs it in. Known from the first paint: the owner
 * HQ's people name, or before they have named them, the signer HQ's overview
 * names against the viewer's own id; a Mate that may be the viewer's reads as
 * theirs.
 */
export function mateNotYours(input: {
  readonly seat: OwnerSeat;
  readonly isViewer: boolean;
  /** The user id its signer is, as HQ's overview names them (`mateOwnerRecords`). */
  readonly signer: string | undefined;
  readonly viewer: string | undefined;
}): boolean {
  switch (input.seat.kind) {
    case "nobody":
      return true;
    case "person":
      return !input.isViewer;
    case "unnamed":
      return (
        input.signer !== undefined && input.viewer !== undefined && input.signer !== input.viewer
      );
  }
}

/** The crew's door in a Mate's own menu, and whether it sets a crew up. */
export interface MateCrewItem {
  readonly label: string;
  /** *Set up a crew*: the Crew tab opens with its setup sheet. */
  readonly setUp: boolean;
}

/**
 * The crew's door in a Mate's own menu (the owner, 2026-09-29: "allow setting
 * up crew from more menu in the left col"): *Set up a crew* where the Mate has
 * none, *Crew* where it has one, each opening its conversation on the Crew
 * tab. Only where crew mode is on — its feed says `none` or `applied`, as the
 * tab's own availability reads it — and only on the viewer's own Mate: a
 * crew's turns run only as the person who signed its agent in (D6), so a
 * colleague's Mate, and one whose owner is not named yet, offer none. Where
 * its agent is signed in by somebody else, the viewer's own Mate still opens
 * its crew to read, and offers no setup (`crewAccess`).
 */
export function mateCrewItem(input: {
  readonly status: CrewStatus | null;
  readonly owner: { readonly isViewer: boolean } | undefined;
  /** The viewer may run the login a new crew runs on; absent, they may. */
  readonly mayChange?: boolean;
}): MateCrewItem | null {
  if (input.owner?.isViewer !== true) return null;
  switch (input.status) {
    case "none":
      return input.mayChange === false ? null : { label: CREW_SET_UP_WORD, setUp: true };
    case "applied":
      return { label: "Crew", setUp: false };
    case "off":
    case null:
      return null;
  }
}

/**
 * The one colour a change row's pull-request mark may wear (S3): amber where
 * it has fallen behind `main` and no longer merges — it didn't go through.
 * Everything else is the mark's own grey: still working the answer out, or
 * nothing wrong. The verdict itself lives in the review, not on the row.
 */
export function changeMarkTone(
  pull: Pick<FlowPullRequest, "number" | "mergeability">,
): "attention" | undefined {
  return pullRequestBlocked(pull)?.kind === "behind" ? "attention" : undefined;
}

/**
 * The dot before the age in words: amber where the Mate needs you, blue where it finished
 * something you have not seen, red where it stopped on an error (S3). The row draws it, never the
 * word; a screen reader and the closed menu's card say it.
 */
export const mateDotLabel = (tone: "attention" | "unread" | "failed"): string =>
  tone === "unread"
    ? "Unseen reply"
    : tone === "failed"
      ? "Stopped on an error"
      : "Waiting for you";

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
      readonly lastKnown?: true;
      readonly text: string;
      /** Muted at rest, the second ink unread, full ink as a question, red as an error. */
      readonly tone: "muted" | "ink-2" | "ink" | "failed" | "attention";
    }
  | { readonly kind: "live"; readonly words: string }
  | { readonly kind: "pending" }
  /**
   * The line told as holding words still to come, drawn at rest: its place kept, so a socket
   * opening grows no row, and nothing in it — words on their way are only true now.
   */
  | { readonly kind: "held" }
  | undefined;

export interface MateRowView {
  readonly state: MateRowState;
  /** The face it wears: the one mapping's, but still where it stands stopped on an error. */
  readonly face: MateMarkState;
  readonly slot: MateRowSlot;
  /** The dot before the age: amber needs you, blue unread, red broken (S3). */
  readonly dot: "attention" | "unread" | "failed" | undefined;
  /**
   * Its latest result — finished or failed — not seen (`mateUnread`): the unread dot hangs by its
   * time. Never while it works, waits on its person or sleeps at a limit: the face says that.
   */
  readonly unseen: boolean;
  /** A result not seen: the name at 600. */
  readonly strongName: boolean;
  /** The second line: the person's last ask, whatever step the Mate is on. */
  readonly ask: string | undefined;
  readonly reply: MateRowReply;
  /** Still coming up, or never came (`mateComing`): its one line says so, in its place. */
  readonly coming?: MateComing;
}

/**
 * What a Mate's row says, from what its conversation says (`activity`, the
 * one resolver's reading, R5) and the face it wears (`mateFaceFor`):
 *
 * | state               | face                     | right of the name    | third line              |
 * | ------------------- | ------------------------ | -------------------- | ----------------------- |
 * | idle, seen          | still                    | age                  | its last words, muted   |
 * | working             | turns, glances           | the run's clock      | its live step, or dots  |
 * | needs you           | hops, waits with the "o" | age                  | the question, in ink    |
 * | finished, not seen  | pops, smiles             | blue dot + age       | its last words, 2nd ink |
 * | stopped on an error | still                    | age, blue dot unseen | the error's line, red   |
 *
 * `dot` is its state's tone where a face alone stands for the Mate — the rail, a card, a
 * screen reader: amber needs you, blue unread, red stopped. The row draws only the blue one
 * (`unseen`); its face carries the rest.
 *
 * The second line is always the person's last ask. A row with no answer is
 * simply shorter; while words are coming — a run on, or a message sent and
 * its run not started — the third line keeps its place with the dots.
 */
export function mateRowView(
  activity: ZeropsAgentActivity | undefined,
  face: MateMarkState,
  name = "The Mate",
  offlineSince?: string,
  timestampFormat?: TimestampFormat,
): MateRowView {
  if (activity === undefined) {
    const needs = face === "needs";
    return {
      state: needs ? "needs" : "idle",
      face,
      slot: { kind: "none" },
      dot: needs ? "attention" : undefined,
      unseen: false,
      strongName: false,
      ask: undefined,
      reply: undefined,
    };
  }
  const ask = activity.task ?? activity.subject;
  const words = activity.snippet;
  // Words still to come are only true now: from memory the line keeps its place, empty.
  const said = (tone: "muted" | "ink-2" | "ink" | "failed"): MateRowReply =>
    words === undefined
      ? activity.awaitingWords === true
        ? activity.remembered === true
          ? { kind: "held" }
          : { kind: "pending" }
        : undefined
      : { kind: "words", text: words, tone };
  // A question waiting on somebody else — another's Mate asks its owner — is still its last
  // words: said at rest, in the state's ink, with no amber.
  const asked = (tone: "muted" | "ink-2"): MateRowReply =>
    activity.question === undefined ? said(tone) : { kind: "words", text: activity.question, tone };
  const age: MateRowSlot = ask === undefined ? { kind: "none" } : { kind: "age" };
  const state = mateRowState(activity, face);
  const unseen = activity.unread && (state === "unread" || state === "failed");
  const view = (reply: MateRowReply, slot: MateRowSlot = age) => ({
    state,
    face: state === "failed" && face === "needs" ? ("idle" as const) : face,
    slot,
    dot:
      state === "needs" ||
      state === "paused" ||
      (state === "failed" && mateStatus(activity)?.severity === "attention")
        ? ("attention" as const)
        : state === "unread"
          ? ("unread" as const)
          : state === "failed"
            ? ("failed" as const)
            : undefined,
    unseen,
    strongName: unseen,
    ask,
    reply: ask === undefined ? undefined : reply,
  });
  const held = lastKnownMateWords(activity, name, timestampFormat);
  if (activity.remembered === true && held !== undefined)
    return {
      ...view(undefined),
      reply: {
        kind: "words",
        text:
          offlineSince === undefined
            ? held
            : `${mateUnreachableWords(name, offlineSince, timestampFormat)} ${held}`,
        tone: "muted",
        lastKnown: true,
      },
    };
  // A new Mate's first run is the stand-up its person's sign-in sent: while it works, and where
  // it stops, the row says so in the person's words — never the command sent on their behalf.
  // Waiting on them, or done, it is any Mate's row.
  if (activity.standUp === true || ask === MATE_STAND_UP_MESSAGE) {
    if (state === "working") {
      return {
        ...view(SETTING_UP_DEVELOPMENT, { kind: "clock", since: activity.runSince ?? activity.at }),
        ask: undefined,
        reply: SETTING_UP_DEVELOPMENT,
      };
    }
    if (state === "failed") {
      return {
        ...view(SETTING_UP_STOPPED_REPLY, { kind: "age" }),
        ask: undefined,
        reply: SETTING_UP_STOPPED_REPLY,
      };
    }
  }
  switch (state) {
    case "working":
      // A person's Stop in force: that it is stopping, from the press on, never what still runs
      // (S21-02: "Finishing work it started" read on after the Stop).
      if (activity.stopping === true) {
        return view({ kind: "live", words: STOPPING_WORDS });
      }
      // Its turn over, its work running on: what that work is, where its row names it (Eli,
      // 2026-10-14: "Waiting for its helpers" over its own jobs); else its card's own words. Its
      // clock stopped with its turn.
      if (activity.waitsOnHelpers === true) {
        return view({
          kind: "live",
          words:
            activity.backgroundWork === undefined
              ? nowLineWords({ kind: "after" })
              : backgroundWorkWords(activity.backgroundWork),
        });
      }
      return view(
        activity.liveStep === undefined
          ? { kind: "pending" }
          : { kind: "live", words: activity.liveStep.words },
        { kind: "clock", since: activity.runSince ?? activity.at },
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
          : {
              kind: "words",
              text: mateFailureWords(activity.errorLine, undefined, name),
              tone: "failed",
            },
      );
    case "unread":
      return view(asked("ink-2"));
    case "paused": {
      const text =
        activity.limitProvider !== undefined || activity.errorLine === undefined
          ? undefined
          : mateFailureWords(activity.errorLine, undefined, name);
      return view(
        {
          kind: "words",
          text: text ?? usageLimitWords(activity.limitProvider ?? "coding agent", undefined, name),
          tone: "muted",
        },
        activity.pausedUntil === undefined
          ? undefined
          : { kind: "paused", until: activity.pausedUntil },
      );
    }
    case "idle":
      return view(asked("muted"));
  }
}

/**
 * A Mate on its way off Zerops (`mateDeleting`): its row says *Deleting…* in
 * place of its last line — its words, else what was asked, else the sign-in
 * line — so it keeps its height, and nothing on it waits on anybody: asleep,
 * no time, no dot, its name at rest. What was asked stays above the line
 * where there was a line under it.
 */
export function mateDeletingView(view: MateRowView): MateRowView {
  return {
    ...view,
    face: matePose(view.face, { life: "deleting" }),
    slot: { kind: "none" },
    dot: undefined,
    unseen: false,
    strongName: false,
    ask: view.reply === undefined ? undefined : view.ask,
    reply: undefined,
  };
}

/**
 * A Mate whose setup is being finished (`finishSetupRowLine`): its row says so in place of its
 * last line — its words, else what was asked, else the sign-in line — so it keeps its height. The
 * Mate is going nowhere: its face, its time and its name stay as they were.
 */
export function mateFinishingView(view: MateRowView): MateRowView {
  return { ...view, ask: view.reply === undefined ? undefined : view.ask, reply: undefined };
}

/** A Mate's row's one line while its update restarts it (`mateRowReading`). */
export const MATE_UPDATING_LINE = "Updating to the new version";

/**
 * A row's one reading of its Mate: the face and the words both from the activity it draws, so
 * the two never disagree (the owner, 2026-09-29: a new Mate at work read "Working on a reply"
 * under an asleep face — the words were this browser's memory of the row, drawn the moment its
 * candidate was not connected, and the face that moment's socket).
 *
 * | the activity drawn                                  | face                      | a line of words to come |
 * | --------------------------------------------------- | ------------------------- | ----------------------- |
 * | live (HQ holds it live, or its socket up, blinking) | the conversation's own    | the dots                |
 * | at rest (`restingActivity`)                         | asleep, idle if connected | held, empty             |
 * | none                                                | asleep, idle if connected | —                       |
 *
 * Its own change waiting on the person's review lifts every face but work's to needs-you
 * (`mateFaceAwaitingReview`), as the composer's top wears it for the same fact — on the viewer's
 * own Mate only: another's waits on its owner, and rests here.
 *
 * A live reading stands while the socket blinks — reconnecting, a listing re-read — because the
 * conversation it was read from still stands; a word at rest is only ever at rest.
 */
export function mateRowReading(input: {
  readonly name?: string;
  /** Its container is connected right now. */
  readonly connected: boolean;
  readonly offlineSince?: string | undefined;
  /** Now, for how long it has been away (`useMateAwayNow`); absent, it is said at once. */
  readonly nowMs?: number | undefined;
  readonly timestampFormat?: TimestampFormat | undefined;
  readonly activity: ZeropsAgentActivity | undefined;
  /** Its own change waits on the person's review (`mateNextStep`): it needs them. */
  readonly reviewWaits?: boolean;
  /** The viewer's own Mate (HQ's `waitsOnViewer`): only then does what it waits on need them. */
  readonly mine: boolean;
  /** Where it is in its life (`mateFaceFor`): waking while it comes up and arrives. */
  readonly pose?: MatePoseFacts | undefined;
  /** Its update is restarting it, as its link says (`mateUpdating`). */
  readonly updating?: boolean | undefined;
  /**
   * An automated Mate free for its next task (`mateAutomation`): its face rests (`restingWhenFree`)
   * while its state — a dot, a result unseen — stays what its conversation says.
   */
  readonly free?: boolean | undefined;
}): MateRowView {
  const read = mateRowReadingOf(input);
  return input.free === true ? { ...read, face: restingWhenFree(read.face) } : read;
}

function mateRowReadingOf(input: Parameters<typeof mateRowReading>[0]): MateRowView {
  // Its update restarting it: its row says so, from the moment its link says it until it answers
  // again — never its last words held as if nothing happened, nor that it isn't answering.
  if (input.updating === true) {
    const activity = withoutLastKnown(input.activity);
    return {
      ...mateRowView(
        activity,
        mateFaceOf({
          connected: input.connected,
          activity,
          reviewWaits: input.reviewWaits === true,
          mine: input.mine,
          pose: input.pose,
        }),
        input.name,
        undefined,
        input.timestampFormat,
      ),
      reply: { kind: "words", text: MATE_UPDATING_LINE, tone: "muted" },
    };
  }
  // Away for less than its grace — a blink, a restart nobody announced — its row says no outage
  // yet: its last words, at rest, without "isn't answering" or what was last known.
  const settling =
    input.offlineSince !== undefined && mateAwaySettling(input.offlineSince, input.nowMs);
  const activity = settling ? withoutLastKnown(input.activity) : input.activity;
  return mateRowView(
    activity,
    mateFaceOf({
      connected: input.connected,
      activity,
      reviewWaits: input.reviewWaits === true,
      mine: input.mine,
      pose: input.pose,
    }),
    input.name,
    settling ? undefined : input.offlineSince,
    input.timestampFormat,
  );
}

function withoutLastKnown(
  activity: ZeropsAgentActivity | undefined,
): ZeropsAgentActivity | undefined {
  if (activity?.lastKnown === undefined) return activity;
  const { lastKnown: _lastKnown, ...rest } = activity;
  return rest;
}

/**
 * The person's words — the last they sent, or the next waiting unsent in its composer — or why
 * none stand there. A row says them on its one line only where its Mate has no words of its own
 * yet (`mateRowSecond`): otherwise the line is the Mate's answer.
 */
export type MateRowAskLine =
  /** Led by whose words they are (`mateAsker`): nobody's while HQ has not named its owner. */
  | { readonly kind: "ask"; readonly text: string; readonly by?: string | undefined }
  /** Unsent, led by *Draft*: the ask it stands over is kept under it, so clearing it is still. */
  | { readonly kind: "draft"; readonly text: string; readonly ask: string | undefined }
  | { readonly kind: "sign-in"; readonly text: string; readonly waitsOnViewer: boolean }
  /** Its conversation read, and nobody has asked it anything: the fact, quietly. */
  | { readonly kind: "nothing-asked" }
  | undefined;

/**
 * What a row's second line says (the owner, 2026-09-30: an empty conversation "not showing draft
 * and has weird position of the name without the questions and response under it"):
 *
 * | the row                                | its second line                              |
 * | -------------------------------------- | -------------------------------------------- |
 * | coming up                              | — its born line says it                      |
 * | deleting                               | the ask, where there was one; no draft       |
 * | nobody signed in                       | the sign-in, whatever is typed               |
 * | a draft typed                          | *Draft* and its words, over the ask if any   |
 * | just sent, its conversation behind     | what was sent, as You                        |
 * | asked                                  | the ask, as its person's (`mateAsker`)       |
 * | never asked, its conversations read    | "Nothing asked yet"                          |
 * | never asked, not read, or a step below | nothing                                      |
 *
 * A draft never takes the line from the Mate: the question it waits on, its error and its live
 * step keep it, and the draft says itself where the Mate is at rest. Nothing asked is said only
 * once its conversations are read — before that it is a socket still opening, and a reload paints
 * nothing it takes back. The row keeps its two lines' height whatever this says, so nothing moves
 * when the first message lands.
 */
export function mateRowAskLine(input: {
  readonly view: {
    readonly ask: string | undefined;
    readonly reply: MateRowReply;
    readonly coming?: MateComing | undefined;
  };
  readonly signIn: { readonly text: string; readonly waitsOnViewer: boolean } | undefined;
  /** Its unsent message (`mateRowDraft`). */
  readonly draft: string | undefined;
  /** What this browser just sent it, its conversation not caught up yet (`mateRowSentAsk`). */
  readonly sent: string | undefined;
  readonly deleting: boolean;
  /** *Finish setup* runs on it (`finishSetupRowLine`): its last line says so, as deleting's does. */
  readonly finishing: boolean;
  /** Its conversations are read: none there is a fact, not a socket still opening. */
  readonly read: boolean;
  /** Who asks it, as the row names them (`mateAsker`). */
  readonly asker: string | undefined;
}): MateRowAskLine {
  const { view } = input;
  if (view.coming !== undefined) return undefined;
  if (input.deleting || input.finishing) {
    return view.ask === undefined ? undefined : { kind: "ask", text: view.ask, by: input.asker };
  }
  if (input.signIn !== undefined) return { kind: "sign-in", ...input.signIn };
  // The person's words as the row quotes every message: plain words (Milo's stress run 6 kept a
  // just-sent message's raw backticks in the row).
  const draft = input.draft === undefined ? null : messagePreviewText(input.draft);
  if (draft !== null) return { kind: "draft", text: draft, ask: view.ask };
  const sent = input.sent === undefined ? null : messagePreviewText(input.sent);
  // This browser sent it: the viewer's words, whoever HQ says owns the Mate.
  if (sent !== null) return { kind: "ask", text: sent, by: YOU };
  if (view.ask !== undefined) return { kind: "ask", text: view.ask, by: input.asker };
  return view.reply === undefined && input.read ? { kind: "nothing-asked" } : undefined;
}

const YOU = "You";

/**
 * Who a row says asked its Mate (the owner, 2026-10-11, of a row reading "continue" over its
 * answer: the person's words with nobody's name on them read like a label). Only its owner talks
 * to a Mate (D5), so it is them: *You* on the viewer's own, a colleague's first name on theirs —
 * the messenger's "You:" before a message of yours — and nobody while HQ has not named its owner.
 */
export function mateAsker(
  owner: { readonly name: string; readonly isViewer: boolean } | undefined,
): string | undefined {
  if (owner === undefined) return undefined;
  if (owner.isViewer) return YOU;
  const first = owner.name.trim().split(/\s+/u)[0];
  return first === undefined || first.length === 0 ? undefined : first;
}

/** What `mateRowDraft` reads of the composer's store (`composerDraftStore.ts`). */
export interface MateDraftSource {
  readonly draftsByThreadKey: Readonly<Record<string, { readonly prompt: string } | undefined>>;
  readonly draftThreadsByThreadKey: Readonly<
    Record<
      string,
      {
        readonly environmentId: string;
        readonly threadId: string;
        readonly createdAt: string;
        readonly promotedTo?: unknown;
      }
    >
  >;
}

/**
 * A Mate's unsent message, where its composer keeps it: under its conversation's key, or under
 * the draft its conversation was made from; with no conversation yet, the newest new one's in its
 * environment not sent yet. Its words trimmed; nothing where only blanks are typed. Read from
 * this browser alone: a socket down or reconnecting, a Mate stopped, still shows its draft —
 * a reload paints it with the row, never after.
 */
export function mateRowDraft(
  source: MateDraftSource,
  mate: {
    readonly environmentId?: string | undefined;
    readonly threadId?: string | undefined;
    readonly threadKey?: string | undefined;
  },
): string | undefined {
  const words = (key: string) => {
    const prompt = source.draftsByThreadKey[key]?.prompt.trim() ?? "";
    return prompt.length > 0 ? prompt : undefined;
  };
  // What this browser holds, socket or none: its conversation's key — remembered while its socket
  // is down — names its environment too.
  const own = mate.threadKey === undefined ? undefined : words(mate.threadKey);
  if (own !== undefined) return own;
  const environmentId =
    mate.environmentId ??
    (mate.threadKey === undefined
      ? undefined
      : parseScopedThreadKey(mate.threadKey)?.environmentId);
  if (environmentId === undefined) return undefined;
  let newest: { readonly at: string; readonly text: string } | undefined;
  for (const [key, session] of Object.entries(source.draftThreadsByThreadKey)) {
    if (session.environmentId !== environmentId) continue;
    const mine =
      mate.threadId === undefined
        ? session.promotedTo === undefined || session.promotedTo === null
        : session.threadId === mate.threadId;
    const text = mine ? words(key) : undefined;
    if (text !== undefined && (newest === undefined || session.createdAt > newest.at)) {
      newest = { at: session.createdAt, text };
    }
  }
  return newest?.text;
}

/** A new Mate's first run working: what it is doing, in the person's words. */
const SETTING_UP_DEVELOPMENT = {
  kind: "live",
  words: "Setting up development",
} as const satisfies MateRowReply;

/** Setting a new Mate up stopped — a step of its birth, or its first run. */
const SETTING_UP_STOPPED = "Setting up stopped";
const SETTING_UP_STOPPED_REPLY = {
  kind: "words",
  text: SETTING_UP_STOPPED,
  tone: "attention",
} as const satisfies MateRowReply;

/** A Mate being born, as its row's one line says it (`mateBornLine`). */
export interface MateBornLine {
  readonly words: string;
  /** When its clock started, wall ms: the line counts up from it. None where nothing is held. */
  readonly since: number | undefined;
  readonly tone: "muted" | "attention";
}

/**
 * A Mate being born, in its row's one line (board D1, 2026-09-30): "Coming up" on a clock that
 * counts from the press, and any step that stopped the one fact, in red. Where this browser made
 * no press for it there is no clock to count, and the words stand alone. Why it stopped, and what
 * to do, is its own view's to say.
 */
export function mateBornLine(coming: MateComing): MateBornLine {
  if (coming.kind === "failed") {
    return coming.verb === "redeploy"
      ? { words: coming.line, since: undefined, tone: "attention" }
      : BORN_STOPPED;
  }
  return { words: BORN_WORDS, since: coming.since, tone: "muted" };
}

const BORN_STOPPED: MateBornLine = {
  words: SETTING_UP_STOPPED,
  since: undefined,
  tone: "attention",
};

/** On its way: the clock beside it says for how long. */
const BORN_WORDS = "Coming up";

/** The line as it reads at `nowMs`: its words, then its clock — "Coming up · 0:42". */
export function mateBornLineText(line: MateBornLine, nowMs: number): string {
  return line.since === undefined
    ? line.words
    : `${line.words} · ${formatWorkingTime(nowMs - line.since)}`;
}

/**
 * A creation the listing does not hold yet (`ZeropsGroupPendingMember`), in its row's one line as
 * a listed Mate coming up says it: on its way since the platform took it — a New project's since
 * its press — or stopped.
 */
export function pendingBornLine(
  member: Pick<ZeropsGroupPendingMember, "startedAt" | "failed">,
): MateBornLine {
  if (member.failed === true) return BORN_STOPPED;
  return { words: BORN_WORDS, since: member.startedAt, tone: "muted" };
}

/**
 * Whether a row offers its ⋯ menu: not while its Mate is going, nor while it is still being made —
 * nothing on it is about a Mate on its way — but once its setup stopped, for what finishes or
 * removes it (*Finish setup*, *Delete*).
 */
export function mateRowOffersMenu(input: {
  readonly deleting: boolean;
  readonly coming: MateComing | undefined;
}): boolean {
  return !input.deleting && (input.coming === undefined || input.coming.kind === "failed");
}

/**
 * A Mate still coming up, or one that never came (`mateComing`), in its row: its face waking
 * (`matePose`), in the colours its person picked, its one line where it has got
 * (`mateBornLine`), and none of what only a Mate that is up has: no time, no ask, no words.
 * One that did not come sleeps, with the red dot of something broken (S3).
 */
export function mateComingRowView(view: MateRowView, coming: MateComing): MateRowView {
  return {
    ...view,
    state: coming.kind === "failed" ? "needs" : "idle",
    face: matePose(view.face, { life: mateLifeOf(coming) }),
    slot: { kind: "none" },
    dot: coming.kind === "failed" ? "attention" : undefined,
    strongName: false,
    ask: undefined,
    reply: undefined,
    coming,
  };
}

/** Where a listed Mate is in its life, from its coming up (`mateComing`). */
export function mateLifeOf(coming: MateComing | undefined): MateLife {
  if (coming === undefined) return "up";
  return coming.kind === "failed" ? "failed" : "coming";
}

/** Which of the table's states a row is in: what waits on the person first. */
function mateRowState(activity: ZeropsAgentActivity, face: MateMarkState): MateRowState {
  // Paused at a usage limit it sleeps, whatever its last turn said: a turn
  // that hits the limit ends failed — "Claude usage limit reached…" — with
  // the pause standing, and the resume picks the work up without anybody
  // (`mateMarkStateForThread`). What waits on a person still wakes it: its
  // face is not asleep then.
  if (face === "sleep" && (activity.usageLimited === true || activity.pausedUntil !== undefined))
    return "paused";
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

/**
 * The one line under a Mate's name (round 5): what needs the viewer — and a result not seen — in ink, a failure of the
 * viewer's own Mate in the fail colour, everything else muted — never a status word, the face
 * carries the state.
 *
 * | the row                                  | its line                                   |
 * | ---------------------------------------- | ------------------------------------------ |
 * | coming up, deleting, finishing, outside  | that, in its own words                     |
 * | working                                  | its step, or what it is on and the dots    |
 * | what HQ last said of it, unreachable     | that                                       |
 * | a colleague's, waiting on its person     | "Waits on Alex"                           |
 * | a question or a plan for the viewer      | the question, in ink                       |
 * | stopped on an error                      | the error: red if the viewer's, else muted |
 * | at its limit                             | "Paused until 1:00 PM"                     |
 * | its change waits on the viewer           | the change mark and its title, in ink      |
 * | nobody signed in                         | the sign-in                                |
 * | an unsent draft                          | *Draft* and its words                      |
 * | a colleague's open change                | "<title> · in review", muted               |
 * | finished, its result unseen               | its last words, in ink                     |
 * | otherwise                                | its last words, muted; else what was asked |
 */
export type MateRowSecond =
  | { readonly kind: "coming" }
  | { readonly kind: "deleting" }
  | { readonly kind: "finishing" }
  | { readonly kind: "outside" }
  | { readonly kind: "sign-in" }
  /**
   * The Mate's own line (`MateRowReply`), its words in `tone` where it says one — after the task
   * an automated Mate is on, while it works on it (`task`: "#12 Fix the checkout total").
   */
  | {
      readonly kind: "reply";
      readonly tone: "muted" | "ink" | "failed" | undefined;
      readonly task?: string;
    }
  | { readonly kind: "waits-on"; readonly text: string }
  | { readonly kind: "paused"; readonly until: string }
  /** Its open change by its title; `count` where several wait (`changeLineWords`). */
  | {
      readonly kind: "change";
      readonly title: string;
      readonly mine: boolean;
      readonly count?: number;
    }
  /**
   * An automated Mate's line where it says nothing of its own (`mateAutomatedLine`): the task it is
   * on, its change waiting for review, or what it waits for; in ink where `on`.
   */
  | { readonly kind: "task"; readonly text: string; readonly on: boolean }
  /**
   * The person's line (`MateRowAskLine`) where the Mate has no words of its own yet: a draft, what
   * was asked — while its words are on their way, `pending` — or that nothing was.
   */
  | { readonly kind: "ask"; readonly pending: boolean }
  | { readonly kind: "none" };

/**
 * Whether a row holds its one line under its name empty while a reload reads its Mate's
 * conversations: where nothing is known yet, so what is read lands in the line held for it and the
 * rows under it never move (they moved 12 px at 0.5–0.75 s). Once read, nothing is held: a Mate
 * never asked says so on its line. A row says its Mate's answer alone, never what was asked over
 * it (the owner, 2026-10-12: "rethinking showing both question and answer and just go with
 * answer").
 */
export function mateRowHeldLines(input: {
  readonly second: MateRowSecond;
  /** Its conversations are read. */
  readonly read: boolean;
}): 0 | 1 {
  return !input.read && input.second.kind === "none" ? 1 : 0;
}

/** What an automated Mate's line calls the task it is on (`HqNavigationMateTask`). */
export function mateTaskLine(task: {
  readonly number?: number | undefined;
  readonly title: string;
}): string {
  return task.number === undefined ? task.title : `#${String(task.number)} ${task.title}`;
}

/** A task's state after its title, in the words every surface says it in (`taskStatus`). */
const statusWords = (status: TaskStatus): string => TASK_STATUS_WORDS[status].toLowerCase();

const NO_TASKS_YET = "No tasks yet";
const WAITING_FOR_A_KEY = "Waiting for an API key";

/** Why HQ stopped a task, after "stopped:" (`HqNavigationMateTask.why`). */
const STOPPED_WHY: Readonly<Record<NonNullable<MateLastTask["why"]>, string>> = {
  budget: "budget spent",
  unanswered: "no answer",
};

/** An automated Mate's most recent task, once it ended (`HqNavigationMateTask.ended`). */
export interface MateLastTask {
  readonly number?: number | undefined;
  readonly title: string;
  readonly ended: "merged" | "closed" | "done" | "failed" | "stopped";
  readonly endedAt?: string | undefined;
  readonly why?: "budget" | "unanswered" | undefined;
}

/**
 * A free automated Mate's line: its last task and how it ended — "#4 Prices per 100 g · merged",
 * "… · stopped: budget spent". When it ended stands in the row's time slot (`mateRowTime`).
 */
export function lastTaskLine(last: MateLastTask): string {
  const ended = statusWords(last.ended);
  const how = last.why === undefined ? ended : `${ended}: ${STOPPED_WHY[last.why]}`;
  return `${mateTaskLine(last)} · ${how}`;
}

/**
 * When a row dates its Mate, in its time slot: a free automated Mate (`task` null), when its last
 * task ended — none where it never had one; at work, paused, or any other Mate, its own slot and
 * its last word's time.
 */
export function mateRowTime(input: {
  readonly slot: MateRowSlot;
  readonly at: string | undefined;
  readonly automated: MateAutomationLine | undefined;
}): { readonly slot: MateRowSlot; readonly at: string | undefined } {
  const { slot, at, automated } = input;
  if (automated?.task !== null || slot.kind === "clock" || slot.kind === "paused")
    return { slot, at };
  if (automated.last === undefined) return { slot: { kind: "none" }, at: undefined };
  if (automated.last.endedAt === undefined) return { slot, at };
  return { slot: { kind: "age" }, at: automated.last.endedAt };
}

/** The pull request a task's change is mirrored to, as a line names it (`HqPullRequest`). */
export interface MateTaskPullRequest {
  readonly number: number;
  readonly state: "open" | "merged" | "closed";
  readonly checks?: "pending" | "passing" | "failing" | undefined;
}

/**
 * What a line says of a task's pull request after its title: at work, that it is open; at rest,
 * that it waits for review — or that its checks fail, which is its Mate's to fix — merged, or
 * closed. `null` where it has none.
 */
export function pullRequestWords(
  pullRequest: MateTaskPullRequest | undefined,
  working: boolean,
): string | null {
  if (pullRequest === undefined) return null;
  const pr = pullRequestName(pullRequest);
  if (pullRequest.state === "merged") return `${pr} merged`;
  if (pullRequest.state === "closed") return `${pr} closed`;
  if (working) return `${pr} open`;
  return pullRequest.checks === "failing"
    ? `${pr} checks failing`
    : `${pr} ${statusWords("review")}`;
}

/** An automated Mate's input to `mateRowSecond` (`mateAutomation`). */
export interface MateAutomationLine {
  /**
   * The task it is on; `number` only for a GitHub issue's ("#12 …"); `waiting` while it waits for
   * a person's answer (HQ's `task.waiting`); `pullRequest` once its change is one on GitHub.
   */
  readonly task: {
    readonly number?: number | undefined;
    readonly title: string;
    readonly waiting?: true | undefined;
    /** HQ took a person's stop of it; its Mate has not stopped yet. */
    readonly stopping?: true | undefined;
    /** Its Mate finished it; its change waits for review. */
    readonly done?: true | undefined;
    readonly pullRequest?: MateTaskPullRequest | undefined;
  } | null;
  /** Free (`task` null), the task it had last, once it ended; absent: it never had one. */
  readonly last?: MateLastTask | undefined;
  /**
   * Whether its organization holds the API key it runs on (`automatedKeyState`): HQ hands no task
   * while it holds none. Absent, or not read: nothing is said of it.
   */
  readonly key?: AutomatedKeyState | undefined;
  /**
   * How many of its changes wait for review (`mateReviewCount`), where two or more do: each task
   * delivers to a change of its own. Absent: one at most.
   */
  readonly inReview?: number | undefined;
}

/**
 * "2 changes in review": a Mate's open changes waiting at once — an automated Mate's, one per task
 * — where one says its title.
 */
export function changesInReview(count: number): string {
  return `${String(count)} changes in review`;
}

/**
 * The line of a Mate's open change: its title — after it "· in review" where the review is not
 * the viewer's — or, where several wait, how many.
 */
export function changeLineWords(
  change: Extract<MateRowSecond, { readonly kind: "change" }>,
): string {
  if ((change.count ?? 1) > 1) return changesInReview(change.count ?? 1);
  return change.mine ? change.title : `${change.title} · in review`;
}

/**
 * An automated Mate's line where it says nothing of its own: at work, the task it is on; at rest
 * on a task it asked a person about, that it waits for them — in ink, the question is theirs to
 * answer where the task came from; at rest on a task whose change is open (HQ's row reads it until
 * the change is merged or closed, while the Mate takes other tasks), that task waiting for review —
 * or, where several of its changes wait, how many; free, that it waits for the organization's API
 * key where it holds none, else its last task and how it ended (`lastTaskLine`), else that it never
 * had one. A task whose change is a pull request on
 * GitHub names the pull request (`pullRequestWords`): failing checks in ink, since they are its
 * Mate's to fix.
 */
export function mateAutomatedLine(
  automated: MateAutomationLine,
  state: MateRowState,
  /**
   * A row's: at work on a task it says so after the task — "#12 Fix the checkout total · working"
   * — the time it has worked standing in the row's clock.
   */
  options: { readonly saysWorking?: boolean } = {},
): Extract<MateRowSecond, { kind: "task" }> {
  const { task } = automated;
  if (task === null) {
    const inReview = automated.inReview ?? 0;
    const text =
      inReview > 1
        ? changesInReview(inReview)
        : automated.key === "missing"
          ? WAITING_FOR_A_KEY
          : automated.last === undefined
            ? NO_TASKS_YET
            : lastTaskLine(automated.last);
    return { kind: "task", text, on: false };
  }
  const working = state === "working";
  // A task its Mate finished says its pull request at rest, whatever the Mate does meanwhile.
  const pullRequest = pullRequestWords(task.pullRequest, working && task.done !== true);
  const line = (words: string | null) =>
    words === null ? mateTaskLine(task) : `${mateTaskLine(task)} · ${words}`;
  if (task.stopping === true)
    return { kind: "task", text: line(statusWords("stopping")), on: false };
  const review = state === "needs" || state === "unread";
  // Several of its changes wait for review, one per task: how many, at rest.
  const inReview = automated.inReview ?? 0;
  if (inReview > 1 && task.waiting !== true && !(working && task.done !== true))
    return { kind: "task", text: changesInReview(inReview), on: review };
  // HQ says its Mate finished it: its change waits for review, whatever the Mate does meanwhile.
  if (task.done === true && task.pullRequest === undefined)
    return { kind: "task", text: line(statusWords("review")), on: review };
  if (working && task.done !== true) {
    const words =
      options.saysWorking === true ? [statusWords("working"), pullRequest] : [pullRequest];
    const said = words.filter((word) => word !== null).join(" · ");
    return { kind: "task", text: line(said === "" ? null : said), on: true };
  }
  if (task.waiting === true) return { kind: "task", text: line(statusWords("waiting")), on: true };
  if (task.pullRequest === undefined)
    return { kind: "task", text: line(statusWords("review")), on: review };
  return {
    kind: "task",
    text: line(pullRequest),
    on: task.pullRequest.state === "open" && (review || task.pullRequest.checks === "failing"),
  };
}

/** Where an application's Mates are listed: how many tasks wait for one of them; none at 0. */
export function tasksWaitingWords(waiting: number): string | undefined {
  if (waiting <= 0) return undefined;
  return waiting === 1 ? "1 task waiting" : `${String(waiting)} tasks waiting`;
}

/**
 * Whether a Mate is automated, and the task it is on, as its HQ record says them
 * (`HqMate.automated`, `HqMate.task`): what `mateRowSecond` reads. Absent for an ordinary Mate.
 */
export function mateAutomation(
  mate:
    | {
        readonly automated?: boolean | undefined;
        readonly task?:
          | {
              readonly number?: number | undefined;
              readonly title: string;
              readonly waiting?: true | undefined;
              readonly stopping?: true | undefined;
              readonly done?: true | undefined;
              readonly pullRequest?: MateTaskPullRequest | undefined;
              readonly ended?: MateLastTask["ended"] | undefined;
              readonly endedAt?: string | undefined;
              readonly why?: MateLastTask["why"] | undefined;
            }
          | null
          | undefined;
      }
    | null
    | undefined,
  /** What is read of the organization's key (`useAutomatedKey`). */
  key?: AutomatedKeyState,
  /** How many of its changes wait for review (`mateReviewCount`). */
  inReview?: number,
): MateAutomationLine | undefined {
  if (mate?.automated !== true) return undefined;
  // A task that ended is HQ's record of the Mate's last one: the Mate is free for the next.
  const task = mate.task?.ended === undefined ? (mate.task ?? null) : null;
  const ended = mate.task?.ended === undefined ? undefined : mate.task;
  return {
    task:
      task === null
        ? null
        : {
            ...(task.number === undefined ? {} : { number: task.number }),
            title: task.title,
            ...(task.waiting === true ? { waiting: true } : {}),
            ...(task.stopping === true ? { stopping: true } : {}),
            ...(task.done === true ? { done: true } : {}),
            ...(task.pullRequest === undefined
              ? {}
              : {
                  pullRequest: {
                    number: task.pullRequest.number,
                    state: task.pullRequest.state,
                    ...(task.pullRequest.checks === undefined
                      ? {}
                      : { checks: task.pullRequest.checks }),
                  },
                }),
          },
    ...(ended?.ended === undefined
      ? {}
      : {
          last: {
            ...(ended.number === undefined ? {} : { number: ended.number }),
            title: ended.title,
            ended: ended.ended,
            ...(ended.endedAt === undefined ? {} : { endedAt: ended.endedAt }),
            ...(ended.why === undefined ? {} : { why: ended.why }),
          },
        }),
    ...(key === undefined ? {} : { key }),
    ...(inReview === undefined || inReview < 2 ? {} : { inReview }),
  };
}

export function mateRowSecond(input: {
  readonly view: Pick<MateRowView, "state" | "reply" | "slot" | "coming">;
  readonly askLine: MateRowAskLine;
  readonly deleting: boolean;
  readonly finishing: boolean;
  readonly outsideHq: boolean;
  /** The viewer's own Mate; `false` for a colleague's; `undefined` where nobody can say yet. */
  readonly mine: boolean | undefined;
  /** A colleague's Mate waits on its person: their first name. */
  readonly waitsOn: string | undefined;
  /** It asks something — a question, an approval, a plan — not only that its change waits. */
  readonly asks?: boolean;
  /**
   * Its open change: `mine` where it waits on the viewer's review (`mateReviewWaits`); `count`
   * where several of its changes wait.
   */
  readonly change:
    | { readonly title: string; readonly mine: boolean; readonly count?: number }
    | undefined;
  /**
   * An automated Mate, and the task HQ says it is on: at work, asking, stopped or at its limit it
   * reads as any Mate; where it says nothing of its own, and at rest, its line is the task's
   * (`mateAutomatedLine`) — never its brief's words, which nobody typed, nor a sign-in, which it
   * never takes. Absent: an ordinary Mate.
   */
  readonly automated?: MateAutomationLine | undefined;
}): MateRowSecond {
  const { view, askLine, change, automated } = input;
  // A row says an automated Mate at work works, its clock how long.
  const automatedRowLine = (line: MateAutomationLine, state: MateRowState) =>
    mateAutomatedLine(line, state, { saysWorking: true });
  if (view.coming !== undefined) return { kind: "coming" };
  if (input.deleting) return { kind: "deleting" };
  if (input.finishing) return { kind: "finishing" };
  if (input.outsideHq) return { kind: "outside" };
  const reply = view.reply;
  const asked = automated === undefined && askLine !== undefined && askLine.kind !== "sign-in";
  const said = (tone: "muted" | "ink" | "failed" | undefined): MateRowSecond => {
    const line: MateRowSecond =
      reply === undefined
        ? asked
          ? { kind: "ask", pending: false }
          : { kind: "none" }
        : reply.kind === "pending" && asked
          ? { kind: "ask", pending: true }
          : reply.kind === "pending" && automated !== undefined
            ? { kind: "none" }
            : reply.kind === "live" && automated?.task != null && view.state === "working"
              ? // An automated Mate's step follows the task it is on: its row names the work.
                { kind: "reply", tone: undefined, task: mateTaskLine(automated.task) }
              : { kind: "reply", tone: reply.kind === "words" ? tone : undefined };
    return automated !== undefined && line.kind === "none"
      ? automatedRowLine(automated, view.state)
      : line;
  };
  if (view.state === "working") return said(undefined);
  // A task waiting for a person's answer says so over its Mate's last words: the question is
  // asked where the task came from, and answered there.
  if (automated?.task?.waiting === true && view.state !== "failed" && view.state !== "paused")
    return automatedRowLine(automated, view.state);
  if (reply?.kind === "words" && reply.lastKnown === true)
    return said(reply.tone === "failed" ? "failed" : "muted");
  if (input.waitsOn !== undefined && view.state !== "failed") {
    return { kind: "waits-on", text: `Waits on ${input.waitsOn}` };
  }
  if (
    view.state === "needs" &&
    (input.asks === true || (automated === undefined && input.change?.mine !== true))
  ) {
    return said("ink");
  }
  if (view.state === "failed") {
    const own = reply?.kind === "words" && reply.tone === "failed" && input.mine !== false;
    return said(own ? "failed" : "muted");
  }
  if (view.state === "paused" && view.slot.kind === "paused") {
    return { kind: "paused", until: view.slot.until };
  }
  if (automated !== undefined) return automatedRowLine(automated, view.state);
  const counted = (change?.count ?? 1) > 1 ? { count: change?.count ?? 1 } : {};
  if (change?.mine === true) return { kind: "change", title: change.title, mine: true, ...counted };
  if (askLine?.kind === "sign-in") return { kind: "sign-in" };
  if (askLine?.kind === "draft") return { kind: "ask", pending: false };
  if (change !== undefined) return { kind: "change", title: change.title, mine: false, ...counted };
  // A result the viewer has not seen is for them: in ink, beside the unread dot.
  return said(view.state === "unread" ? "ink" : "muted");
}
