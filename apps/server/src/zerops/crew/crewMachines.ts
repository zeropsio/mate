/**
 * crewMachines — the four crew state machines of ARCHITECTURE §4 (task, run,
 * stint, Show-on-dev claim), amended by the PRD: a task can be `proposed`
 * (§5.4), a person's message moves a finished-but-unlanded task back to work
 * (§5.2), a check without a reviewer goes straight to `ready` (§6.3), and
 * nothing waits on a turn slot (Δ14).
 *
 * Each machine is a pure function of a state and an event. It answers with the
 * next state (`moved`), a named reason a guard keeps it where it is (`held`),
 * or `illegal` for an event the state does not take. The machines own the
 * counters and caps of their rows; every action a row names in parentheses —
 * a card, a WIP commit, a reset, a backoff — is the engine's to perform.
 *
 * @module crewMachines
 */
import type {
  CrewClaimState,
  CrewRunOptions,
  CrewRunReason,
  CrewRunState,
  CrewStintState,
  CrewTaskSource,
  CrewTaskState,
  ProviderRuntimeTurnStatus,
} from "@t3tools/contracts";

import { type RotationReason } from "./rotationDecision.ts";

export type Illegal<S> = {
  readonly kind: "illegal";
  readonly from: S;
  readonly event: string;
};

export type Held<R extends string> = { readonly kind: "held"; readonly reason: R };

/* ------------------------------------------------------------------ claim */

export const CLAIM_EVENTS = [
  "request",
  "grant",
  "deny",
  "timeout",
  "serves-lane",
  "serves-other",
  "turn-failed",
  "report",
  "press",
  "person-dev-server",
  "self-deploy",
  "serves-tree",
] as const;
export type ClaimEvent = (typeof CLAIM_EVENTS)[number];

const CLAIM_TABLE: Readonly<
  Record<CrewClaimState, Partial<Readonly<Record<ClaimEvent, CrewClaimState>>>>
> = {
  none: { request: "requested" },
  requested: { grant: "starting", deny: "none", timeout: "none" },
  starting: { "serves-lane": "held", "turn-failed": "releasing", "serves-other": "releasing" },
  held: {
    report: "releasing",
    press: "releasing",
    timeout: "releasing",
    "person-dev-server": "none",
    "self-deploy": "none",
  },
  releasing: { "serves-tree": "none", "turn-failed": "release-failed" },
  "release-failed": { "serves-tree": "none" },
};

/**
 * One Show-on-dev claim per dev host. `serves-*` events come from reading what
 * the dev server's process runs in, never from the engine's own record;
 * `person-dev-server` and `self-deploy` end a held claim because the person
 * wins (CONCEPT §3.3).
 */
export const claimTransition = (
  from: CrewClaimState,
  event: ClaimEvent,
): { readonly kind: "moved"; readonly to: CrewClaimState } | Illegal<CrewClaimState> => {
  const to = CLAIM_TABLE[from][event];
  return to === undefined ? { kind: "illegal", from, event } : { kind: "moved", to };
};

/* -------------------------------------------------------------------- run */

/**
 * Why a run paused: the person's press, a dispatch admission refused (not the
 * login's signer, or no longer a member), its budget, the usage window option
 * ("Stop at 80 % of the usage window"), or its time limit. A limit set to
 * *No limit* never pauses it (PRD Δ16).
 */
export type RunPauseReason = "person" | "admission" | "budget" | "usage" | "time-limit";

export type RunEvent =
  | { readonly type: "start"; readonly admitted: boolean; readonly lanesReady: boolean }
  | { readonly type: "pause"; readonly reason: RunPauseReason }
  | { readonly type: "resume"; readonly admitted: boolean }
  | { readonly type: "finish" }
  | { readonly type: "cleaned" }
  | { readonly type: "stop" };

export type RunStep =
  | { readonly kind: "moved"; readonly to: CrewRunState; readonly reason?: RunPauseReason }
  | Held<"admission" | "lanes">
  | Illegal<CrewRunState | "none">;

