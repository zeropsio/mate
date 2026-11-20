/**
 * A Mate's arrival as its own view and its empty conversation draw it — the approved "Arrival"
 * board's Direction A, "Stage": the Mate's face, one headline, one sentence under it and one slot
 * under that. The face and the headline stand where "What should Wren do on Beviro?" will stand,
 * so every state from the press to the first answer changes words and the slot, never places.
 *
 * - Coming up: asleep, "Wren is coming up on Beviro.", how long is left, and the Mate's own steps
 *   in the person's words — its copy of the project, its computer, starting the Mate, opening its
 *   conversation, then the person's sign-in — as one row on its setup's clock.
 * - Signing in: awake, "Sign Wren in to start.", what happens once it is, and the sign-in itself
 *   (`ZeropsAgentSignIn`). A colleague who opens a Mate nobody has signed in sees the same screen;
 *   only the sentence says who added it and that signing it in makes it theirs.
 * - Standing up: at work, while the ask the sign-in sends is on its way; the conversation then
 *   takes over, the ask drawn as a quiet line (`mateStandUpAskLine`).
 * - Stopped, before the model exists: what stopped in plain words, with the one way on.
 * - Its setup never started (`mateStandUpStopped`): asking, "Wren's setup didn't start.", that
 *   nothing changed, and Try again for its person; anybody else reads who can start it again.
 *
 * Pure: the words, the face and the steps; the views draw them.
 */
import type { BirthLineStep, BirthRuntimeFact } from "@t3tools/client-runtime/zerops/birthProgress";
import { type MateSetup, type MateSetupFailure } from "@t3tools/client-runtime/zerops/mateSetup";
import { TAKING_LONGER_LINE } from "@t3tools/client-runtime/data";
import type { MateMarkState } from "@t3tools/shared/brand";

import { signInPhrase, signInPhraseWords } from "@t3tools/client-runtime/zerops/agentSignIn";

import { mateFaceFor } from "./agentActivity";
import { mateComingHeadlineClauses } from "./mateComing";
import type { MateSetupRetryState } from "./mateStandUp";
import { mateQuestion, type ZeropsMateIdentity } from "./mateIdentities";

type Named = Pick<ZeropsMateIdentity, "name" | "project">;

/** A name the headline never breaks inside. */
const keptWhole = (name: string) => name.replaceAll(" ", "\u00a0");

// ── The stage ────────────────────────────────────────────────────────────────────────────────

/** What the stage says, and so what its slot holds. */
export type ArrivalKind =
  /** From the press until the Mate answers. */
  | "coming"
  /** Its creation stopped: what stopped, and the way on. */
  | "coming-failed"
  /** Any other Mate on its way to its conversation, or not to be opened: its name. */
  | "reaching"
  | "unreachable"
  /** The person who added it signs it in: the stand-up follows. */
  | "sign-in"
  /** Nobody has signed it in, and the stand-up is not this viewer's. */
  | "sign-in-plain"
  /** A colleague: somebody else added it and has not signed it in. */
  | "sign-in-colleague"
  /** Signed in, the ask on its way. */
  | "standing-up"
  /** Its setup never started (`mateStandUpStopped`): its person starts it again. */
  | "setup-stopped"
  /** Its setup never started, and it is somebody else's to start again. */
  | "setup-stopped-plain"
  /** Ready: the question the composer answers. */
  | "question";

/** The headline, in the clauses it breaks between, with no name torn in two. */
export function arrivalHeadlineClauses(mate: Named, kind: ArrivalKind): ReadonlyArray<string> {
  switch (kind) {
    case "coming":
      return mateComingHeadlineClauses(mate, "coming");
    case "coming-failed":
      return mateComingHeadlineClauses(mate, "failed");
    case "reaching":
    case "unreachable":
      return mateComingHeadlineClauses(mate, kind);
    case "sign-in":
    case "sign-in-plain":
    case "sign-in-colleague":
      return [`Sign ${keptWhole(mate.name)} in to start.`];
    case "standing-up":
      return mate.project === undefined
        ? [`${keptWhole(mate.name)} is standing up development.`]
        : [`${keptWhole(mate.name)} is standing up development on ${keptWhole(mate.project)}.`];
    case "setup-stopped":
    case "setup-stopped-plain":
      return [`${keptWhole(mate.name)}'s setup didn't start.`];
    case "question":
      return [mateQuestion(mate)];
  }
}

