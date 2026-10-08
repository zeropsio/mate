/**
 * The crew owner's state on the Mate engine: one crew per Mate, folded from its own events
 * (`evolve.ts`), read by `decide.ts` and drawn by `project.ts`. Plain data, JSON all the way down:
 * the actor keeps it in memory and rebuilds it from the log.
 *
 * Each crewmate is an agent with exactly one conversation; a rotation is a new session in it, so
 * a member carries its conversation id and its current session, never a list of threads.
 *
 * @module crew/engine/state
 */
import {
  CREW_OWNER_ID,
  type ConversationId,
  type CrewApplyChoice,
  type CrewCard,
  type CrewCheck,
  type CrewClaimState,
  type CrewMemberKind,
  type CrewReview,
  type CrewRunOptions,
  type CrewRunReason,
  type CrewRunState,
  type CrewServed,
  type CrewSessionReason,
  type CrewTaskSource,
  type CrewTaskState,
  type EffectId,
  type Principal,
  type RunId,
} from "@t3tools/contracts";
import type { CrewDefinition } from "@t3tools/shared/crewHome";

import type { TaskCounters } from "../crewMachines.ts";
import type { PromptVersions } from "../crewVersions.ts";
import type { RotationReason } from "../rotationDecision.ts";

/** The login a crewmate runs on when the crew home names none. */
export const DEFAULT_CREW_LOGIN = "claudeAgent";

/** Why a crew turn exists: the card or message a delivery carried. */
export type DeliveryPurpose =
  | "task"
  | "message"
  | "continue"
  | "rework"
  | "nudge"
  | "answer"
  | "lead-wake"
  | "lead-message"
  | "claim-start"
  | "claim-release";

/** A run in a crewmate's (or the Mate's) conversation, as the crew observed it. */
export interface ActiveRun {
  readonly runId: RunId;
  readonly principal: Principal;
  /** The crew delivery that queued it; `null` for a run the crew did not send (the agent's own). */
  readonly delivery: EffectId | null;
  readonly taskId: string | null;
  readonly purpose: DeliveryPurpose | "self";
  /** Admission let it run. */
  readonly admitted: boolean;
  /** Its message reached the agent (`RunStarted`). */
  readonly reached: boolean;
  readonly since: number;
}

/** The one session a crewmate's conversation runs on now. */
export interface SessionRecord {
  /** Sessions its conversation has opened; the first is 1. */
  readonly count: number;
  /** Why the current one opened; `null` for the first. */
  readonly lastReason: CrewSessionReason | null;
  /** The prompt versions it started with; `null` before its first turn. */
  readonly running: PromptVersions | null;
  /** Whose work it serves (the first task's starter); `null` before its first task. */
  readonly principal: string | null;
  /** The login it started on. */
  readonly login: string;
  readonly compactions: number;
  readonly startedAt: number;
  /**
   * The session's cumulative cost last counted (a driver reports a session's total, not a turn's);
   * `null` once a turn of it ended uncosted, so its history is unknown. Absent, `0`.
   */
  readonly costKept?: number | null;
}

export type LaneState = "creating" | "setting-up" | "ready" | "failed" | "missing";

/** A writer's copy of the code: its lane, `.crew/<handle>` on its dev service. */
export interface LaneRecord {
  readonly branch: string;
  readonly state: LaneState;
  /** The setup command while `setting-up`; the reason while `failed`. */
  readonly detail: string | null;
  /** Against your tree, as its last git effect read it. */
  readonly stats: {
    readonly ahead: number;
    readonly insertions: number;
    readonly deletions: number;
    readonly dirty: boolean;
  } | null;
}

export interface MemberRecord {
  readonly handle: string;
  readonly kind: CrewMemberKind;
  readonly displayName: string;
  readonly tint: string | null;
  readonly login: string;
  readonly model: string | null;
  readonly effort: string | null;
  /** The dev service its copy lives on; `null` for a read-only crewmate. */
  readonly host: string | null;
  readonly check: string | null;
  readonly setup: string | null;
  readonly runCommand: string | null;
  readonly restartAfterMerge: boolean;
  readonly rotateAfter: number;
  readonly crewPort: number | null;
  readonly jobFirstLine: string;
  /** Its one conversation, named by the crew: `crew-<crew>-<handle>-<n>`. */
  readonly conversationId: ConversationId;
  readonly jobVersion: number;
  readonly session: SessionRecord;
  /** How the save that left its prompt pending applies. */
  readonly apply: CrewApplyChoice | null;
  /** A rotation owed between turns: a press or a save that found its turn running. */
  readonly rotateWhenFree: RotationReason | "budget" | null;
  /** The run its conversation runs now. */
  readonly active: ActiveRun | null;
  /** Why the run its task stood on ended, and when; `null` while one runs. */
  readonly lastEnd: { readonly at: number; readonly completed: boolean } | null;
  /**
   * Its open task goes on with these words: as `as` (a save applied at once), or, `as` `null`,
   * as the run's starter once a run is running (a pause, a restart, a task stopped mid-way).
   */
  readonly carryOn: { readonly why: string; readonly as: Principal | null } | null;
  /** The agent's last message in its latest run: a lead's reply is a question's answer. */
  readonly lastNote: { readonly runId: RunId; readonly text: string } | null;
  readonly lane: LaneRecord | null;
  readonly app: "running" | "stopped";
}

