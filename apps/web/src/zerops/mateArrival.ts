/**
 * A Mate's arrival as its own view and its empty conversation draw it — the approved "Arrival"
 * board's Direction A, "Stage": the Mate's face, one headline, one sentence under it and one slot
 * under that. The face and the headline stand where "What should Wren do on Beviro?" will stand,
 * so every state from the press to the first answer changes words and the slot, never places.
 *
 * - Coming up: asleep, "Wren is coming up on Beviro.", how long is left, and the Mate's own steps
 *   in the person's words — its copy of the project, its workspace, then the person's sign-in —
 *   with the times they took, measured, never guessed.
 * - Signing in: awake, "Sign Wren in to start.", what happens once it is, and the sign-in itself
 *   (`ZeropsAgentSignIn`). A colleague who opens a Mate nobody has signed in sees the same screen;
 *   only the sentence says who added it and that signing it in makes it theirs.
 * - Standing up: at work, while the ask the sign-in sends is on its way; the conversation then
 *   takes over, the ask drawn as a quiet line (`mateStandUpAskLine`).
 * - Stopped, before the model exists: what stopped in plain words, with the one way on.
 *
 * Pure: the words, the face and the steps; the views draw them.
 */
import type { BirthRuntimeFact } from "@t3tools/client-runtime/zerops/birthProgress";
import { enrollmentRefusalWords, NO_HQ_WORDS } from "@t3tools/client-runtime/zerops/hq";
import {
  standUpFailureWords,
  type MateSetup,
  type MateSetupFailure,
} from "@t3tools/client-runtime/zerops/mateSetup";
import { TAKING_LONGER_LINE } from "@t3tools/client-runtime/data";
import type { MateMarkState } from "@t3tools/shared/brand";

import {
  formatBirthElapsed,
  type BirthLineStep,
} from "../components/zerops/ZeropsBirthProgress.logic";
import { formatWorkingTime } from "../components/zerops/SidebarZeropsTree.logic";
import {
  signInPhrase,
  signInPhraseWords,
  type SignInPhrasePart,
} from "~/components/zerops/ZeropsAgentSignIn.logic";

import { mateFaceFor } from "./agentActivity";
import { mateComingHeadlineClauses } from "./mateComing";
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
    case "question":
      return [mateQuestion(mate)];
  }
}

/** The headline as one sentence, as a person reads it. */
export function arrivalHeadline(mate: Named, kind: ArrivalKind): string {
  return arrivalHeadlineClauses(mate, kind).join(" ").replaceAll("\u00a0", " ");
}