/** The headline as one sentence, as a person reads it. */
export function arrivalHeadline(mate: Named, kind: ArrivalKind): string {
  return arrivalHeadlineClauses(mate, kind).join(" ").replaceAll("\u00a0", " ");
}

/** What the view knows beyond the Mate for its sentence. */
interface ArrivalSentenceContext {
  /** Coming up past its cap, on the verdict that says so (`comingSentence`). */
  readonly late?: boolean | undefined;
  /** A colleague's view: the name of who added it, where it is known. */
  readonly addedBy?: string | undefined;
  /** Its creation stopped, or a step outlasted its cap: why, in its own words. */
  readonly why?: string | undefined;
  /**
   * It runs on an agent Mate signs nobody in to (Cursor, OpenCode…), and no sign-in of the
   * viewer's is what made it ready: the stand-up's words say its agent is ready, not signed in.
   */
  readonly agentReady?: boolean | undefined;
  /** Its setup never started: where its person's Try again stands (`mateSetupRetryState`). */
  readonly retry?: MateSetupRetryState | undefined;
}

/**
 * How long it usually takes while it comes up — honest to the measured births (+160 s for a wizard
 * birth, 2026-09-22; +202 s for an Add, 2026-10-15) — and late only on the verdict that says so
 * (`late`): the container machine's, once a read since its cap finds it not up, or its first
 * build's past its grace. The clock alone never changes it: "Almost there." is said only once it is
 * up and its conversation is being read (`ALMOST_THERE_LINE`, run 2, 2026-10-16: "Almost there."
 * at 2:00 by the clock, 76 s before it came).
 */
export function comingSentence(late = false): string {
  return late ? TAKING_LONGER_LINE : "Usually two to four minutes.";
}

/** The one sentence under the headline; empty where the headline says it all. */
export function arrivalSentence(
  mate: Named,
  kind: ArrivalKind,
  context: ArrivalSentenceContext = {},
): string {
  const name = mate.name;
  switch (kind) {
    case "coming":
      return context.why ?? comingSentence(context.late);
    case "coming-failed":
      return context.why ?? "";
    case "sign-in":
      return mate.project === undefined
        ? `Once it's signed in, ${name} gets the app running.`
        : `Once it's signed in, ${name} gets ${mate.project} running.`;
    case "sign-in-plain":
      return mate.project === undefined
        ? `Once it's signed in, ${name} writes and runs code on its own copy of the project.`
        : `Once it's signed in, ${name} writes and runs code on its own copy of ${mate.project}.`;
    case "sign-in-colleague":
      return context.addedBy === undefined
        ? `Nobody has signed ${name} in yet. Sign it in with your own account and it's yours.`
        : `${context.addedBy} added ${name} but hasn't signed it in. Sign it in with your own account and it's yours.`;
    case "standing-up":
      if (context.retry === "starting") return "It starts in a moment.";
      return context.agentReady === true
        ? "Its agent is ready. It starts in a moment."
        : "Signed in. It starts in a moment.";
    case "setup-stopped":
      switch (context.retry) {
        case "again":
          return "It stopped before its first step again. Give it a minute, then try again.";
        case "refused":
          return `${name} has no setup of yours waiting to start. Write to ${name} below instead.`;
        case "unreachable":
          return `That didn't reach ${name}. Try again in a moment.`;
        default:
          return mate.project === undefined
            ? "It stopped before its first step, so nothing changed."
            : `It stopped before its first step, so nothing changed on ${mate.project}.`;
      }
    case "setup-stopped-plain":
      return context.addedBy === undefined
        ? `The person who added ${name} can start it again.`
        : `${context.addedBy} added ${name} and can start it again.`;
    case "reaching":
    case "unreachable":
    case "question":
      return "";
  }
}