export type TaskWaitOn = "conflict" | "check-failed" | "review" | "your-tree" | "triage";

export interface TaskWait {
  readonly on: TaskWaitOn;
  readonly reason: string | null;
  readonly paths: ReadonlyArray<string>;
}

export interface TaskReport {
  readonly status: "done" | "blocked" | "progress";
  readonly summary: string;
  readonly question: string | null;
}

export interface TaskRecord {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly owner: string;
  readonly state: CrewTaskState;
  readonly source: CrewTaskSource;
  /** The Zerops user whose press or message created it; `null` for the lead's own. */
  readonly createdBy: string | null;
  readonly createdAt: number;
  /** Its last move of state. */
  readonly updatedAt: number;
  readonly dependsOn: ReadonlyArray<string>;
  readonly fresh: boolean;
  readonly card: {
    readonly brief: string;
    readonly doneWhen: string;
    readonly note: string | null;
  };
  /** The counters `taskTransition` owns, as it last left them. */
  readonly counters: TaskCounters;
  /** No attempt started yet (it never left `queued` or `proposed`). */
  readonly started: boolean;
  readonly wait: TaskWait | null;
  readonly report: TaskReport | null;
  /** When its crewmate asked its open question. */
  readonly askedAt: number | null;
  readonly review: CrewReview | null;
  readonly check: (CrewCheck & { readonly tip: string | null }) | null;
  readonly landedCommit: string | null;
  readonly landedAt: number | null;
  /** Admission refused to start it, in admission's words. */
  readonly cantStart: { readonly text: string; readonly at: number } | null;
  /** Standing `working` with no turn running: since when, and why its last turn ended. */
  readonly midway: {
    readonly since: number;
    readonly why: string | null;
    /** How the attempt ended (`no-report`, `run-paused`, …); absent when it did not end. */
    readonly ending?: string;
  } | null;
  /** Each attempt's row, oldest first: kept by `evolve` as the task moves. */
  readonly attemptRows?: ReadonlyArray<AttemptRow>;
  /** Its first turn is being prepared: the copy reset, the card on its way. */
  readonly starting: {
    readonly principal: Principal;
    readonly ownCall: boolean;
  } | null;
  /** Lands once ready, as this principal: *Land now*, or *Land* on a task whose tree moved. */
  readonly landAs: Principal | null;
  /** The attempt its run's one nudge went to. */
  readonly nudgedAttempt: number | null;
  /** The attempt whose landing already took its one retry after a missing object. */
  readonly landRetriedAttempt: number | null;
  /** A turn end waits for its checkpoint before the task moves. */
  readonly checkpointing: boolean;
  /** The crew run it was created in. */
  readonly runId: string | null;
  /** The turns its attempt was sent so far, for its WIP commits' subjects. */
  readonly turns?: { readonly attempt: number; readonly count: number };
}

/** One attempt at a task: how and when it ended (open while `endedAt` is `null`), what it cost. */
export interface AttemptRow {
  readonly attempt: number;
  readonly ending: string | null;
  readonly endingDetail: string | null;
  readonly costUsd: number;
  readonly endedAt: number | null;
}

/**
 * A task's attempt rows after a change: a row for the attempt it started, closed when a turn left
 * it mid-way with an ending, open again when it goes on.
 */
export const attemptRowsOf = (before: TaskRecord | undefined, after: TaskRecord): TaskRecord => {
  if (!after.started || after.counters.attempt === 0) return after;
  let rows = [...(after.attemptRows ?? [])];
  const attempt = after.counters.attempt;
  if (!rows.some((row) => row.attempt === attempt)) {
    rows.push({ attempt, ending: null, endingDetail: null, costUsd: 0, endedAt: null });
  }
  const at = rows.findIndex((row) => row.attempt === attempt);
  const row = rows[at]!;
  const midway = after.midway;
  if (midway?.ending !== undefined && row.endedAt === null && midway !== before?.midway) {
    rows[at] = { ...row, ending: midway.ending, endingDetail: midway.why, endedAt: midway.since };
  } else if (midway === null && before?.midway != null && row.endedAt !== null) {
    rows[at] = { ...row, ending: null, endingDetail: null, endedAt: null };
  }
  rows = rows.toSorted((a, b) => a.attempt - b.attempt);
  return { ...after, attemptRows: rows };
};

