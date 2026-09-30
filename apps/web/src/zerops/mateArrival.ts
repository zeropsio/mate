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
import type { MateMarkState } from "@t3tools/shared/brand";

import {
  formatBirthElapsed,
  type BirthLineStep,
} from "../components/zerops/ZeropsBirthProgress.logic";
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
  const then = "Then you sign it in.";
  if (elapsedMs === undefined || elapsedMs < 60_000) return `About two minutes. ${then}`;
  if (elapsedMs < 120_000) return `About a minute left. ${then}`;
  return `Almost there. ${then}`;
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

/** A service of the Mate's copy of the project, on the first step's quiet line. */
export interface ArrivalService {
  readonly name: string;
  readonly state: "ok" | "busy" | "waiting" | "failed" | "empty";
}

/**
 * A step as the Mate's birth may carry it: the services its project's import brings, where the
 * birth reads them (the runtimes' import) — drawn when present, and nothing when not.
 */
export type ArrivalStepInput = BirthLineStep & {
  readonly services?: ReadonlyArray<ArrivalService> | undefined;
};

/** One step of the arrival, in the person's words. */
export interface ArrivalStep {
  readonly id: string;
  readonly label: string;
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
  "hardening",
  "mate",
  "connect",
]);

/** The steps that make its workspace, measured together: the person sees one. */
const WORKSPACE_STEP_IDS: ReadonlySet<string> = new Set([
  "container",
  "public-access",
  "hardening",
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
 * New project's Git hosting and registration), then the Mate's copy of the project — the
 * services its import brings on a quiet line under it — then its workspace (the container, its
 * address, closing it off, Mate answering, the first connect: one step to the person), then the
 * person's own sign-in, next. A New project's first Mate is the project, so its copy folds into
 * its workspace. A step's time is what its own facts measure; a step with none says none.
 */
export function arrivalSteps(
  progress: { readonly steps: ReadonlyArray<ArrivalStepInput> },
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
      ...optional(
        "services",
        project.services !== undefined && project.services.length > 0
          ? project.services
          : undefined,
      ),
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
    // From the first of its parts with a measured start, else from its project's end.
    const startedAt =
      parts.find((step) => step.startedAt !== undefined)?.startedAt ??
      (project?.state === "done" ? project.endedAt : undefined);
    const time =
      state === "active" || state === "failed" ? timeOf(startedAt, undefined, nowMs) : undefined;
    steps.push({
      id: "workspace",
      label: `${mate.name}'s workspace`,
      state,
      ...optional("time", time),
      ...optional("note", state === "active" ? WORKSPACE_ABOUT : undefined),
      ...optional("why", failed?.detail),
    });
  }
  steps.push({ id: "you", label: `You sign ${mate.name} in`, state: "you", note: "next" });
  return steps;
}

function optional<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): { readonly [K in Key]?: Value } {
  return (value === undefined ? {} : { [key]: value }) as { readonly [K in Key]?: Value };
}
