/**
 * What a Mate's row in the left menu draws, read from what the row knows —
 * pure, so each rule has its table.
 */
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import {
  pullRequestBlocked,
  type FlowPullRequest,
  type ZeropsGroupPendingMember,
} from "@t3tools/client-runtime/zerops";
import { CREW_SET_UP_WORD } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewStatus } from "@t3tools/contracts";
import type { MateMarkState } from "@t3tools/shared/brand";

import {
  mateFaceAwaitingReview,
  mateFaceFor,
  type ZeropsAgentActivity,
} from "~/zerops/agentActivity";
import type { MateComing } from "~/zerops/mateComing";
import { MATE_STAND_UP_MESSAGE } from "~/zerops/mateStandUp";

import { formatWorkingTime } from "./SidebarZeropsTree.logic";

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
 * To the person who added it — named by its stand-up's `mate:standup:` tag
 * until their sign-in sends the stand-up — the line says it waits on them:
 * "Waiting for your sign-in", in ink, with the amber dot of what needs them
 * (board D1, 2026-09-30). Anybody else reads the fact, quietly.
 */
export function mateOwnerView(input: {
  readonly owner:
    | { readonly name: string; readonly initials: string; readonly avatarUrl: string | null }
    | undefined;
  /** What its records say (`mateOwnerRecords`). */
  readonly records: { readonly named: boolean; readonly signedIn: boolean };
  /** The row already says what was asked under the name. */
  readonly asked: boolean;
  /** Who added it, as its stand-up tag names them (`readZeropsGroupTags(…).standUp`). */
  readonly standUpBy?: string | undefined;
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
      : records.named
        ? { kind: "unnamed" }
        : { kind: "nobody", label: NOBODY_OWNS };
  if (records.signedIn || input.asked) return { seat, signInLine: undefined, waitsOnViewer: false };
  const yours =
    input.viewer !== undefined && input.viewer.length > 0 && input.standUpBy === input.viewer;
  return {
    seat,
    signInLine: yours ? WAITING_FOR_YOUR_SIGN_IN : NOBODY_SIGNED_IN,
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
 * the member list names, or before the list has named them, the signer tag
 * against the viewer's own id; a Mate that may be the viewer's reads as theirs.
 */
export function mateNotYours(input: {
  readonly seat: OwnerSeat;
  readonly isViewer: boolean;
  /** The user id its signer tag names (`mateOwnerRecords`). */
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
  /**
   * The line remembered as holding words still to come, drawn from memory: its place kept, so a
   * socket opening grows no row, and nothing in it — words on their way are only true now.
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
  /** Finished and not seen: the name at 600. */
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
    const needs = face === "needs";
    return {
      state: needs ? "needs" : "idle",
      face,
      slot: { kind: "none" },
      dot: needs ? "attention" : undefined,
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
  // A new Mate's first run is the stand-up its person's sign-in sent: while it works, and where
  // it stops, the row says so in the person's words — never the command sent on their behalf.
  // Waiting on them, or done, it is any Mate's row.
  if (ask === MATE_STAND_UP_MESSAGE) {
    if (state === "working") {
      return {
        ...view(SETTING_UP_DEVELOPMENT, { kind: "clock", since: activity.at }),
        ask: undefined,
      };
    }
    if (state === "failed") return { ...view(SETTING_UP_STOPPED_REPLY), ask: undefined };
  }
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
    face: "sleep",
    slot: { kind: "none" },
    dot: undefined,
    strongName: false,
    ask: view.reply === undefined ? undefined : view.ask,
    reply: undefined,
  };
}

/** The socket's phases in which a conversation read through it still stands. */
const STANDING_PHASES: ReadonlySet<EnvironmentConnectionPhase> = new Set([
  "connected",
  "reconnecting",
]);

/**
 * Which reading a Mate's row draws: its conversation's while its socket is up or only blinking —
 * reconnecting, when the conversation it was read from still stands — and what this browser
 * remembers of it otherwise (`menuMemory.ts`): a socket not opened yet this page, one that failed,
 * none at all. A Mate at its first job must not fall asleep in the menu because its socket
 * blinked (the owner, 2026-09-29).
 */
export function mateRowActivity(input: {
  /** Its conversation's reading, where this page has one. */
  readonly live: ZeropsAgentActivity | undefined;
  /** Its registered environment's socket, where there is one. */
  readonly phase: EnvironmentConnectionPhase | undefined;
  readonly remembered: ZeropsAgentActivity | undefined;
}): ZeropsAgentActivity | undefined {
  const standing = input.phase !== undefined && STANDING_PHASES.has(input.phase);
  return (standing ? input.live : undefined) ?? input.remembered;
}

/**
 * A row's one reading of its Mate: the face and the words both from the activity it draws, so
 * the two never disagree (the owner, 2026-09-29: a new Mate at work read "Working on a reply"
 * under an asleep face — the words were this browser's memory of the row, drawn the moment its
 * candidate was not connected, and the face that moment's socket).
 *
 * | the activity drawn                    | face                    | a line of words to come |
 * | ------------------------------------- | ----------------------- | ----------------------- |
 * | read live (its socket up, or blinking) | the conversation's own  | the dots                |
 * | remembered (`menuMemory.ts`)          | asleep, idle if connected | held, empty             |
 * | none                                  | asleep, idle if connected | —                       |
 *
 * Its own change waiting on the person's review lifts every face but work's to needs-you
 * (`mateFaceAwaitingReview`), as the composer's top wears it for the same fact.
 *
 * A live reading stands while the socket blinks — reconnecting, a listing re-read — because the
 * conversation it was read from still stands; memory is only ever at rest.
 */
export function mateRowReading(input: {
  /** Its container is connected right now. */
  readonly connected: boolean;
  readonly activity: ZeropsAgentActivity | undefined;
  /** Its own change waits on the person's review (`mateNextStep`): it needs them. */
  readonly reviewWaits?: boolean;
}): MateRowView {
  const { activity } = input;
  const live = activity !== undefined && activity.remembered !== true ? activity : undefined;
  return mateRowView(
    activity,
    mateFaceAwaitingReview(
      mateFaceFor(input.connected || live !== undefined, live),
      input.reviewWaits === true,
      activity?.pausedUntil !== undefined,
    ),
  );
}

/**
 * The row's second line: the person's words — the last they sent, or the next waiting unsent in
 * its composer — or why none stand there. It is the person's line, as the third is the Mate's.
 */
export type MateRowAskLine =
  | { readonly kind: "ask"; readonly text: string }
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
 * | asked                                  | the ask                                      |
 * | never asked, its conversations read    | "Nothing asked yet"                          |
 * | never asked, not read, or a step below | nothing                                      |
 *
 * A draft stands in the person's line, never the Mate's: the question it waits on, its error,
 * its live step and its dots all keep their place under it. Nothing asked is said only once its
 * conversations are read — before that it is a socket still opening, and a reload paints nothing
 * it takes back. The row keeps three lines' height whatever this says, so nothing moves when
 * the first message lands.
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
  readonly deleting: boolean;
  /** Its conversations are read: none there is a fact, not a socket still opening. */
  readonly read: boolean;
}): MateRowAskLine {
  const { view } = input;
  if (view.coming !== undefined) return undefined;
  if (input.deleting) return view.ask === undefined ? undefined : { kind: "ask", text: view.ask };
  if (input.signIn !== undefined) return { kind: "sign-in", ...input.signIn };
  if (input.draft !== undefined) return { kind: "draft", text: input.draft, ask: view.ask };
  if (view.ask !== undefined) return { kind: "ask", text: view.ask };
  return view.reply === undefined && input.read ? { kind: "nothing-asked" } : undefined;
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
 * environment not sent yet. Its words trimmed; nothing where only blanks are typed.
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
  if (mate.environmentId === undefined) return undefined;
  const own = mate.threadKey === undefined ? undefined : words(mate.threadKey);
  if (own !== undefined) return own;
  let newest: { readonly at: string; readonly text: string } | undefined;
  for (const [key, session] of Object.entries(source.draftThreadsByThreadKey)) {
    if (session.environmentId !== mate.environmentId) continue;
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
  code: undefined,
} as const satisfies MateRowReply;

/** Setting a new Mate up stopped — a step of its birth, or its first run. */
const SETTING_UP_STOPPED = "Setting up stopped";
const SETTING_UP_STOPPED_REPLY = {
  kind: "words",
  text: SETTING_UP_STOPPED,
  tone: "failed",
} as const satisfies MateRowReply;

/** A Mate being born, as its row's one line says it (`mateBornLine`). */
export interface MateBornLine {
  readonly words: string;
  /** When its clock started, wall ms: the line counts up from it. None where nothing is held. */
  readonly since: number | undefined;
  readonly tone: "muted" | "failed";
}

/**
 * A Mate being born, in its row's one line (board D1, 2026-09-30): "Coming up" on a clock that
 * counts from the press — its Mate waited on included, the clock running on — a step past its
 * cap saying so on the same clock, and any step that stopped the one fact, in red. Where this
 * browser holds no birth for it there is no clock to count, and the words stand alone. Why it
 * stopped, and what to do, is its own view's to say.
 */
export function mateBornLine(coming: MateComing): MateBornLine {
  if (coming.kind === "failed") return BORN_STOPPED;
  return { words: bornWords(coming.verb === "keep-waiting"), since: coming.since, tone: "muted" };
}

const BORN_STOPPED: MateBornLine = { words: SETTING_UP_STOPPED, since: undefined, tone: "failed" };

/** On its way, or past its step's cap: the clock beside them says for how long. */
function bornWords(overdue: boolean): string {
  return overdue ? "Taking longer than usual" : "Coming up";
}

/** The line as it reads at `nowMs`: its words, then its clock — "Coming up · 0:42". */
export function mateBornLineText(line: MateBornLine, nowMs: number): string {
  return line.since === undefined
    ? line.words
    : `${line.words} · ${formatWorkingTime(nowMs - line.since)}`;
}

/**
 * A creation the listing does not hold yet (`ZeropsGroupPendingMember`), in its row's one line as
 * a listed Mate coming up says it: on its way since the platform took it — a New project's since
 * its press — past its step's cap, or stopped.
 */
export function pendingBornLine(
  member: Pick<ZeropsGroupPendingMember, "startedAt" | "overdue" | "failed">,
): MateBornLine {
  if (member.failed === true) return BORN_STOPPED;
  return { words: bornWords(member.overdue), since: member.startedAt, tone: "muted" };
}

/**
 * A Mate still coming up, or one that never came (`mateComing`), in its row: its face in the
 * coming pose — asleep, in the colours its person picked — its one line where it has got
 * (`mateBornLine`), and none of what only a Mate that is up has: no time, no ask, no words.
 * One that did not come wears the red dot of something broken (S3).
 */
export function mateComingRowView(view: MateRowView, coming: MateComing): MateRowView {
  return {
    ...view,
    state: coming.kind === "failed" ? "failed" : "idle",
    face: "sleep",
    slot: { kind: "none" },
    dot: coming.kind === "failed" ? "failed" : undefined,
    strongName: false,
    ask: undefined,
    reply: undefined,
    coming,
  };
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