/** The number of the turn a task's attempt is in: 1 before any was counted. */
export const turnOf = (task: TaskRecord): number =>
  task.turns?.attempt === task.counters.attempt ? task.turns.count : 1;

export interface RunRecord {
  readonly id: string;
  readonly state: CrewRunState;
  readonly reason: CrewRunReason | null;
  readonly reasonDetail: string | null;
  readonly startedBy: string;
  readonly startedAt: number;
  readonly options: CrewRunOptions;
  readonly spentUsd: number;
  /** The time the crew worked and the run kept; `since` counts on while a crew turn runs. */
  readonly keptMs: number;
  readonly since: number | null;
  /** The lead's wakes in this run. */
  readonly leadWakes: number;
}

/** A wake the lead was given, by its key; the lead's next run serves it. */
export interface LeadWake {
  readonly key: string;
  readonly kind: "review" | "question";
  readonly taskId: string;
}

export interface LeadRecord {
  /** The engine's last wake of the lead; a person's Start or Resume clears it. */
  readonly lastWakeAt: number | null;
  /** Reviews and questions the lead was woken for. */
  readonly woken: Readonly<Record<string, true>>;
  /** The wake the lead's running (or next) turn serves. */
  readonly serving: LeadWake | null;
  /** Questions the lead passed on to the person. */
  readonly escalated: Readonly<Record<string, true>>;
  /** The lead's own questions for the person, by its handle. */
  readonly questions: Readonly<Record<string, { readonly text: string; readonly at: number }>>;
  /** Who last spoke to the lead, for a plan made outside a run. */
  readonly spokenBy: string | null;
}

export interface ClaimRecord {
  readonly state: CrewClaimState;
  readonly handle: string;
  readonly requestedAt: number;
  readonly reason: string | null;
  /** Allowed while the crewmate's turn ran: the claim turn goes out at its end. */
  readonly grantWaiting: boolean;
  /** The dev server the claim restarts, as the grant read it. */
  readonly devServer: { readonly port: number; readonly command: string } | null;
  readonly workDir: string | null;
  /** Whose press or run allowed it. */
  readonly grantedBy: Principal | null;
}

export interface HostRecord {
  readonly frozenSince: number | null;
  readonly crewPorts: ReadonlyArray<{ readonly port: number; readonly routed: boolean | null }>;
  readonly served: CrewServed;
  readonly integration: { readonly branch: string | null; readonly head: string } | null;
  /** The redeploy's reads so far, for the backoff. */
  readonly polls: number;
  /** Since when its redeploy could not be read, as the reads after a restart found it. */
  readonly unknownSince?: number | null;
}

/**
 * How a host frozen by a redeploy a restart cut off is read again: the first wait, doubling to
 * the longest; after `thawOfferMs` of answers that cannot be read the person is offered a thaw.
 */
export interface CrewTiming {
  readonly deployPollFirstMs: number;
  readonly deployPollMaxMs: number;
  readonly thawOfferMs: number;
}

export const DEFAULT_CREW_TIMING: CrewTiming = {
  deployPollFirstMs: 15_000,
  deployPollMaxMs: 5 * 60_000,
  thawOfferMs: 30 * 60_000,
};

/** What a crew effect is for, kept until it settles. */
export interface PendingEffect {
  readonly kind: string;
  readonly handle: string | null;
  readonly host: string | null;
  readonly taskId: string | null;
  readonly attempt: number | null;
  readonly payload: unknown;
}

/** A delivery to a conversation, kept until its run is known and reached. */
export interface DeliveryRecord {
  readonly handle: string | null;
  readonly conversationId: ConversationId;
  readonly purpose: DeliveryPurpose | "stop" | "rotate" | "assign" | "archive" | "seam";
  readonly taskId: string | null;
  readonly principal: Principal;
  /** The words a Send carried, sent again in its own words when a restart cut it unsent. */
  readonly text: string | null;
  readonly card: CrewCard | null;
  readonly runId: RunId | null;
}

/** An effect that failed for good: a row the person sees and may continue or drop. */
export interface AttentionRecord {
  readonly id: string;
  readonly handle: string | null;
  readonly taskId: string | null;
  readonly text: string;
  readonly at: number;
}

