/**
 * The crew decider's working step (`Builder`, `Rejected`), whose name the engine acts in, a task's machine step and park, and the reads every family of the crew's rules shares.
 *
 * @module crew/engine/decide.step
 */
import {
  type CrewRefusalReason,
  type EffectId,
  effectId as deriveEffectId,
  type Principal,
  recordedPersonId,
  wakeId as deriveWakeId,
} from "@t3tools/contracts";
import { TASK_START, taskTransition, type TaskEvent } from "../crewMachines.ts";
import {
  CREW_EFFECT_KINDS,
  type CrewEffectDraft,
  type CrewEffectPayload,
  type CrewEnvelope,
  type LaneEnvironment,
  type LaneStatsValue,
  taskAssignment,
  type TaskRefs,
  type ToolReply,
} from "./command.ts";
import { stampCrewEvents, type CrewEventDraft, type TaskPatch } from "./events.ts";
import { evolveCrew } from "./evolve.ts";
import {
  copyBusy,
  runningRun,
  type CrewState,
  type MemberRecord,
  type PendingEffect,
  type TaskRecord,
} from "./state.ts";

/** What a press is told about a landing while the copy shows on dev. */
export const ON_DEV = "its copy shows on dev; take it back to your tree first";

export const ROTATED_TOO_OFTEN = "its conversation outgrew its context too often";

/** The board's words for the machine's own reasons to park; the crew's are words already. */
const PARK_WORDS: Readonly<Record<string, string>> = {
  reworks: "it came back for rework too often",
  rotations: ROTATED_TOO_OFTEN,
  infrastructure: "its turn broke off twice",
  "empty-merge-base": "your tree's history was rewritten",
  "disk-full": "the service's disk is full",
  "missing-object": "an object its landing needs is missing, twice",
};

export const INDEX_LOCK = "another git process holds your tree's index; try again";

/** What a press to a crewmate busy in its copy is told. */
export const busyWords = (handle: string): string =>
  `@${handle} is busy with its copy of the code; try again in a moment`;

export class Rejected {
  readonly reason: CrewRefusalReason;
  readonly detail: string | null;
  constructor(reason: CrewRefusalReason, detail: string | null = null) {
    this.reason = reason;
    this.detail = detail;
  }
}

export const wrongState = (detail: string): Rejected => new Rejected("wrong-state", detail);

/** The working step: each emitted event is folded at once, so later rules read the new state. */
export class Builder {
  state: CrewState;
  readonly events: Array<CrewEventDraft> = [];
  readonly effects: Array<CrewEffectDraft> = [];
  reply: ToolReply | undefined;
  readonly taskIds: Array<string> = [];

  readonly envelope: CrewEnvelope;
  readonly now: number;

  constructor(state: CrewState, envelope: CrewEnvelope, now: number) {
    this.state = state;
    this.envelope = envelope;
    this.now = now;
  }

  emit(draft: CrewEventDraft): void {
    const [event] = stampCrewEvents(
      this.state.headSeq,
      { conversationId: this.state.ownerId, commandId: this.envelope.commandId },
      [draft],
      this.now,
    );
    this.events.push(draft);
    this.state = evolveCrew(this.state, event!);
  }

  effect(
    payload: CrewEffectPayload,
    target: string,
    pending: Partial<Omit<PendingEffect, "kind" | "payload">> = {},
    extra: Record<string, unknown> = {},
  ): EffectId {
    const id = deriveEffectId(this.state.ownerId, payload.kind, this.state.effectSeq + 1);
    this.effects.push({
      effectId: id,
      kind: payload.kind,
      lane: `${CREW_EFFECT_KINDS[payload.kind]}/${target}`,
      class: "replay-safe",
      runId: null,
      payload,
    });
    this.emit({
      _tag: "EffectAsked",
      effectId: id,
      pending: {
        kind: payload.kind,
        handle: pending.handle ?? null,
        host: pending.host ?? null,
        taskId: pending.taskId ?? null,
        attempt: pending.attempt ?? null,
        payload: { ...payload, ...extra },
      },
    });
    return id;
  }

  arm(kind: string, key: string, dueAt: number, principal: Principal): void {
    const wakeId = deriveWakeId(this.state.ownerId, kind, key);
    if (this.state.wakes[wakeId]?.dueAt === dueAt) return;
    this.emit({
      _tag: "WakeArmed",
      wakeId,
      kind,
      dueAt,
      cron: null,
      principal,
      joins: null,
      text: null,
    });
  }

  cancel(kind: string, key: string, reason: string): void {
    const wakeId = deriveWakeId(this.state.ownerId, kind, key);
    if (this.state.wakes[wakeId] !== undefined) {
      this.emit({ _tag: "WakeCancelled", wakeId, reason });
    }
  }

  task(taskId: string): TaskRecord {
    const task = this.state.tasks[taskId];
    if (task === undefined) throw new Rejected("unknown-task", taskId);
    return task;
  }

  member(handle: string): MemberRecord {
    const member = this.state.members[handle];
    if (member === undefined) throw new Rejected("unknown-crewmate", `@${handle}`);
    return member;
  }
}