/**
 * The face the stage wears: waking while it comes up and arrives — from the press to its first
 * sign-in (`mateFaceFor`, `arriving` from `mateArriving`) — at work on the stand-up, asking on a
 * stop; any other Mate on its way to its conversation asleep.
 */
export function arrivalFace(
  kind: ArrivalKind,
  connected: boolean,
  /** It is still arriving (`mateArriving`): nobody has signed it in, inside its window. */
  arriving: boolean,
): MateMarkState {
  switch (kind) {
    case "coming":
      return mateFaceFor(connected, undefined, { life: "coming" });
    case "reaching":
    case "unreachable":
      return "sleep";
    case "coming-failed":
    case "setup-stopped":
      return "needs";
    case "standing-up":
      return "working";
    case "setup-stopped-plain":
      return mateFaceFor(connected, undefined, { arriving: false });
    case "sign-in":
    case "sign-in-plain":
    case "sign-in-colleague":
    case "question":
      return mateFaceFor(connected, undefined, { arriving });
  }
}

// ── The steps while it comes up ──────────────────────────────────────────────────────────────

/** A service of the Mate's copy of the project, on a step's quiet line. */
export interface ArrivalService {
  readonly name: string;
  readonly state: "ok" | "busy" | "waiting" | "failed" | "empty";
}

/** A step as the Mate's birth carries it. */
export type ArrivalStepInput = BirthLineStep;

/** One step of the arrival, in the person's words. */
export interface ArrivalStep {
  readonly id: string;
  readonly label: string;
  /** `you`: the person's own step, next. */
  readonly state: "done" | "active" | "waiting" | "failed" | "you";
}

/**
 * A step this tab runs with the person's own session — the project registered and created, closed
 * off, the Mate registered — drawn under its project's row, from the press until the hand-over.
 */
export interface ArrivalSubstep {
  readonly id: string;
  readonly label: string;
  /**
   * `unfinished`: refused here; the Mate runs on without its registration.
   */
  readonly state: "done" | "active" | "waiting" | "failed" | "unfinished";
  /** Why it stopped, or why it is not finished, in its own words. */
  readonly why?: string;
}

/** A step through as far as this tab goes: done, or left unfinished. */
const through = (step: ArrivalSubstep): boolean =>
  step.state === "done" || step.state === "unfinished";

/**
 * What the steps this tab runs leave to read whole under them, where the actions are — each step
 * keeps one line, so a long reason is cut there and read here, by anyone, without a hover: why
 * one stopped, else what is not finished and why. Nothing while they run or once through.
 */
export function pressNote(press: ReadonlyArray<ArrivalSubstep> | undefined): {
  readonly kind: "stopped" | "unfinished";
  readonly text: string;
} | null {
  const stopped = press?.find((step) => step.state === "failed" && step.why !== undefined);
  if (stopped?.why !== undefined) return { kind: "stopped", text: stopped.why };
  const left = press?.find((step) => step.state === "unfinished");
  if (left === undefined) return null;
  return {
    kind: "unfinished",
    text: left.why === undefined ? `${left.label}.` : `${left.label}: ${left.why}`,
  };
}

/**
 * What the page says while the steps this tab runs are under way — the one thing that stops them —
 * in the words the dialog that pressed it said before (`whatHappensNext`).
 */
export const KEEP_TAB_OPEN_LINE = "Keep this tab open for half a minute, then you can leave.";

/**
 * Whether the steps this tab runs are still under way: none stopped, one not through. Only then
 * does a tab closed interrupt them, and only then does the page say so (`KEEP_TAB_OPEN_LINE`).
 */
export function pressRuns(press: ReadonlyArray<ArrivalSubstep> | undefined): boolean {
  if (press === undefined || press.length === 0) return false;
  if (press.some((step) => step.state === "failed")) return false;
  return press.some((step) => !through(step));
}

/**
 * A project's row with the steps this tab runs under it: stopped where one stopped, under way
 * while one is not through though the row's own facts are, and as its own facts say once they are.
 */