export interface AppliedCrew {
  readonly definition: CrewDefinition;
  readonly briefVersion: number;
}

export interface CrewState {
  readonly ownerId: ConversationId;
  readonly headSeq: number;
  readonly applied: AppliedCrew | null;
  /** In the crew home's order. */
  readonly order: ReadonlyArray<string>;
  readonly members: Readonly<Record<string, MemberRecord>>;
  /** The `n` of each handle's conversation, so a handle added again gets a new one. */
  readonly ordinals: Readonly<Record<string, number>>;
  readonly tasks: Readonly<Record<string, TaskRecord>>;
  readonly nextTaskNumber: number;
  readonly run: RunRecord | null;
  readonly lead: LeadRecord;
  readonly claims: Readonly<Record<string, ClaimRecord>>;
  readonly hosts: Readonly<Record<string, HostRecord>>;
  /** Each login's fullest usage window, from the gauges. */
  readonly usage: Readonly<Record<string, number>>;
  /** One cursor per observed conversation. */
  readonly cursors: Readonly<Record<string, number>>;
  /** The Mate's own conversation and the run it runs now: a landing waits for it. */
  readonly mate: { readonly conversationId: ConversationId | null; readonly runId: RunId | null };
  readonly effects: Readonly<Record<string, PendingEffect>>;
  readonly deliveries: Readonly<Record<string, DeliveryRecord>>;
  /** Armed wakes, by id. */
  readonly wakes: Readonly<
    Record<
      string,
      {
        readonly kind: string;
        readonly dueAt: number;
        /** The arming's own seq: a fire the scheduler read from an older arming is stale. */
        readonly armedSeq?: number;
      }
    >
  >;
  /** Effects asked so far: the next one's ordinal. */
  readonly effectSeq: number;
  /** A landing held, and the words it was held in: said once. */
  readonly heldLandings: Readonly<Record<string, string>>;
  readonly attention: ReadonlyArray<AttentionRecord>;
  readonly lastError: string | null;
  /** The crew's timing as the wiring set it; absent, the defaults. */
  readonly timing?: CrewTiming;
}

export const EMPTY_LEAD: LeadRecord = {
  lastWakeAt: null,
  woken: {},
  serving: null,
  escalated: {},
  questions: {},
  spokenBy: null,
};

export const initialCrewState = (ownerId: ConversationId = CREW_OWNER_ID): CrewState => ({
  ownerId,
  headSeq: 0,
  applied: null,
  order: [],
  members: {},
  ordinals: {},
  tasks: {},
  nextTaskNumber: 1,
  run: null,
  lead: EMPTY_LEAD,
  claims: {},
  hosts: {},
  usage: {},
  cursors: {},
  mate: { conversationId: null, runId: null },
  effects: {},
  deliveries: {},
  wakes: {},
  effectSeq: 0,
  heldLandings: {},
  attention: [],
  lastError: null,
});

/* ------------------------------------------------------------ reads */

/** Tasks a crewmate is not working on. */
const NOT_OPEN: ReadonlySet<CrewTaskState> = new Set([
  "proposed",
  "queued",
  "landed",
  "parked",
  "discarded",
]);

/** The one task a crewmate works on: not proposed, queued, landed, parked or discarded. */
export const isOpenTask = (state: CrewTaskState): boolean => !NOT_OPEN.has(state);

export const tasksInOrder = (state: CrewState): ReadonlyArray<TaskRecord> =>
  Object.values(state.tasks).toSorted((a, b) => a.number - b.number);

export const tasksOf = (state: CrewState, handle: string): ReadonlyArray<TaskRecord> =>
  tasksInOrder(state).filter((task) => task.owner === handle);

export const openTaskOf = (state: CrewState, handle: string): TaskRecord | undefined =>
  tasksOf(state, handle).find((task) => isOpenTask(task.state));

export const membersInOrder = (state: CrewState): ReadonlyArray<MemberRecord> =>
  state.order.flatMap((handle) => {
    const member = state.members[handle];
    return member === undefined ? [] : [member];
  });

export const leadOf = (state: CrewState): MemberRecord | undefined =>
  membersInOrder(state).find((member) => member.kind === "lead");

export const runningRun = (state: CrewState): RunRecord | undefined =>
  state.run?.state === "running" ? state.run : undefined;

/** A run is on: running or paused. */
export const runOn = (state: CrewState): RunRecord | undefined =>
  state.run?.state === "running" || state.run?.state === "paused" ? state.run : undefined;

