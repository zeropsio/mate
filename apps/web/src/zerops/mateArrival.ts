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
import type { MateSetup } from "@t3tools/client-runtime/zerops/mateSetup";
import type { MateMarkState } from "@t3tools/shared/brand";

import {
  formatBirthElapsed,
  type BirthLineStep,
} from "../components/zerops/ZeropsBirthProgress.logic";
import {
  signInPhrase,
  signInPhraseWords,
  type SignInPhrasePart,
} from "~/components/zerops/ZeropsAgentSignIn.logic";

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
  /** The ask did not go through. */
  | "failed"
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
    case "failed":
      return [`The message to ${keptWhole(mate.name)} didn't go through.`];
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
  /** Coming up: how long it has taken so far, wall ms; undefined while unknown. */
  readonly elapsedMs?: number | undefined;
  /** A colleague's view: the name of who added it, where it is known. */
  readonly addedBy?: string | undefined;
  /** Its creation stopped, or a step outlasted its cap: why, in its own words. */
  readonly why?: string | undefined;
}

/** How long a Mate takes from the press until it answers, measured (a wizard birth, 2026-09-22). */
export const MATE_ARRIVAL_TYPICAL_MS = 160_000;

/**
 * How long is left while it comes up, from how long it has taken: honest to the measured birth —
 * first connect at +160 s — and never a count down past it.
 */
export function comingSentence(elapsedMs: number | undefined): string {
  // What comes after is the steps' last row, with what the person signs it in with.
  if (elapsedMs === undefined || elapsedMs < 60_000) return "About two minutes.";
  if (elapsedMs < 120_000) return "About a minute left.";
  return "Almost there.";
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
      return context.why ?? comingSentence(context.elapsedMs);
    case "coming-failed":
      return context.why ?? "";
    case "sign-in":
      return mate.project === undefined
        ? `Once it's signed in, ${name} stands up development.`
        : `Once it's signed in, ${name} stands up development on ${mate.project}.`;
    case "sign-in-plain":
      return mate.project === undefined
        ? `Once it's signed in, ${name} writes and runs code on its own copy of the project.`
        : `Once it's signed in, ${name} writes and runs code on its own copy of ${mate.project}.`;
    case "sign-in-colleague":
      return context.addedBy === undefined
        ? `Nobody has signed ${name} in yet. Sign it in with your own account and it's yours.`
        : `${context.addedBy} added ${name} but hasn't signed it in. Sign it in with your own account and it's yours.`;
    case "standing-up":
      return "Signed in. It starts in a moment.";
    case "failed":
      return `${name} is signed in, but your ask to stand up development didn't reach it.`;
    case "reaching":
    case "unreachable":
    case "question":
      return "";
  }
}

/** The face the stage wears: asleep until it answers, at work on the stand-up, asking on a stop. */
export function arrivalFace(kind: ArrivalKind, connected: boolean): MateMarkState {
  switch (kind) {
    case "coming":
    case "reaching":
    case "unreachable":
      return "sleep";
    case "coming-failed":
    case "failed":
      return "needs";
    case "standing-up":
      return "working";
    case "sign-in":
    case "sign-in-plain":
    case "sign-in-colleague":
    case "question":
      return connected ? "idle" : "sleep";
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

/** How long its workspace takes once its project stands, measured (2026-09-22: +25 s → +160 s). */
const WORKSPACE_ABOUT = "about 2 min";

const timeOf = (startedAt: string | undefined, endedAt: string | undefined, nowMs: number) => {
  if (startedAt === undefined) return undefined;
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return undefined;
  const end = endedAt === undefined ? nowMs : Date.parse(endedAt);
  return Number.isNaN(end) ? undefined : formatBirthElapsed(end - start);
};

/**
 * The arrival's steps from the Mate's birth: its project's own steps first where it has them (a
 * New project's Git hosting and registration), then the Mate's copy of the project — the managed
 * services its first import brings, what it waits on, on a quiet line under it — then its
 * workspace (the container, its address, closing it off, the runtimes' import, Mate answering,
 * the first connect: one step to the person) with the runtimes it imports under it, then — as
 * the Mate's own setup says them, once it answers — its Git access, the person's own sign-in,
 * next, and its stand-up. A New project's first Mate is the project, so its copy folds into
 * its workspace. A step's time is what its own facts measure; a step with none says none, and a
 * running one counts from the earliest start its facts hold, so a start read later never moves
 * its clock back.
 */
export function arrivalSteps(
  progress: {
    readonly steps: ReadonlyArray<ArrivalStepInput>;
    /** The copy's managed services (`birthCopyServices`). */
    readonly managed?: ReadonlyArray<BirthService> | undefined;
    /** The tier's runtimes, imported once the project is closed off (`birthRuntimesFacts`). */
    readonly runtimes?: { readonly runtimes: ReadonlyArray<BirthService> };
    /** What the Mate's own setup says (`/mate/setup.json`); absent before it answers, or ever. */
    readonly setup?: Pick<MateSetup, "git" | "signin" | "standup"> | undefined;
  },
  mate: Named,
  nowMs: number,
): ReadonlyArray<ArrivalStep> {
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
      step.state === "waiting" ? undefined : timeOf(step.startedAt, step.endedAt, nowMs),
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
        project.state === "waiting" ? undefined : timeOf(project.startedAt, project.endedAt, nowMs),
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
    // From the earliest start its facts hold: its project's end, or a part's own start. Never
    // the first one read, which a start read later can precede (0:12, then 0:08, measured).
    const startedAt = earliest([
      ...parts.map((step) => step.startedAt),
      project?.state === "done" && !foldsCopy ? project.endedAt : undefined,
    ]);
    const time =
      state === "active" || state === "failed" ? timeOf(startedAt, undefined, nowMs) : undefined;
    steps.push({
      id: "workspace",
      label: `${mate.name}'s workspace`,
      state,
      ...optional("time", time),
      ...optional("note", state === "active" ? WORKSPACE_ABOUT : undefined),
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
  const setup = progress.setup;
  if (setup?.git !== undefined) {
    steps.push({
      id: "git",
      label: `${mate.name}'s Git access`,
      state: setup.git === "done" ? "done" : "active",
    });
  }
  const phrase = signInPhrase(mate.name);
  steps.push({
    id: "you",
    label: signInPhraseWords(phrase),
    phrase,
    state: setup?.signin === "done" ? "done" : "you",
  });
  // A Mate with no stand-up to run (a New project's first) has no step for one.
  if (setup?.standup !== undefined && setup.standup !== "none") {
    steps.push({
      id: "standup",
      label: `${mate.name} stands up development`,
      state: STANDUP_STATES[setup.standup],
    });
  }
  return steps;
}

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