function withSubsteps(
  state: ArrivalStep["state"],
  press: ReadonlyArray<ArrivalSubstep>,
): ArrivalStep["state"] {
  if (state === "failed" || press.some((step) => step.state === "failed")) return "failed";
  if (state === "done" && press.some((step) => !through(step))) return "active";
  return state;
}

/** The Mate's five birth steps; anything else before them is its project's own (a New project's). */
const MATE_STEP_IDS: ReadonlySet<string> = new Set([
  "project",
  "container",
  "public-access",
  "mate",
  "connect",
]);

/** What paces its arrival's bar: the middle of its setup's 2–4 minutes (`Progress`'s `paceMs`). */
export const ARRIVAL_PACE_MS = 3 * 60_000;

/**
 * Its progress on its setup's one clock (board D1, 2026-09-30; the owner, 2026-10-15): from the
 * first press (`pressSince`) where this tab pressed it, as its menu row counts — else the
 * platform's own start stands.
 */
export function onSetupClock<T extends { readonly startedAt?: string | undefined }>(
  progress: T,
  since: number | undefined,
): T {
  return since === undefined ? progress : { ...progress, startedAt: new Date(since).toISOString() };
}

/**
 * The arrival's steps from the Mate's birth, in order and in the person's words: its project's own
 * steps first where it has them (a New project's HQ and registration), then the Mate's copy. Its
 * computer includes its address. A New project's first Mate folds its copy into that computer
 * step. Starting the Mate and opening its conversation follow, then its Git access, the person's
 * sign-in and its stand-up as the Mate's own setup reports them.
 */
export function arrivalSteps(
  progress: {
    readonly steps: ReadonlyArray<ArrivalStepInput>;
    /** What the Mate's own setup says (`/mate/setup.json`); absent before it answers, or ever. */
    readonly setup?: Pick<MateSetup, "git" | "signin" | "standup"> | undefined;
    /** Why its setup can't be read, where its container serves one (`useMateSetup`). */
    readonly setupFailure?: MateSetupFailure | undefined;
    /** The steps this tab runs for it, while it holds them. */
    readonly press?: ReadonlyArray<ArrivalSubstep> | undefined;
    /**
     * An agent Mate signs nobody in to (Cursor, OpenCode, Grok, Antigravity) is ready on it, and
     * no sign-in of the viewer's is (`MateEmptyState.agentReady`): nothing is theirs to sign in.
     */
    readonly agentReady?: boolean | undefined;
  },
  mate: Named,
): ReadonlyArray<ArrivalStep> {
  const own = progress.steps.filter((step) => !MATE_STEP_IDS.has(step.id));
  const project = progress.steps.find((step) => step.id === "project");
  const foldsCopy = own.length > 0;
  const steps: ArrivalStep[] = own.map((step) => ({
    id: step.id,
    label: step.label,
    state: step.state,
  }));
  if (project !== undefined && !foldsCopy) {
    steps.push({
      id: "copy",
      label:
        mate.project === undefined
          ? `${mate.name}'s project`
          : `${mate.name}'s copy of ${mate.project}`,
      state: project.state,
    });
  }
  for (const { id, label, parts } of [
    {
      id: "computer",
      label: `${mate.name}'s computer`,
      parts: progress.steps.filter(
        (step) =>
          step.id === "container" ||
          step.id === "public-access" ||
          (foldsCopy && step.id === "project"),
      ),
    },
    {
      id: "start",
      label: `Starting ${mate.name}`,
      parts: progress.steps.filter((step) => step.id === "mate"),
    },
    {
      id: "open",
      label: `Opening ${mate.name}'s conversation`,
      parts: progress.steps.filter((step) => step.id === "connect"),
    },
  ]) {
    if (parts.length === 0) continue;
    const failed = parts.find((step) => step.state === "failed");
    const state: ArrivalStep["state"] =
      failed !== undefined
        ? "failed"
        : parts.every((step) => step.state === "done")
          ? "done"
          : parts.some((step) => step.state === "active" || step.state === "done")
            ? "active"
            : "waiting";
    steps.push({ id, label, state });
  }
  // The steps this tab runs go under the project's row: a New project's own, else the Mate's copy.
  const press = progress.press;
  if (press !== undefined && press.length > 0) {
    const at = steps.findIndex((step) => step.id === "registry" || step.id === "copy");
    const row = steps[at];
    if (row !== undefined) {
      steps[at] = { ...row, state: withSubsteps(row.state, press) };
    }
  }
  const setup = progress.setup;
  if (setup?.git !== undefined) {
    // Its enrollment with HQ: a New project's first Mate has no stand-up after it.
    steps.push({
      id: "git",
      label: `${mate.name}'s Git access`,
      state: setup.git === "done" ? "done" : setup.git === "failed" ? "failed" : "active",
    });
  }
  if (progress.setupFailure !== undefined) {
    steps.push({ id: "setup", label: `${mate.name}'s setup`, state: "failed" });
  }
  if (progress.agentReady === true) {
    steps.push({ id: "you", label: `${mate.name}'s agent is ready`, state: "done" });
  } else {
    steps.push({
      id: "you",
      label: signInPhraseWords(signInPhrase(mate.name)),
      state: setup?.signin === "done" ? "done" : "you",
    });
  }
  // A Mate with no stand-up to run (a New project's first) has no step for one.
  if (setup?.standup !== undefined && setup.standup !== "none") {
    steps.push({
      id: "standup",
      label: `${mate.name} gets the app running`,
      state: STANDUP_STATES[setup.standup],
    });
  }
  return steps;
}