/** What the view knows beyond the Mate for its sentence. */
export interface ArrivalSentenceContext {
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
      return context.agentReady === true
        ? "Its agent is ready. It starts in a moment."
        : "Signed in. It starts in a moment.";
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
      return "needs";
    case "standing-up":
      return "working";
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

/** A service as the birth reads it: its hostname, as far as it has come. */
interface BirthService {
  readonly hostname: string;
  readonly state: "waiting" | "active" | "done" | "failed";
}

/** One step of the arrival, in the person's words. */
export interface ArrivalStep {
  readonly id: string;
  readonly label: string;
  /** The label's words with the brands in them marked, where it names any (`signInPhrase`). */
  readonly phrase?: ReadonlyArray<SignInPhrasePart>;
  /** `you`: the person's own step, next. */
  readonly state: "done" | "active" | "waiting" | "failed" | "you";
  /** How long it took, or has taken so far — measured, `m:ss`. */
  readonly time?: string;
  /** What the time is measured against, or when a step with no time comes: in words. */
  readonly note?: string;
  /** Why it stopped, in its own words. */
  readonly why?: string;
  readonly services?: ReadonlyArray<ArrivalService>;
  /** The steps this tab runs for it, under its project's row (`ArrivalSubstep`). */
  readonly substeps?: ReadonlyArray<ArrivalSubstep>;
}

/**
 * A step this tab runs with the person's own session — the project registered and created, closed
 * off, the Mate registered — drawn under its project's row, from the press until the hand-over.
 */
export interface ArrivalSubstep {
  readonly id: string;
  readonly label: string;
  /**
   * `unfinished`: refused here, and left to *Finish setup* — the Mate runs on without it (its
   * registration), so nothing waits on it and nothing stopped.
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

/** The Mate's six birth steps; anything else before them is its project's own (a New project's). */
const MATE_STEP_IDS: ReadonlySet<string> = new Set([
  "project",
  "container",
  "public-access",
  "mate",
  "connect",
]);

/** The steps that make its workspace, measured together: the person sees one. */
const WORKSPACE_STEP_IDS: ReadonlySet<string> = new Set([
  "container",
  "public-access",
  "mate",
  "connect",
]);

/**
 * How long its workspace takes once its project stands, measured: +25 s → +160 s (2026-09-22),
 * +36 s → +202 s (2026-10-15).
 */
const WORKSPACE_ABOUT = "about 2–3 min";

/** How long its setup takes from the press, as its Add promised it (`whatHappensNext`). */
const SETUP_ABOUT = "about 2–4 min";

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

const timeOf = (
  startedAt: string | undefined,
  endedAt: string | undefined,
  nowMs: number,
  active: boolean,
) => {
  if (endedAt === undefined && !active) return undefined;
  if (startedAt === undefined) return undefined;
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return undefined;
  const end = endedAt === undefined ? nowMs : Date.parse(endedAt);
  return Number.isNaN(end) ? undefined : formatBirthElapsed(end - start);
};

/**
 * The arrival's steps from the Mate's birth: its project's own steps first where it has them (a
 * New project's HQ and registration), then the Mate's copy of the project — the managed
 * services its first import brings, what it waits on, on a quiet line under it — then its
 * workspace (the container, its address, closing it off, the runtimes' import, Mate answering,
 * the first connect: one step to the person) with the runtimes it imports under it, then — as
 * the Mate's own setup says them, once it answers — its Git access, the person's own sign-in,
 * next, and its stand-up. A New project's first Mate is the project, so its copy folds into
 * its workspace. A step over takes the time its own facts measure; a step with none says none. A
 * running one shows its setup's one clock (`onSetupClock`); without it, it counts from the
 * earliest start its facts hold, so a start read later never moves its clock back.
 */
export function arrivalSteps(
  progress: {
    readonly steps: ReadonlyArray<ArrivalStepInput>;
    /** The copy's managed services (`birthCopyServices`). */
    readonly managed?: ReadonlyArray<BirthService> | undefined;
    /** The tier's runtimes, imported once the project is closed off (`birthRuntimesFacts`). */
    readonly runtimes?: { readonly runtimes: ReadonlyArray<BirthService> };
    /** What the Mate's own setup says (`/mate/setup.json`); absent before it answers, or ever. */
    readonly setup?:
      | Pick<MateSetup, "git" | "gitFailure" | "signin" | "standup" | "standupFailure">
      | undefined;
    /** Why its setup can't be read, where its container serves one (`useMateSetup`). */
    readonly setupFailure?: MateSetupFailure | undefined;
    /** The steps this tab runs for it, while it holds them. */
    readonly press?: ReadonlyArray<ArrivalSubstep> | undefined;
    /**
     * An agent Mate signs nobody in to (Cursor, OpenCode, Grok, Antigravity) is ready on it, and
     * no sign-in of the viewer's is (`MateEmptyState.agentReady`): nothing is theirs to sign in.
     */
    readonly agentReady?: boolean | undefined;
    /** When its setup began (`onSetupClock`): the running step reads this one clock. */
    readonly startedAt?: string | undefined;
  },
  mate: Named,
  nowMs: number,
): ReadonlyArray<ArrivalStep> {
  // The step running now shows how long its setup has taken, the time its menu row shows: one
  // time for one Mate. A step over says how long it took.
  const since = progress.startedAt === undefined ? Number.NaN : Date.parse(progress.startedAt);
  const setupClock = Number.isNaN(since) ? undefined : formatWorkingTime(nowMs - since);
  const stepTime = (
    startedAt: string | undefined,
    endedAt: string | undefined,
    active: boolean,
  ): string | undefined =>
    active && setupClock !== undefined ? setupClock : timeOf(startedAt, endedAt, nowMs, active);
  const own = progress.steps.filter((step) => !MATE_STEP_IDS.has(step.id));
  const project = progress.steps.find((step) => step.id === "project");
  const workspace = progress.steps.filter((step) => WORKSPACE_STEP_IDS.has(step.id));
  const foldsCopy = own.length > 0;
  const steps: ArrivalStep[] = own.map((step) => ({
    id: step.id,
    label: step.label,
    state: step.state,
    ...optional(
      "time",
      step.state === "waiting"
        ? undefined
        : stepTime(step.startedAt, step.endedAt, step.state === "active"),
    ),
    ...optional("why", step.state === "failed" ? step.detail : undefined),
  }));
  if (project !== undefined && !foldsCopy) {
    steps.push({
      id: "copy",
      label:
        mate.project === undefined
          ? `${mate.name}'s project`
          : `${mate.name}'s copy of ${mate.project}`,
      state: project.state,
      ...optional(
        "time",
        project.state === "waiting"
          ? undefined
          : stepTime(project.startedAt, project.endedAt, project.state === "active"),
      ),
      ...optional("why", project.state === "failed" ? project.detail : undefined),
      ...optional("services", drawnServices(progress.managed)),
    });
  }
  const parts = foldsCopy && project !== undefined ? [project, ...workspace] : workspace;
  if (parts.length > 0) {
    const failed = parts.find((step) => step.state === "failed");
    const state: ArrivalStep["state"] =
      failed !== undefined
        ? "failed"
        : parts.every((step) => step.state === "done")
          ? "done"
          : parts.some((step) => step.state === "active" || step.state === "done")
            ? "active"
            : "waiting";
    // From the earliest workspace start its facts hold. Never
    // the first one read, which a start read later can precede (0:12, then 0:08, measured).
    const startedAt = earliest(parts.map((step) => step.startedAt));
    const endedAt =
      state === "failed"
        ? failed?.endedAt
        : state === "done" && parts.every((step) => step.endedAt !== undefined)
          ? parts
              .map((step) => step.endedAt)
              .sort()
              .at(-1)
          : undefined;
    const time = stepTime(startedAt, endedAt, state === "active");
    steps.push({
      id: "workspace",
      label: `${mate.name}'s workspace`,
      state,
      ...optional("time", time),
      ...optional(
        "note",
        state !== "active" ? undefined : setupClock === undefined ? WORKSPACE_ABOUT : SETUP_ABOUT,
      ),
      ...optional("why", failed?.detail),
      ...optional(
        "services",
        drawnServices([
          ...(foldsCopy ? (progress.managed ?? []) : []),
          ...(progress.runtimes?.runtimes ?? []),
        ]),
      ),
    });
  }
  // The steps this tab runs go under the project's row: a New project's own, else the Mate's copy.
  const press = progress.press;
  if (press !== undefined && press.length > 0) {
    const at = steps.findIndex((step) => step.id === "registry" || step.id === "copy");
    const row = steps[at];
    if (row !== undefined) {
      steps[at] = { ...row, state: withSubsteps(row.state, press), substeps: press };
    }
  }
  const setup = progress.setup;
  if (setup?.git !== undefined) {
    // Its enrollment with HQ: where it failed, why and what the person can do — a New project's
    // first Mate has no stand-up to say it otherwise.
    const failure = setup.git === "failed" ? setup.gitFailure : undefined;
    steps.push({
      id: "git",
      label: `${mate.name}'s Git access`,
      state: setup.git === "done" ? "done" : setup.git === "failed" ? "failed" : "active",
      ...optional(
        "why",
        failure === undefined
          ? undefined
          : failure.reason === "no_hq"
            ? NO_HQ_WORDS
            : failure.reason === "credential_unavailable"
              ? "HQ has not provided Git access yet. Check this Mate's connection to HQ."
              : enrollmentRefusalWords(failure.code),
      ),
    });
  }
  if (progress.setupFailure !== undefined) {
    steps.push({
      id: "setup",
      label: `${mate.name}'s setup`,
      state: "failed",
      why: SETUP_FAILURE_WORDS[progress.setupFailure],
    });
  }
  if (progress.agentReady === true) {
    steps.push({ id: "you", label: `${mate.name}'s agent is ready`, state: "done" });
  } else {
    const phrase = signInPhrase(mate.name);
    steps.push({
      id: "you",
      label: signInPhraseWords(phrase),
      phrase,
      state: setup?.signin === "done" ? "done" : "you",
    });
  }
  // A Mate with no stand-up to run (a New project's first) has no step for one.
  if (setup?.standup !== undefined && setup.standup !== "none") {
    steps.push({
      id: "standup",
      label: `${mate.name} gets the app running`,
      state: STANDUP_STATES[setup.standup],
      ...optional(
        "why",
        setup.standup === "failed" ? standUpFailureWords(setup.standupFailure) : undefined,
      ),
    });
  }
  return steps;
}

/** A Mate's arrival as the kit's one progress row (`Progress`): words in place of the step list. */
export interface ArrivalRow {
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
 * list. A step that failed — or a creation that stopped, which stops a step under way with it —
 * stops the row there; the person's own step, next, holds the row on their words with no clock,
 * for nothing runs until they act. Its clock is the setup's one clock where there is one (`since`).
 */
export function arrivalRow(
  steps: ReadonlyArray<ArrivalStep>,
  facts: ReadonlyArray<ArrivalStepInput>,
  stopped: boolean,
  since?: string,
): ArrivalRow {
  const failedAt = steps.findIndex((step) => step.state === "failed");
  const openAt = steps.findIndex((step) => step.state !== "done");
  const at = failedAt !== -1 ? failedAt : openAt !== -1 ? openAt : Math.max(0, steps.length - 1);
  const state = failedAt !== -1 || stopped ? "failed" : openAt === -1 ? "done" : "running";
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

function optional<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): { readonly [K in Key]?: Value } {
  return (value === undefined ? {} : { [key]: value }) as { readonly [K in Key]?: Value };
}

/** The earliest of the times given, as given; undefined where none reads as a time. */
function earliest(times: ReadonlyArray<string | undefined>): string | undefined {
  let found: { readonly at: string; readonly ms: number } | undefined;
  for (const at of times) {
    if (at === undefined) continue;
    const ms = Date.parse(at);
    if (Number.isNaN(ms) || (found !== undefined && found.ms <= ms)) continue;
    found = { at, ms };
  }
  return found?.at;
}

/** How a service the birth reads is drawn on a step's quiet line. */
const BIRTH_SERVICE_STATE: Readonly<Record<BirthService["state"], ArrivalService["state"]>> = {
  waiting: "waiting",
  active: "busy",
  done: "ok",
  failed: "failed",
};

/** A step's quiet line: each service as far as it has come; nothing when there are none. */
function drawnServices(
  services: ReadonlyArray<BirthService> | undefined,
): ReadonlyArray<ArrivalService> | undefined {
  if (services === undefined || services.length === 0) return undefined;
  return services.map((service) => ({
    name: service.hostname,
    state: BIRTH_SERVICE_STATE[service.state],
  }));
}

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