/**
 * A run is what lets the crew start its own turns (PRD §2.4); manual work has
 * none. `finish` is every *Done when* line citing a landing, or the lead's
 * `crew_finish` accepted; `cleaned` is the clean lanes removed.
 */
export const runTransition = (from: CrewRunState | "none", event: RunEvent): RunStep => {
  const illegal: Illegal<CrewRunState | "none"> = { kind: "illegal", from, event: event.type };
  switch (event.type) {
    case "start":
      if (from !== "none") return illegal;
      if (!event.admitted) return { kind: "held", reason: "admission" };
      if (!event.lanesReady) return { kind: "held", reason: "lanes" };
      return { kind: "moved", to: "running" };
    case "pause":
      return from === "running" ? { kind: "moved", to: "paused", reason: event.reason } : illegal;
    case "resume":
      if (from !== "paused") return illegal;
      return event.admitted
        ? { kind: "moved", to: "running" }
        : { kind: "held", reason: "admission" };
    case "finish":
      return from === "running" ? { kind: "moved", to: "finishing" } : illegal;
    case "cleaned":
      return from === "finishing" ? { kind: "moved", to: "finished" } : illegal;
    case "stop":
      return from === "running" || from === "paused" ? { kind: "moved", to: "stopped" } : illegal;
  }
};

/* ------------------------------------------------------------------ stint */

export type StintEvent =
  | { readonly type: "open" }
  | { readonly type: "turn-start" }
  | { readonly type: "rotate-pending"; readonly reason: RotationReason }
  | { readonly type: "retire"; readonly reason: RotationReason };

export type StintStep =
  | { readonly kind: "moved"; readonly to: CrewStintState; readonly reason?: RotationReason }
  | Illegal<CrewStintState | "none">;

/**
 * A stint is one conversation of a standing crewmate: one Mate thread over one
 * Claude session. `open` is a first dispatch or a rotation; `turn-start`
 * includes a resume with its transcript present; a pending stint keeps
 * working its task until `rotationDecision` finds the rotation due, and then
 * the engine sends `retire` — archive, then stop its session. Retired is
 * terminal: admission refuses its turns.
 */
export const stintTransition = (from: CrewStintState | "none", event: StintEvent): StintStep => {
  const illegal: Illegal<CrewStintState | "none"> = { kind: "illegal", from, event: event.type };
  switch (event.type) {
    case "open":
      return from === "none" ? { kind: "moved", to: "open" } : illegal;
    case "turn-start":
      if (from === "open" || from === "active") return { kind: "moved", to: "active" };
      return from === "rotate-pending" ? { kind: "moved", to: "rotate-pending" } : illegal;
    case "rotate-pending":
      return from === "active" || from === "rotate-pending"
        ? { kind: "moved", to: "rotate-pending", reason: event.reason }
        : illegal;
    case "retire":
      return from === "open" || from === "active" || from === "rotate-pending"
        ? { kind: "moved", to: "retired", reason: event.reason }
        : illegal;
  }
};

/* ------------------------------------------------------------------- task */

/** Reworks per task (a conflict counts), and selected landing re-merges. */
export const CREW_REWORKS_MAX = 2;
export const CREW_REMERGES_MAX = 3;

export interface TaskCounters {
  /** The attempt in progress; an explicit rework starts the next one. */
  readonly attempt: number;
  readonly reworks: number;
  /** Re-merges of the current landing because H moved. */
  readonly remerges: number;
  /** Rotation endings in the current attempt. */
  readonly rotations: number;
}

export const TASK_START: TaskCounters = {
  attempt: 1,
  reworks: 0,
  remerges: 0,
  rotations: 0,
};

export interface CrewTask {
  readonly state: CrewTaskState;
  readonly counters: TaskCounters;
}

/** What a dispatch needs; there is no turn slot to wait for (PRD Δ14). */
export interface DispatchFacts {
  readonly dependenciesLanded: boolean;
  readonly laneIdle: boolean;
  readonly hostFrozen: boolean;
  readonly admitted: boolean;
}