/** A Mate's arrival as the kit's one progress row (`Progress`): words in place of the step list. */
interface ArrivalRow {
  /** Each step's words, in order. */
  readonly steps: ReadonlyArray<string>;
  /** The step it is on: the first not done; the last once every one is. */
  readonly at: number;
  readonly state: "running" | "done" | "failed";
  /**
   * From its setup's one clock (`onSetupClock`: the first press, as its menu row counts), else the
   * earliest start its facts hold; `null` while it waits on the person, or unknown.
   */
  readonly startedAtMs: number | null;
  /** Where its clock stopped: the stop's end, or the last step's once done. */
  readonly endedAtMs: number | null;
}

const parsedTimes = (times: ReadonlyArray<string | undefined>) =>
  times.flatMap((time) => {
    const ms = time === undefined ? Number.NaN : Date.parse(time);
    return Number.isNaN(ms) ? [] : [ms];
  });

/**
 * The arrival's steps (`arrivalSteps`) as one row: the step it is on in words, never a growing
 * list. Only a step's own failure stops the row there; the person's own step, next, holds the row
 * on their words with no clock, for nothing runs until they act. Its clock is the setup's one clock where there is one (`since`).
 */
export function arrivalRow(
  steps: ReadonlyArray<ArrivalStep>,
  facts: ReadonlyArray<ArrivalStepInput>,
  since?: string,
): ArrivalRow {
  const failedAt = steps.findIndex((step) => step.state === "failed");
  const openAt = steps.findIndex((step) => step.state !== "done");
  const at = failedAt !== -1 ? failedAt : openAt !== -1 ? openAt : Math.max(0, steps.length - 1);
  const state = failedAt !== -1 ? "failed" : openAt === -1 ? "done" : "running";
  const waitsOnYou = state === "running" && steps[at]?.state === "you";
  const starts = parsedTimes(since === undefined ? facts.map((fact) => fact.startedAt) : [since]);
  const ends = parsedTimes(facts.map((fact) => fact.endedAt));
  return {
    steps: steps.map((step) => step.label),
    at,
    state,
    startedAtMs: waitsOnYou || starts.length === 0 ? null : Math.min(...starts),
    endedAtMs: state === "running" || ends.length === 0 ? null : Math.max(...ends),
  };
}

/** Why a Mate's setup can't be read: the setup step's reason, read whole under the steps. */
export const SETUP_FAILURE_WORDS: Readonly<Record<MateSetupFailure, string>> = {
  refused: "Its container turned the read of its setup away.",
  invalid: "Its container answered with something that isn't its setup.",
};