export const userOf = (principal: Principal): string =>
  principal.kind === "person"
    ? principal.subject
    : principal.kind === "crew" || principal.kind === "standup"
      ? principal.startedBy
      : "";

/** The engine acting for a person outside their session: named by their user id, never a subject. */
export const crewAs = (startedBy: string): Principal => ({
  kind: "crew",
  startedBy: recordedPersonId(startedBy),
});

/**
 * Whose a crew turn is that no press of this moment started: the running run's starter, or
 * without a run the task's creator.
 */
export const dispatchPrincipal = (state: CrewState, task: TaskRecord): Principal => {
  const run = runningRun(state);
  if (run !== undefined) return crewAs(run.startedBy);
  if (task.createdBy !== null) return crewAs(task.createdBy);
  return crewAs(state.run?.startedBy ?? "");
};

const parkWait = (reason: string) => ({
  on: "triage" as const,
  reason: PARK_WORDS[reason] ?? reason,
  paths: [],
});

/** One step of a task's machine; `undefined` when it is held or the state does not take it. */
export const step = (
  b: Builder,
  task: TaskRecord,
  event: TaskEvent,
  set: TaskPatch = {},
): TaskRecord | undefined => {
  const moved = taskTransition({ state: task.state, counters: task.counters }, event);
  if (moved.kind !== "moved") return undefined;
  b.emit({
    _tag: "TaskStepped",
    taskId: task.id,
    cause: event.type,
    from: task.state,
    to: moved.to,
    counters: moved.counters,
    set: {
      ...set,
      ...(moved.parked === undefined ? {} : { wait: parkWait(moved.parked) }),
      ...(moved.to === "working" ? { started: true } : {}),
    },
  });
  return b.state.tasks[task.id];
};

/** A step a press asked for: refused in the machine's words when the task does not take it. */
export const stepOrRefuse = (
  b: Builder,
  task: TaskRecord,
  event: TaskEvent,
  set: TaskPatch = {},
): TaskRecord => {
  const moved = taskTransition({ state: task.state, counters: task.counters }, event);
  if (moved.kind === "held") throw wrongState(moved.reason);
  if (moved.kind === "illegal") throw wrongState(`#${task.number} is ${task.state}`);
  return step(b, task, event, set)!;
};

export const park = (b: Builder, task: TaskRecord, reason: string): void => {
  step(b, task, { type: "park", reason });
};

export const createTask = (
  b: Builder,
  input: {
    readonly owner: string;
    readonly title: string;
    readonly source: TaskRecord["source"];
    readonly createdBy: string | null;
    readonly brief: string;
    readonly doneWhen: string;
    readonly note: string | null;
    readonly dependsOn: ReadonlyArray<string>;
    readonly state?: TaskRecord["state"];
  },
): TaskRecord => {
  const number = b.state.nextTaskNumber;
  const task: TaskRecord = {
    id: `task-${number}`,
    number,
    title: input.title,
    owner: input.owner,
    state: input.state ?? "queued",
    source: input.source,
    createdBy: input.createdBy === "" ? null : input.createdBy,
    createdAt: b.now,
    updatedAt: b.now,
    dependsOn: input.dependsOn,
    fresh: false,
    card: { brief: input.brief, doneWhen: input.doneWhen, note: input.note },
    counters: TASK_START,
    started: false,
    wait: null,
    report: null,
    askedAt: null,
    review: null,
    check: null,
    landedCommit: null,
    landedAt: null,
    cantStart: null,
    midway: null,
    starting: null,
    landAs: null,
    nudgedAttempt: null,
    landRetriedAttempt: null,
    checkpointing: false,
    runId: runningRun(b.state)?.id ?? null,
  };
  b.emit({ _tag: "TaskCreated", task });
  b.taskIds.push(task.id);
  return task;
};

/** A task's attempts as the board shows them: none before its first start. */
export const attemptsOf = (task: TaskRecord): number => (task.started ? task.counters.attempt : 0);

export const landed = (state: CrewState, id: string): boolean =>
  state.tasks[id]?.state === "landed";

export const statsSet = (stats: LaneStatsValue | undefined, member: MemberRecord) =>
  stats === undefined || member.lane === null ? {} : { lane: { ...member.lane, stats } };

/** What a writer's setup, check and app run with: its crew port and the crew home's `env:`. */
export const laneEnvironmentOf = (state: CrewState, member: MemberRecord): LaneEnvironment => ({
  crewPort: member.crewPort,
  env: state.applied?.definition.members.find((spec) => spec.handle === member.handle)?.env ?? {},
});

export const taskRefsOf = (task: TaskRecord): TaskRefs => ({
  assignment: taskAssignment(task),
  run: task.runId,
  attempt: task.counters.attempt,
});

export const requireApplied = (b: Builder) => {
  if (b.state.applied === null) throw new Rejected("no-crew");
  return b.state.applied;
};

export const requireFreeCopy = (b: Builder, handle: string): void => {
  if (copyBusy(b.state, handle)) throw wrongState(busyWords(handle));
};