/** What a landing needs (ARCHITECTURE §5 *land*). */
export interface LandFacts {
  readonly personTurnRunning: boolean;
  readonly hostFrozen: boolean;
  readonly laneShown: boolean;
  readonly lockTaken: boolean;
}

export type TaskEvent =
  | { readonly type: "accept" }
  | { readonly type: "dispatch"; readonly facts: DispatchFacts }
  | { readonly type: "message" }
  | { readonly type: "turn-ended" }
  | { readonly type: "report-blocked" }
  | { readonly type: "report-done" }
  | { readonly type: "land-now" }
  | { readonly type: "merge-clean" }
  | { readonly type: "merge-conflict" }
  | { readonly type: "merge-empty-base" }
  | { readonly type: "check-passed"; readonly reviewed: boolean }
  | { readonly type: "check-failed" }
  | { readonly type: "review-accepted" }
  | { readonly type: "review-rejected" }
  | { readonly type: "land"; readonly facts: LandFacts }
  | { readonly type: "trailer-found" }
  | { readonly type: "fast-forward" }
  | { readonly type: "head-moved" }
  | { readonly type: "not-fast-forward" }
  | { readonly type: "dirty-tree" }
  | { readonly type: "untracked-in-way" }
  | { readonly type: "index-lock" }
  | { readonly type: "missing-object" }
  | { readonly type: "disk-full" }
  | { readonly type: "tree-clean" }
  | { readonly type: "wait-expired" }
  | { readonly type: "after-land" }
  | { readonly type: "park"; readonly reason: string }
  | { readonly type: "retry" }
  | { readonly type: "discard" };

export type TaskHoldReason =
  | "dependencies"
  | "lane-busy"
  | "host-frozen"
  | "admission"
  | "person-turn"
  | "lane-shown"
  | "lock";

/** A parked task's reason: the machine's own caps, or the engine's `park` reason. */
export type TaskStep =
  | {
      readonly kind: "moved";
      readonly to: CrewTaskState;
      readonly counters: TaskCounters;
      readonly parked?: string;
    }
  | Held<TaskHoldReason>
  | Illegal<CrewTaskState>;

/**
 * How a crew turn ended, by the driver's terminal reason (SPI 2.5; CONCEPT
 * §5 *Endings*): the context overflowed (`rotation`: a new conversation
 * takes the task on), the provider or the session setup failed
 * (`infrastructure`: the task queues again once), the run's budget ran out
 * (`budget`: the run pauses), or the agent ended it (`agent`). A reason this
 * build does not know is the agent's.
 */
export type TurnEnding = "rotation" | "infrastructure" | "budget" | "agent";

const TURN_ENDINGS: Readonly<Record<string, TurnEnding>> = {
  prompt_too_long: "rotation",
  rapid_refill_breaker: "rotation",
  // An ACP agent's turn that ran out of tokens (`acpTerminalReason`).
  max_tokens: "rotation",
  api_error: "infrastructure",
  model_error: "infrastructure",
  turn_setup_failed: "infrastructure",
  budget_exhausted: "budget",
};

export const turnEndingOf = (terminalReason: string | undefined): TurnEnding =>
  (terminalReason === undefined ? undefined : TURN_ENDINGS[terminalReason]) ?? "agent";

/** A turn that ended without the crewmate's report: its task stands `working`. */
export const NO_REPORT = {
  ending: "no-report",
  detail: "its turn ended without a report",
} as const;

/** The limits a run's stop names: what it may spend, for how long, how near the plan's limit. */
export type RunStopLimits = Pick<
  CrewRunOptions,
  "budgetUsd" | "timeLimitHours" | "stopAtUsagePercent"
>;

const dollarsWord = (usd: number): string =>
  `$${Number.isInteger(usd) ? String(usd) : usd.toFixed(2)}`;

/**
 * Why a task stopped mid-way when the crew stopped working on its own, as its
 * row says it: "Stopped mid-way when the $20 ran out." — a clause opening
 * with *when*, in the person's words and with the limit's own figure. No
 * engine noun: the person never meets a *run*.
 */