/** The stand-up as the Mate's setup says it, as a step. */
const STANDUP_STATES: Readonly<
  Record<Exclude<MateSetup["standup"], "none" | undefined>, ArrivalStep["state"]>
> = {
  waiting: "waiting",
  running: "active",
  done: "done",
  failed: "failed",
};

/**
 * Names in the order they were first seen, however a read orders them — the new ones after, in
 * the read's order — and the order to remember: a quiet line's names never trade places while
 * nothing about them changed (a birth's recipe order handing over to the listing's own).
 */
export function inFirstSeenOrder(
  seen: ReadonlyArray<string>,
  names: ReadonlyArray<string>,
): { readonly order: ReadonlyArray<string>; readonly seen: ReadonlyArray<string> } {
  const present = new Set(names);
  const known = new Set(seen);
  const added = names.filter((name) => !known.has(name));
  return {
    order: [...seen.filter((name) => present.has(name)), ...added],
    seen: added.length === 0 ? seen : [...seen, ...added],
  };
}

// ── The runtimes while the person signs it in ────────────────────────────────────────────────

/** The statuses of a runtime on its way up: made, being created, or a dev half awaiting its build. */
const RUNTIME_COMING_STATUSES: ReadonlySet<string> = new Set([
  "NEW",
  "CREATING",
  "READY_TO_DEPLOY",
]);

const RUNTIME_FAILED_STATUSES: ReadonlySet<string> = new Set([
  "FAILED",
  "ACTION_FAILED",
  "CONTAINER_FAILED",
  "REPAIR_FAILED",
]);

function runtimeDrawn(runtime: BirthRuntimeFact): {
  readonly state: ArrivalService["state"];
  readonly coming: boolean;
} {
  const status = runtime.service?.status;
  // Imported, not listed yet: it is on its way.
  if (status === undefined) return { state: "waiting", coming: true };
  // A stage half rests at READY_TO_DEPLOY until its first deploy: it is up.
  if (status === "ACTIVE" || (runtime.role === "stage" && status === "READY_TO_DEPLOY")) {
    return { state: "ok", coming: false };
  }
  if (RUNTIME_FAILED_STATUSES.has(status)) return { state: "failed", coming: false };
  if (RUNTIME_COMING_STATUSES.has(status)) return { state: "busy", coming: true };
  // Stopped, or anything else no import is bringing up.
  return { state: "waiting", coming: false };
}

/**
 * The runtimes under the sign-in, as the workspace step drew them: each as far as it has come,
 * and whether any is still coming up — the dev halves' first deploys and a utility's build run
 * minutes past the Mate's first answer (measured 2026-09-30: until +264 s and +316 s, the sign-in
 * at +170 s). Undefined for a Mate that has none.
 */
export function runtimesComing(runtimes: ReadonlyArray<BirthRuntimeFact> | undefined):
  | {
      readonly services: ReadonlyArray<ArrivalService>;
      readonly coming: boolean;
    }
  | undefined {
  if (runtimes === undefined || runtimes.length === 0) return undefined;
  const drawn = runtimes.map((runtime) => ({ name: runtime.hostname, ...runtimeDrawn(runtime) }));
  return {
    services: drawn.map(({ name, state }) => ({ name, state })),
    coming: drawn.some((runtime) => runtime.coming),
  };
}

/**
 * The sign-in's runtimes line: `none` until a runtime is seen coming up — never for a Mate whose
 * runtimes are already up — `coming` while any is, then `settled` once all are: its words fade,
 * its place stays, since the page is centred and a line that went would move everything above it.
 * It ends with the sign-in: the stand-up's run card carries the builds from there. A listing that
 * blinks unread between reads leaves it as it stands.
 */
export type RuntimesLine = "none" | "coming" | "settled";

export function nextRuntimesLine(
  line: RuntimesLine,
  /** Whether any is coming up; undefined while the listing is unread, which says nothing. */
  coming: boolean | undefined,
): RuntimesLine {
  if (coming === undefined) return line;
  if (coming) return "coming";
  return line === "none" ? "none" : "settled";
}