/** The lead takes the crew's questions first: a run is running and the crew has a lead. */
export const leadAnswers = (state: CrewState): boolean =>
  runningRun(state) !== undefined && leadOf(state) !== undefined;

/** A passed check goes to the lead's review: a run is on, it lands after the lead's review, and there is a lead. */
export const leadReviews = (state: CrewState): boolean => {
  const run = runOn(state);
  return run !== undefined && run.options.landing === "lead" && leadOf(state) !== undefined;
};

/** The crew effects git work runs as: each holds its crewmate's copy while it runs. */
export const COPY_EFFECTS: ReadonlySet<string> = new Set([
  "crew.lane.create",
  "crew.lane.reset",
  "crew.lane.keep",
  "crew.lane.remove",
  "crew.checkpoint",
  "crew.mergeIn",
  "crew.check",
  "crew.land",
  "crew.sweep",
]);

/** A git effect holds the crewmate's copy: a press to it is refused as busy. */
export const copyBusy = (state: CrewState, handle: string): boolean =>
  Object.values(state.effects).some(
    (effect) => effect.handle === handle && COPY_EFFECTS.has(effect.kind),
  );

/** A git effect writes the crewmate's copy now (a check only reads it). */
export const copyWriting = (state: CrewState, handle: string): boolean =>
  Object.values(state.effects).some(
    (effect) =>
      effect.handle === handle && COPY_EFFECTS.has(effect.kind) && effect.kind !== "crew.check",
  );

/** A delivery to the crewmate is on its way: a turn is about to run. */
export const delivering = (state: CrewState, handle: string): boolean =>
  Object.values(state.deliveries).some(
    (delivery) =>
      delivery.handle === handle && delivery.runId === null && isTurnPurpose(delivery.purpose),
  );

export const isTurnPurpose = (purpose: DeliveryRecord["purpose"]): purpose is DeliveryPurpose =>
  purpose !== "stop" &&
  purpose !== "rotate" &&
  purpose !== "assign" &&
  purpose !== "archive" &&
  purpose !== "seam";

/** The crewmate's conversation runs a turn, or one is on its way. */
export const isWorking = (state: CrewState, handle: string): boolean =>
  state.members[handle]?.active != null || delivering(state, handle);

/** A crewmate the crew may hand a turn to now: nothing runs in its conversation or its copy. */
export const isFree = (state: CrewState, handle: string): boolean =>
  !isWorking(state, handle) &&
  !copyBusy(state, handle) &&
  !Object.values(state.tasks).some((task) => task.owner === handle && task.starting !== null);

export const hostFrozen = (state: CrewState, host: string | null): boolean =>
  host !== null && (state.hosts[host]?.frozenSince ?? null) !== null;

/** The crewmate's copy shows on its dev service: a landing would pull the floor from under it. */
export const laneShown = (state: CrewState, handle: string): boolean =>
  Object.values(state.claims).some(
    (claim) =>
      claim.handle === handle &&
      (claim.state === "starting" || claim.state === "held" || claim.state === "releasing"),
  );

/** The fullest usage window of the crewmates' logins; `null` before any reading. */
export const usagePercentOf = (state: CrewState): number | null => {
  const readings = membersInOrder(state).flatMap((member) => {
    const reading = state.usage[member.login];
    return reading === undefined ? [] : [reading];
  });
  return readings.length === 0 ? null : Math.max(...readings);
};

/** The run's clock at `nowMs`: what it kept, and what it counts on since. */
export const runElapsedMs = (run: RunRecord, nowMs: number): number =>
  run.keptMs + (run.since === null ? 0 : Math.max(0, nowMs - run.since));

/**
 * What a crew session may spend: what the run's budget has left, while a run with a dollar budget
 * is on; `null` sets no cap (no run, or *No limit*). The crewmate profile's `maxBudgetUsd`.
 */
export const sessionBudgetUsd = (state: CrewState): number | null => {
  const run = runOn(state);
  if (run === undefined || run.options.budgetUsd === "unlimited") return null;
  return Math.max(0, run.options.budgetUsd - run.spentUsd);
};

/** The conversation id a crewmate is named by at Apply; `n` rises when a removed handle returns. */
export const crewmateConversationId = (crew: string, handle: string, n: number): string =>
  `crew-${crew}-${handle}-${n}`;

/** A question's key, once per asking. */
export const questionKey = (task: Pick<TaskRecord, "id" | "askedAt">): string =>
  `question:${task.id}:${task.askedAt ?? 0}`;

/** A review's key, once per attempt. */
export const reviewKey = (task: Pick<TaskRecord, "id" | "counters">): string =>
  `review:${task.id}:${task.counters.attempt}`;