const runStopWords = (reason: CrewRunReason, limits: RunStopLimits | undefined): string => {
  switch (reason) {
    case "person":
      return "when you stopped it";
    case "budget":
      return typeof limits?.budgetUsd === "number"
        ? `when the ${dollarsWord(limits.budgetUsd)} ran out`
        : "when the money it may spend ran out";
    case "time":
      return typeof limits?.timeLimitHours === "number"
        ? `when the ${limits.timeLimitHours} ${limits.timeLimitHours === 1 ? "hour" : "hours"} ran out`
        : "when its time ran out";
    case "usage":
      return typeof limits?.stopAtUsagePercent === "number"
        ? `when it neared ${limits.stopAtUsagePercent} % of your Claude plan's limit`
        : "when it neared your Claude plan's limit";
    case "refused":
      return "when its next turn was refused";
  }
};

/**
 * How a turn that left its task `working` ends the task's attempt, and the
 * words for why: its session spent what the run may spend, the crew stopped
 * working on its own, something else interrupted it, it failed, or the
 * crewmate ended it without a report. The next turn of the attempt opens it
 * again.
 */
export const attemptEndingOf = (input: {
  readonly state: ProviderRuntimeTurnStatus;
  readonly terminalReason: string | undefined;
  readonly errorMessage: string | undefined;
  readonly run:
    | {
        readonly state: CrewRunState;
        readonly reason: CrewRunReason | null;
        /** The run's limits; `undefined` when its options no longer read. */
        readonly limits: RunStopLimits | undefined;
      }
    | undefined;
}): { readonly ending: string; readonly detail: string } => {
  if (turnEndingOf(input.terminalReason) === "budget") {
    return { ending: "budget", detail: runStopWords("budget", input.run?.limits) };
  }
  switch (input.state) {
    case "interrupted":
    case "cancelled":
      if (input.run?.state === "paused") {
        return {
          ending: "run-paused",
          detail: runStopWords(input.run.reason ?? "person", input.run.limits),
        };
      }
      return input.run?.state === "stopped"
        ? { ending: "run-stopped", detail: runStopWords("person", input.run.limits) }
        : { ending: "interrupted", detail: "its turn was interrupted" };
    case "failed":
      return { ending: "failed", detail: input.errorMessage ?? "its turn failed" };
    case "completed":
      return NO_REPORT;
  }
};

/**
 * A lead's plan waits for the person's Start unless the run lets the lead
 * start tasks without asking (PRD §5.4); every other task is queued.
 */
export const initialTaskState = (input: {
  readonly source: CrewTaskSource;
  readonly leadMayStart: boolean;
}): CrewTaskState => (input.source === "lead" && !input.leadMayStart ? "proposed" : "queued");

const TERMINAL: ReadonlySet<CrewTaskState> = new Set(["landed", "discarded"]);
const RETURNS_TO_WORK_ON_MESSAGE: ReadonlySet<CrewTaskState> = new Set([
  "working",
  "blocked",
  "checking",
  "review",
  "ready",
  "waiting-on-you",
]);

const dispatchHold = (facts: DispatchFacts): TaskHoldReason | undefined =>
  !facts.dependenciesLanded
    ? "dependencies"
    : !facts.laneIdle
      ? "lane-busy"
      : facts.hostFrozen
        ? "host-frozen"
        : !facts.admitted
          ? "admission"
          : undefined;

const landHold = (facts: LandFacts): TaskHoldReason | undefined =>
  facts.personTurnRunning
    ? "person-turn"
    : facts.hostFrozen
      ? "host-frozen"
      : facts.laneShown
        ? "lane-shown"
        : !facts.lockTaken
          ? "lock"
          : undefined;

/**
 * One task through its states. A person's message returns a task that
 * reported but has not landed to work (PRD §5.2); in `rework` it is the
 * rework's dispatch, admitted by the engine's `message` path. `land-now` is
 * *Land* pressed before the crewmate reported (PRD §5.2 step 5′), or on a
 * task back for rework: the copy lands as it stands if it merges and checks.
 * `retry` is the person's *Try again* on a stopped task: a fresh attempt in
 * the queue.
 */
export const taskTransition = (task: CrewTask, event: TaskEvent): TaskStep => {
  const { state: from, counters } = task;
  const illegal: Illegal<CrewTaskState> = { kind: "illegal", from, event: event.type };
  const to = (state: CrewTaskState, next: TaskCounters = counters): TaskStep => ({
    kind: "moved",
    to: state,
    counters: next,
  });
  const park = (reason: string): TaskStep => ({
    kind: "moved",
    to: "parked",
    counters,
    parked: reason,
  });
  const rework = (): TaskStep => to("rework", { ...counters, reworks: counters.reworks + 1 });
  const nextAttempt = (): TaskStep =>
    counters.reworks > CREW_REWORKS_MAX
      ? park("reworks")
      : to("working", { ...counters, attempt: counters.attempt + 1, remerges: 0, rotations: 0 });

  switch (event.type) {
    case "accept":
      return from === "proposed" ? to("queued") : illegal;
    case "dispatch": {
      if (from !== "queued" && from !== "rework") return illegal;
      const hold = dispatchHold(event.facts);
      if (hold) return { kind: "held", reason: hold };
      return from === "queued" ? to("working") : nextAttempt();
    }
    case "message":
      if (from === "rework") return nextAttempt();
      return RETURNS_TO_WORK_ON_MESSAGE.has(from) ? to("working") : illegal;
    case "turn-ended":
      return from === "working" ? to("working") : illegal;
    case "report-blocked":
      return from === "working" ? to("blocked") : illegal;
    case "report-done":
      return from === "working" ? to("merging") : illegal;
    case "land-now":
      return from === "working" || from === "rework" ? to("merging") : illegal;
    case "merge-clean":
      return from === "merging" ? to("checking") : illegal;
    case "merge-conflict":
      return from === "merging" ? rework() : illegal;
    case "merge-empty-base":
      return from === "merging" ? park("empty-merge-base") : illegal;
    case "check-passed":
      return from === "checking" ? to(event.reviewed ? "review" : "ready") : illegal;
    case "check-failed":
      return from === "checking" ? rework() : illegal;
    case "review-accepted":
      return from === "review" ? to("ready") : illegal;
    case "review-rejected":
      return from === "review" ? rework() : illegal;
    case "land": {
      if (from !== "ready") return illegal;
      const hold = landHold(event.facts);
      return hold ? { kind: "held", reason: hold } : to("landing");
    }
    case "trailer-found":
    case "fast-forward":
      return from === "landing" ? to("landed") : illegal;
    case "head-moved":
      if (from !== "landing") return illegal;
      return counters.remerges >= CREW_REMERGES_MAX
        ? rework()
        : to("merging", { ...counters, remerges: counters.remerges + 1 });
    case "not-fast-forward":
      return from === "landing" ? to("merging") : illegal;
    case "dirty-tree":
    case "untracked-in-way":
      return from === "landing" ? to("waiting-on-you") : illegal;
    case "index-lock":
    case "missing-object":
      return from === "landing" ? to("ready") : illegal;
    case "disk-full":
      return from === "landing" ? park("disk-full") : illegal;
    case "tree-clean":
      return from === "waiting-on-you" ? to("merging") : illegal;
    case "wait-expired":
      return from === "waiting-on-you" ? to("ready") : illegal;
    case "after-land":
      return from === "landed" ? to("landed") : illegal;
    case "park":
      return TERMINAL.has(from) || from === "proposed" || from === "parked"
        ? illegal
        : park(event.reason);
    case "retry":
      return from === "parked"
        ? to("queued", {
            ...counters,
            attempt: counters.attempt + 1,
            reworks: 0,
            remerges: 0,
            rotations: 0,
          })
        : illegal;
    case "discard":
      return TERMINAL.has(from) ? illegal : to("discarded");
  }
};
