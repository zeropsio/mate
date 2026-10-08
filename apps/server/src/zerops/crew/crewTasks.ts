import {
  acknowledgeOperations,
  beginOperation,
  operationHolds,
  operationStep,
  updateOperation,
  finishOperation,
} from "./crewOperations.ts";
import type { CrewOperation } from "@t3tools/contracts";
/**
 * crewTasks — tasks and the turns that work them, without a run (PRD §5.2,
 * §5.2a, §5.3, §6).
 *
 * - **A message** to a crewmate steers its running turn, or opens an
 *   implicit task when it has none (the message is the card), or is the next
 *   turn of its open task. Admission comes first, as the caller, against the
 *   crewmate's login; a refusal changes nothing.
 * - **A task** created for a busy crewmate waits `queued`; when its crewmate
 *   frees up (its task lands, parks or is discarded) the oldest queued task
 *   whose dependencies landed starts, as the person who created it. A refusal
 *   leaves it queued with a *Can't start* row.
 * - **Tell the crew** without a lead: one task per mentioned crewmate, each
 *   carrying the whole message (`routeCrewMessage`).
 *
 * A crewmate works one task at a time; a stint rotates at a task's start or a
 * turn's when `rotationDecision` finds it due (probe 22 failed: a changed
 * prompt reaches a crewmate only in a new conversation).
 *
 * @module crewTasks
 */
import type {
  ChatAttachment,
  OrchestrationCommand,
  CrewCommandError,
  CrewTaskSource,
  CrewTaskState,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { TurnPrincipal } from "../ZeropsTurnAdmission.ts";
import { refreshLaneStats } from "./crewLanding.ts";
import { carriedCard, continueCard, taskCard } from "./crewCards.ts";
import {
  asRefusal,
  currentStint,
  dispatchPrincipal,
  isWorking,
  memberOf,
  principalUser,
  refuse,
  requireApplied,
  requireMember,
  runningRun,
  type AppliedCrew,
  type CrewCore,
  type CrewMember,
  type PendingContinue,
} from "./crewCore.ts";
import {
  admitCrewTurn,
  crewTurnCommand,
  dispatchCrewTurn,
  modelSelectionFor,
} from "./CrewDispatch.ts";
import { CREW_ID } from "./CrewHome.ts";
import { taskTransition, type TaskCounters, type TaskEvent } from "./crewMachines.ts";
import { implicitTaskTitle, routeCrewMessage } from "./crewRouting.ts";
import { followCrewWork, pauseRun } from "./crewRuns.ts";
import { isOpenTask } from "./crewSnapshot.ts";
import { currentOrFirstStint, rotate } from "./CrewStints.ts";
import type { CrewAssignmentRow, CrewStintRow } from "./CrewStore.ts";
import { readTaskCard, readTaskReview, type TaskCard, type TaskWait } from "./crewTaskData.ts";
import {
  CREW_ROTATE_AFTER_DEFAULT,
  rotationDecision,
  type RotationMoment,
} from "./rotationDecision.ts";

/* ------------------------------------------------------------ task rows */

const ROTATED_TOO_OFTEN = "its conversation outgrew its context too often";

/** The board's words for the machine's own reasons to park (`crewMachines`); the engine's are words already. */
const PARK_WORDS: Readonly<Record<string, string>> = {
  reworks: "it came back for rework too often",
  rotations: ROTATED_TOO_OFTEN,
  infrastructure: "its turn broke off twice",
  "empty-merge-base": "your tree's history was rewritten",
  "disk-full": "the service's disk is full",
  "missing-object": "an object its landing needs is missing, twice",
};

export const requireTask = (core: CrewCore, taskId: string) =>
  asRefusal(core.store.getAssignment(taskId)).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(refuse("unknown-task", taskId)),
        onSome: Effect.succeed,
      }),
    ),
  );

/** What a press to a crewmate busy in its copy is told. */
export const busyWords = (handle: string) =>
  `@${handle} is busy with its copy of the code; try again in a moment`;

/**
 * A press to a crewmate, under its lock (`CrewCore.crewmate`): it never runs
 * beside that crewmate's turn end, a merge or another press in the same copy,
 * and never waits for one — it is refused at once as busy, having done nothing
 * — except behind the boot sweep or a deploy's recovery, which it waits out.
 */
export const pressCrewmate = <A, E, R>(
  core: CrewCore,
  handle: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | CrewCommandError, R> =>
  core
    .crewmateIfFree(handle)(effect)
    .pipe(
      Effect.flatMap(
        Option.match({
          // The boot sweep or a deploy's recovery holds the copy: the press waits its turn, bounded.
          onNone: () =>
            core.memory.sweeping.has(handle)
              ? core
                  .crewmateWithin(
                    handle,
                    SWEEP_WAIT,
                  )(effect)
                  .pipe(
                    Effect.flatMap(
                      Option.match({
                        onNone: () => Effect.fail(refuse("wrong-state", busyWords(handle))),
                        onSome: (value) => Effect.succeed(value),
                      }),
                    ),
                  )
              : Effect.fail(refuse("wrong-state", busyWords(handle))),
          onSome: (value) => Effect.succeed(value),
        }),
      ),
    );

/** How long a press waits for a copy the boot sweep or a deploy's recovery holds. */
const SWEEP_WAIT = Duration.minutes(2);

/** `pressCrewmate` on every one of `handles`, or on none: a busy one refuses the whole press. */
export const pressCrewmates = <A, E, R>(
  core: CrewCore,
  handles: ReadonlyArray<string>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | CrewCommandError, R> => {
  const [first, ...rest] = [...new Set(handles)];
  return first === undefined
    ? effect
    : pressCrewmate(core, first, pressCrewmates(core, rest, effect));
};

/**
 * A press whose work runs long — a Land, a Land now, with their merge and
 * check: refused at once as busy like any press, then run holding the
 * crewmate only around the git in its copy and the states it writes (`inCopy`).
 */
export const pressCrewmateLong = <A, E, R>(
  core: CrewCore,
  taskId: string,
  effect: (
    inCopy: <B, E2, R2>(inner: Effect.Effect<B, E2, R2>) => Effect.Effect<B, E2, R2>,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | CrewCommandError, R> =>
  Effect.flatMap(requireTask(core, taskId), (pressed) =>
    Effect.flatMap(pressCrewmate(core, pressed.member, Effect.void), () =>
      effect(core.crewmate(pressed.member)),
    ),
  );

/** A press on a task, to its crewmate (`pressCrewmate`); the task is read again inside. */
export const onTaskCrewmate = <A, E, R>(
  core: CrewCore,
  taskId: string,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.flatMap(requireTask(core, taskId), (pressed) =>
    pressCrewmate(core, pressed.member, effect),
  );

/** The write itself; every writer goes through `core.stepping` (`saveTask`, `saveOver`). */
const putTask = (core: CrewCore, row: CrewAssignmentRow) =>
  Effect.gen(function* () {
    const next = { ...row, updatedAt: yield* core.now };
    yield* asRefusal(core.store.putAssignment(next));
    return next;
  });

/** A task written as it is given, one write at a time (`core.stepping`). */
export const saveTask = (core: CrewCore, row: CrewAssignmentRow) =>
  core.stepping.withPermits(1)(putTask(core, row));

/**
 * `saveTask` over the task only as it was read: a write from a read made
 * before another changed the task (its state or its attempt) is refused as
 * `wrong-state`, never written over the newer state.
 */
export const saveOver = (core: CrewCore, read: CrewAssignmentRow, next: CrewAssignmentRow) =>
  core.stepping.withPermits(1)(
    Effect.gen(function* () {
      const stored = yield* requireTask(core, read.assignment);
      if (stored.state !== read.state || stored.attempt !== read.attempt) {
        return yield* refuse("wrong-state", `#${stored.number} is ${stored.state}`);
      }
      return yield* putTask(core, next);
    }),
  );

/**
 * One step of a task's machine, written. A step the task's state does not
 * take is refused as `wrong-state`; a park records its reason for triage.
 */
export const stepTask = (
  core: CrewCore,
  row: CrewAssignmentRow,
  event: TaskEvent,
  change: (next: CrewAssignmentRow) => CrewAssignmentRow = (next) => next,
  /** Counters the row does not carry: re-queues are counted from the task's attempts. */
  counted: Partial<Pick<TaskCounters, "requeues" | "rotations">> = {},
) =>
  Effect.gen(function* () {
    const step = taskTransition(
      {
        state: row.state,
        counters: {
          attempt: Math.max(1, row.attempt),
          reworks: row.reworks,
          remerges: row.remerges,
          requeues: counted.requeues ?? 0,
          rotations: counted.rotations ?? 0,
        },
      },
      event,
    );
    if (step.kind !== "moved") {
      return yield* refuse(
        "wrong-state",
        step.kind === "held" ? step.reason : `#${row.number} is ${row.state}`,
      );
    }
    const parked: TaskWait | undefined =
      step.parked === undefined
        ? undefined
        : { on: "triage", reason: PARK_WORDS[step.parked] ?? step.parked, paths: [] };
    return yield* saveOver(
      core,
      row,
      change({
        ...row,
        state: step.to,
        attempt: row.attempt === 0 && step.to !== "working" ? 0 : step.counters.attempt,
        reworks: step.counters.reworks,
        remerges: step.counters.remerges,
        ...(parked === undefined ? {} : { waiting: parked }),
      }),
    );
  });

/** Parks a task with the engine's own words for why. */
export const parkTask = (core: CrewCore, row: CrewAssignmentRow, reason: string) =>
  stepTask(core, row, { type: "park", reason }).pipe(
    Effect.tap((parked) =>
      asRefusal(
        core.store.appendLog({
          crew: CREW_ID,
          run: null,
          at: parked.updatedAt,
          kind: "parked",
          payload: { task: parked.assignment, reason },
        }),
      ),
    ),
  );

export const openTaskOf = (tasks: ReadonlyArray<CrewAssignmentRow>, handle: string) =>
  tasks.find((row) => row.member === handle && isOpenTask(row.state));

export const createTask = (
  core: CrewCore,
  input: {
    readonly owner: string;
    readonly title: string;
    readonly source: CrewTaskSource;
    readonly createdBy: string;
    readonly card: TaskCard;
    readonly dependsOn: ReadonlyArray<string>;
    /** `queued` unless the lead proposes it (PRD §5.4). */
    readonly state?: CrewTaskState;
  },
) =>
  core.numbered(
    Effect.gen(function* () {
      const now = yield* core.now;
      const applied = yield* core.applied;
      const row: CrewAssignmentRow = {
        assignment: `task-${yield* core.uuid}`,
        // The run it was created in; `null` outside one.
        run: (applied === undefined ? undefined : runningRun(applied)?.run) ?? null,
        crew: CREW_ID,
        member: input.owner,
        number: yield* asRefusal(core.store.nextTaskNumber(CREW_ID)),
        title: input.title,
        source: input.source,
        createdBy: input.createdBy,
        card: input.card,
        pending: null,
        dependsOn: input.dependsOn,
        fresh: false,
        state: input.state ?? "queued",
        attempt: 0,
        reworks: 0,
        remerges: 0,
        mergedHead: null,
        check: null,
        review: null,
        report: null,
        waiting: null,
        landedCommit: null,
        createdAt: now,
        updatedAt: now,
      };
      yield* asRefusal(core.store.putAssignment(row));
      return row;
    }),
  );

/* ------------------------------------------------------------ rotation */

/**
 * Rotates the crewmate's conversation now when one is due at this moment; its
 * stint either way. The engine's own rotations count toward `task`'s attempt,
 * and one past its two stops the task instead (CONCEPT §3A.4).
 */
export const stintForTurn = (
  core: CrewCore,
  applied: AppliedCrew,
  member: CrewMember,
  moment: RotationMoment,
  freshTask: boolean,
  task?: CrewAssignmentRow,
) =>
  Effect.gen(function* () {
    const stint = currentStint(applied, member.row.handle);
    if (stint === undefined) return yield* currentOrFirstStint(core, member);
    const attempt =
      task === undefined
        ? undefined
        : (yield* asRefusal(core.store.attemptsOf(task.assignment))).find(
            (row) => row.attempt === task.attempt,
          );
    const login = member.row.login ?? "";
    // A resume needs the transcript its session wrote; one gone (a redeploy) starts a new stint.
    const transcriptMissing =
      moment !== "idle" &&
      stint.sessionId !== null &&
      stint.transcriptPath !== null &&
      !(yield* core.fileExists(stint.transcriptPath));
    const decision = rotationDecision({
      moment,
      transcriptMissing,
      resumeFailed: false,
      ...optionalReason(core.memory.terminalReasons.get(stint.threadId)),
      compactions: stint.compactions,
      rotateAfter: member.spec.rotateAfter ?? CREW_ROTATE_AFTER_DEFAULT,
      stintPrincipal: "",
      principal: "",
      running: { brief: stint.briefVersion, job: stint.jobVersion },
      current: { brief: applied.briefVersion, job: member.row.jobVersion },
      ...optionalApply(core.memory.applyChoices.get(member.row.handle)),
      stintLogin: login,
      login,
      freshTask,
      startFresh: false,
      rotationsThisAttempt: attempt?.rotations ?? 0,
    });
    if (decision.kind === "pending" && !stint.rotatePending) {
      yield* asRefusal(
        core.store.updateStint(stint.crew, stint.member, stint.stint, (row) => ({
          ...row,
          rotatePending: true,
        })),
      );
      yield* asRefusal(core.reload);
    }
    if (decision.kind === "park" && task !== undefined) {
      yield* parkTask(core, task, ROTATED_TOO_OFTEN);
      return yield* refuse("wrong-state", `#${task.number} stopped: ${ROTATED_TOO_OFTEN}`);
    }
    if (decision.kind !== "rotate" && decision.kind !== "park") return stint;
    if (decision.kind === "rotate" && decision.counted && attempt !== undefined) {
      yield* asRefusal(core.store.putAttempt({ ...attempt, rotations: attempt.rotations + 1 }));
    }
    return yield* rotate(core, applied, member, decision.reason);
  });

const optionalReason = (reason: string | undefined) =>
  reason === undefined ? {} : { lastTerminalReason: reason };

const optionalApply = (apply: ReturnType<CrewCore["memory"]["applyChoices"]["get"]>) =>
  apply === undefined ? {} : { apply };

/** The crew log's record of a Try again: the attempt it started, from which re-queues count again. */
const RETRIED_LOG = "retried";
const decodeRetried = Schema.decodeUnknownOption(
  Schema.Struct({ task: Schema.String, attempt: Schema.Number }),
);
const readRetried = (payload: unknown) => Option.getOrUndefined(decodeRetried(payload));

/**
 * An infrastructure ending (the provider or the session setup failed): the attempt ends with `detail`, and the task
 * queues again once — the second time it stops (ARCHITECTURE §4 *Assignment*).
 */
export const requeueTask = (core: CrewCore, task: CrewAssignmentRow, detail: string) =>
  Effect.gen(function* () {
    const attempts = yield* asRefusal(core.store.attemptsOf(task.assignment));
    const attempt = attempts.find((row) => row.attempt === task.attempt);
    if (attempt !== undefined) {
      yield* asRefusal(
        core.store.putAttempt({
          ...attempt,
          ending: "infrastructure",
          endingDetail: detail,
          endedAt: yield* core.now,
        }),
      );
    }
    // A Try again starts a fresh budget: only the attempts since the last one count.
    const retried = (yield* asRefusal(core.store.logOf(CREW_ID, [RETRIED_LOG])))
      .map((entry) => readRetried(entry.payload))
      .filter((entry) => entry?.task === task.assignment)
      .reduce((latest, entry) => Math.max(latest, entry?.attempt ?? 0), 0);
    const requeues = attempts.filter(
      (row) => row.attempt >= retried && row.ending === "infrastructure",
    ).length;
    return yield* stepTask(core, task, { type: "infrastructure-ending" }, undefined, { requeues });
  });

/* ------------------------------------------------------------ turns */

export type StartOutcome =
  | { readonly _tag: "started"; readonly task: CrewAssignmentRow }
  | { readonly _tag: "held"; readonly reason: string }
  | { readonly _tag: "refused"; readonly detail: string };

/** Sends one turn into `stint` as `principal`: admitted, then dispatched. */
export const sendTurn = (
  core: CrewCore,
  member: CrewMember,
  stint: CrewStintRow,
  principal: TurnPrincipal,
  text: string,
  attachments: ReadonlyArray<ChatAttachment> = [],
  operation?: CrewOperation,
  admittedCommand?: OrchestrationCommand,
) =>
  Effect.gen(function* () {
    const task = openTaskOf(yield* asRefusal(core.store.assignments(CREW_ID)), member.row.handle);
    const owned =
      operation ??
      (yield* beginOperation(core, {
        kind: "dispatch",
        handle: member.row.handle,
        task,
        startedBy: principalUser(principal),
      }));
    const command =
      admittedCommand ??
      (yield* crewTurnCommand(core, {
        threadId: stint.threadId,
        modelSelection: yield* modelSelectionFor(core, member.row),
        text,
        attachments,
        createdAt: yield* core.now,
      }));
    yield* updateOperation(core, owned.id, {
      targets: { ...owned.targets, threadId: stint.threadId, commandId: command.commandId },
      confirmedStage: admittedCommand === undefined ? "attempt-recorded" : "admitted",
      // The turn's words, kept until its dispatch is confirmed: a restart before that sends them.
      result: { turn: text },
    });
    if (admittedCommand === undefined)
      yield* operationStep(
        core,
        owned.id,
        "admitting",
        admitCrewTurn(core, command, principal),
        "admitted",
      );
    core.memory.working.add(stint.threadId);
    yield* followCrewWork(core);
    yield* operationStep(
      core,
      owned.id,
      "dispatching",
      dispatchCrewTurn(core, command),
      "dispatched",
    ).pipe(
      Effect.tapError(() =>
        Effect.suspend(() => {
          core.memory.working.delete(stint.threadId);
          return followCrewWork(core);
        }),
      ),
    );
  });

/**
 * A task's first turn: its conversation (rotated when due), its copy made
 * ready (a copy whose tip is its last landing starts again from your tree),
 * the policed refs snapshotted, then the card — admitted as `principal`.
 */
export const startTask = (
  core: CrewCore,
  applied: AppliedCrew,
  member: CrewMember,
  task: CrewAssignmentRow,
  principal: TurnPrincipal,
  attachments: ReadonlyArray<ChatAttachment> = [],
) =>
  Effect.gen(function* () {
    const held = (reason: string): StartOutcome => ({ _tag: "held", reason });
    if (isWorking(core, applied, member.row.handle)) return held("lane-busy");
    const owned = yield* beginOperation(core, {
      kind: "dispatch",
      handle: member.row.handle,
      task,
      startedBy: principalUser(principal),
    });
    const stint = yield* operationStep(
      core,
      owned.id,
      "opening-conversation",
      stintForTurn(core, applied, member, "task-start", task.fresh),
    );
    let resetTo: string | null = null;
    let dispatchCommit: string | null = null;
    if (member.row.kind === "writer") {
      const key = { crew: CREW_ID, handle: member.row.handle };
      const prepared = yield* operationStep(
        core,
        owned.id,
        "preparing-copy",
        asRefusal(
          core.workspace.prepareDispatch(key, (target) =>
            updateOperation(core, owned.id, { result: { resetTo: target } }).pipe(Effect.orDie),
          ),
        ),
      );
      switch (prepared._tag) {
        case "dirty":
          yield* updateOperation(core, owned.id, {
            detail: "Its copy has preserved edits. Continue to preserve them and start this task.",
          });
          yield* finishOperation(core, owned.id, prepared, true);
          yield* refreshLaneStats(core, member);
          return held("its copy still has preserved edits; continue or preserve them first");
        case "frozen":
          yield* finishOperation(core, owned.id, prepared, true);
          return held("host-frozen");
        case "lane-missing":
          core.memory.missingLanes.add(member.row.handle);
          yield* finishOperation(core, owned.id, prepared, true);
          return held("lane-missing");
        case "parked":
          yield* parkTask(core, task, "its copy of the code moved outside the engine");
          yield* finishOperation(core, owned.id, prepared, true);
          return held("parked");
        case "ready":
          dispatchCommit = prepared.dispatchCommit;
          resetTo = prepared.reset ? prepared.dispatchCommit : null;
          yield* operationStep(
            core,
            owned.id,
            "snapshotting-refs",
            asRefusal(core.integration.snapshotRefs(key)),
          );
      }
    }
    const card = readTaskCard(task.card) ?? { brief: task.title, doneWhen: "", note: null };
    const text = taskCard({
      number: task.number,
      title: task.title,
      source: task.source,
      card,
      resetTo,
    });
    const probe = yield* crewTurnCommand(core, {
      threadId: stint.threadId,
      modelSelection: yield* modelSelectionFor(core, member.row),
      text,
      attachments,
      createdAt: yield* core.now,
    });
    yield* updateOperation(core, owned.id, {
      targets: { ...owned.targets, threadId: stint.threadId, commandId: probe.commandId },
    });
    const refused = yield* operationStep(
      core,
      owned.id,
      "admitting",
      admitCrewTurn(core, probe, principal),
    ).pipe(
      Effect.as(undefined),
      Effect.catchTags({
        CrewCommandError: (error) =>
          error.reason === "not-allowed" ? Effect.succeed(error.detail ?? "") : Effect.fail(error),
      }),
    );
    const now = yield* core.now;
    if (refused !== undefined) {
      // The refusal is the outcome, shown as Can't start; no effect waits to be continued.
      yield* finishOperation(core, owned.id, { refused });
      core.memory.cantStart.set(task.assignment, { text: refused, at: now });
      return { _tag: "refused", detail: refused } satisfies StartOutcome as StartOutcome;
    }
    core.memory.cantStart.delete(task.assignment);
    const started = yield* stepTask(core, task, {
      type: "dispatch",
      facts: { dependenciesLanded: true, laneIdle: true, hostFrozen: false, admitted: true },
    });
    core.memory.turns.set(`${started.assignment}:${started.attempt}`, 1);
    yield* asRefusal(
      core.store.putAttempt({
        assignment: started.assignment,
        attempt: started.attempt,
        threadId: stint.threadId,
        dispatchCommit,
        tipRef: null,
        rotations: 0,
        ending: null,
        endingDetail: null,
        costUsd: 0,
        startedAt: now,
        endedAt: null,
      }),
    );
    yield* updateOperation(core, owned.id, {
      confirmedStage: "attempt-recorded",
      targets: { ...owned.targets, attempt: started.attempt },
    });
    yield* sendTurn(
      core,
      member,
      stint,
      principal,
      text,
      attachments,
      { ...owned, targets: { ...owned.targets, attempt: started.attempt } },
      probe,
    );
    return { _tag: "started", task: started } satisfies StartOutcome as StartOutcome;
  });

/**
 * A further turn of an open task, as `principal` (a message, *Ask to resolve*,
 * *Ask to fix*). When the turn opens a new conversation, it carries the task
 * in a card (why the conversation is new, then the turn's words), so the new
 * stint starts from a card as every stint does.
 */
export const continueTask = (
  core: CrewCore,
  applied: AppliedCrew,
  member: CrewMember,
  task: CrewAssignmentRow,
  principal: TurnPrincipal,
  text: string,
  attachments: ReadonlyArray<ChatAttachment> = [],
) =>
  Effect.gen(function* () {
    const owned = yield* beginOperation(core, {
      kind: "dispatch",
      handle: member.row.handle,
      task,
      startedBy: principalUser(principal),
    });
    yield* acknowledgeOperations(core, member.row.handle, task.assignment);
    const before = currentStint(applied, member.row.handle);
    const stint = yield* operationStep(
      core,
      owned.id,
      "opening-conversation",
      stintForTurn(core, applied, member, "turn-start", false, task),
    );
    const sent =
      before !== undefined && before.threadId !== stint.threadId
        ? carriedCard({ number: task.number, title: task.title, reason: stint.reason ?? "", text })
        : text;
    const probe = yield* crewTurnCommand(core, {
      threadId: stint.threadId,
      modelSelection: yield* modelSelectionFor(core, member.row),
      text: sent,
      attachments,
      createdAt: yield* core.now,
    });
    yield* updateOperation(core, owned.id, {
      targets: { ...owned.targets, threadId: stint.threadId, commandId: probe.commandId },
    });
    yield* operationStep(core, owned.id, "admitting", admitCrewTurn(core, probe, principal));
    // A rework is a new attempt: an accept of the last one no longer stands (a reject's note stays).
    const working = yield* stepTask(core, task, { type: "message" }, (next) =>
      task.state === "rework"
        ? {
            ...next,
            waiting: null,
            review: readTaskReview(next.review)?.verdict === "accept" ? null : next.review,
          }
        : next,
    );
    const key = `${working.assignment}:${working.attempt}`;
    core.memory.turns.set(key, (core.memory.turns.get(key) ?? 0) + 1);
    yield* openAttempt(core, working, stint);
    const recorded = yield* updateOperation(core, owned.id, {
      confirmedStage: "attempt-recorded",
      targets: { ...owned.targets, attempt: working.attempt },
    });
    yield* sendTurn(core, member, stint, principal, sent, attachments, recorded, probe);
    return working;
  });

/**
 * The attempt a further turn works in, open while it runs: a rework's new
 * attempt gets its row, from the copy its last attempt started from; an
 * attempt its last turn ended opens again.
 */
const openAttempt = (core: CrewCore, task: CrewAssignmentRow, stint: CrewStintRow) =>
  Effect.gen(function* () {
    const attempts = yield* asRefusal(core.store.attemptsOf(task.assignment));
    const attempt = attempts.find((row) => row.attempt === task.attempt);
    if (attempt === undefined) {
      yield* asRefusal(
        core.store.putAttempt({
          assignment: task.assignment,
          attempt: task.attempt,
          threadId: stint.threadId,
          dispatchCommit: attempts.at(-1)?.dispatchCommit ?? null,
          tipRef: null,
          rotations: 0,
          ending: null,
          endingDetail: null,
          costUsd: 0,
          startedAt: yield* core.now,
          endedAt: null,
        }),
      );
    } else if (attempt.endedAt !== null) {
      yield* asRefusal(
        core.store.putAttempt({ ...attempt, ending: null, endingDetail: null, endedAt: null }),
      );
    }
  });

/** A turn of the lead's, outside any task: the person's message, or a wake as the run's starter. */
export const leadTurn = (
  core: CrewCore,
  lead: CrewMember,
  principal: TurnPrincipal,
  text: string,
  attachments: ReadonlyArray<ChatAttachment> = [],
) =>
  Effect.gen(function* () {
    const operation = yield* beginOperation(core, {
      kind: "dispatch",
      handle: lead.row.handle,
      startedBy: principalUser(principal),
      bySession: principal.kind === "session",
    });
    if (principal.kind === "session") yield* acknowledgeOperations(core, lead.row.handle);
    const stint = yield* operationStep(
      core,
      operation.id,
      "opening-conversation",
      currentOrFirstStint(core, lead),
    );
    yield* sendTurn(core, lead, stint, principal, text, attachments, operation);
  });

/* ------------------------------------------------------------ the queue */

const landed = (tasks: ReadonlyArray<CrewAssignmentRow>, id: string) =>
  tasks.find((row) => row.assignment === id)?.state === "landed";

/**
 * Starts the crewmate's oldest queued task whose dependencies landed, when
 * it is free. `now` names a task dispatched inside its creator's own call,
 * which runs as their session; every other runs as the running run's
 * starter, or without a run as its creator. The lead's tasks start only in
 * a running run (PRD §5.4), and a run whose own dispatch admission refuses
 * pauses with admission's words.
 */
export const pump = (
  core: CrewCore,
  handle: string,
  now?: { readonly taskId: string; readonly principal: TurnPrincipal },
) =>
  Effect.gen(function* () {
    if (yield* operationHolds(core, handle)) return;
    const applied = yield* core.applied;
    if (applied === undefined) return;
    const member = memberOf(applied, handle);
    if (member === undefined || isWorking(core, applied, handle)) return;
    const tasks = yield* asRefusal(core.store.assignments(CREW_ID));
    if (openTaskOf(tasks, handle) !== undefined) return;
    const run = runningRun(applied);
    const startable = tasks.filter(
      (row) =>
        row.member === handle &&
        row.state === "queued" &&
        (row.source !== "lead" || run !== undefined) &&
        row.dependsOn.every((id) => landed(tasks, id)),
    );
    // A press names its task; otherwise the oldest goes first.
    const next = startable.find((row) => row.assignment === now?.taskId) ?? startable[0];
    if (next === undefined) return;
    const ownCall = now !== undefined && now.taskId === next.assignment;
    const principal = ownCall ? now.principal : dispatchPrincipal(applied, next);
    const outcome = yield* startTask(core, applied, member, next, principal);
    if (outcome._tag === "refused" && run !== undefined && !ownCall) {
      yield* pauseRun(core, "refused", outcome.detail);
    }
    yield* core.changed;
  });

/* ------------------------------------------------------------ commands */

/** A crewmate chat's send (PRD §5.2a). */
export const message = (
  core: CrewCore,
  principal: TurnPrincipal,
  input: {
    readonly handle: string;
    readonly text: string;
    readonly attachments: ReadonlyArray<ChatAttachment>;
  },
) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const member = yield* requireMember(applied, input.handle);
    yield* core.attachments.check(input.attachments);
    const tasks = yield* asRefusal(core.store.assignments(CREW_ID));
    const open = openTaskOf(tasks, input.handle);
    const current = currentStint(applied, input.handle);
    if (current !== undefined && core.memory.working.has(current.threadId)) {
      yield* sendTurn(core, member, current, principal, input.text, input.attachments);
      return;
    }
    if (member.row.kind === "lead") {
      core.memory.leadSpokenBy = principalUser(principal);
      yield* leadTurn(core, member, principal, input.text, input.attachments);
      return;
    }
    if (open !== undefined) {
      if (open.state === "merging" || open.state === "landing") {
        return yield* refuse("wrong-state", busyWords(input.handle));
      }
      yield* continueTask(core, applied, member, open, principal, input.text, input.attachments);
      return;
    }
    const stint = current ?? (yield* currentOrFirstStint(core, member));
    const probe = yield* crewTurnCommand(core, {
      threadId: stint.threadId,
      modelSelection: yield* modelSelectionFor(core, member.row),
      text: input.text,
      attachments: input.attachments,
      createdAt: yield* core.now,
    });
    yield* admitCrewTurn(core, probe, principal);
    const task = yield* createTask(core, {
      owner: input.handle,
      title: implicitTaskTitle(input.text) || "Message",
      source: "message",
      createdBy: principalUser(principal),
      card: { brief: input.text, doneWhen: "", note: null },
      dependsOn: [],
    });
    const reloaded = (yield* core.applied) ?? applied;
    const outcome = yield* startTask(core, reloaded, member, task, principal, input.attachments);
    if (outcome._tag === "refused") return yield* refuse("not-allowed", outcome.detail);
  });

/** *New task* / the board's + New task (PRD §4.4): queued, started now when its crewmate is free. */
export const newTask = (
  core: CrewCore,
  principal: TurnPrincipal,
  input: {
    readonly owner: string;
    readonly title: string;
    readonly brief: string;
    readonly doneWhen: string;
    readonly dependsOn: ReadonlyArray<string>;
  },
) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    yield* requireMember(applied, input.owner);
    for (const id of input.dependsOn) yield* requireTask(core, id);
    // Checked, then its crewmate held: a busy one is refused before anything is made.
    yield* pressCrewmate(
      core,
      input.owner,
      Effect.gen(function* () {
        const task = yield* createTask(core, {
          owner: input.owner,
          title: input.title,
          source: "you",
          createdBy: principalUser(principal),
          card: { brief: input.brief, doneWhen: input.doneWhen, note: null },
          dependsOn: input.dependsOn,
        });
        yield* pump(core, input.owner, { taskId: task.assignment, principal });
      }),
    );
  });

/** *Tell the crew* (PRD §5.3). */
export const tell = (
  core: CrewCore,
  principal: TurnPrincipal,
  input: { readonly text: string; readonly mentions: ReadonlyArray<{ readonly handle: string }> },
) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const route = routeCrewMessage({
      place: "tell",
      roster: [...applied.members.values()].map((row) => ({ handle: row.handle, kind: row.kind })),
      text: input.text,
      mentions: input.mentions,
    });
    switch (route.kind) {
      case "refused":
        return yield* route.reason === "unknown-mention"
          ? refuse(
              "unknown-crewmate",
              (route.handles ?? []).map((handle) => `@${handle}`).join(", "),
            )
          : refuse("no-mention");
      case "to-crewmate":
        return yield* pressCrewmate(
          core,
          route.handle,
          message(core, principal, { handle: route.handle, text: input.text, attachments: [] }),
        );
      case "to-lead":
        return yield* pressCrewmate(
          core,
          route.lead,
          message(core, principal, {
            handle: route.lead,
            text:
              route.addressed.length === 0
                ? input.text
                : `${input.text}\n\nAddressed: ${route.addressed.map((handle) => `@${handle}`).join(", ")}`,
            attachments: [],
          }),
        );
      case "tasks":
        // Every crewmate held first: one busy refuses the press before any task is made.
        return yield* pressCrewmates(
          core,
          route.tasks.map((routed) => routed.handle),
          Effect.gen(function* () {
            for (const routed of route.tasks) {
              const task = yield* createTask(core, {
                owner: routed.handle,
                title: routed.title || "Message",
                source: "you",
                createdBy: principalUser(principal),
                card: { brief: input.text, doneWhen: "", note: routed.note ?? null },
                dependsOn: [],
              });
              yield* pump(core, routed.handle, { taskId: task.assignment, principal });
            }
          }),
        );
    }
  });

/** Edits a task; one whose wait is dropped starts when its crewmate is free, as the editor. */
export const editTask = (
  core: CrewCore,
  principal: TurnPrincipal,
  input: {
    readonly taskId: string;
    readonly title?: string | undefined;
    readonly brief?: string | undefined;
    readonly doneWhen?: string | undefined;
    readonly dependsOn?: ReadonlyArray<string> | undefined;
  },
) =>
  Effect.gen(function* () {
    const row = yield* requireTask(core, input.taskId);
    if (row.state === "landed" || row.state === "discarded") {
      return yield* refuse("wrong-state", `#${row.number} is ${row.state}`);
    }
    const card = readTaskCard(row.card) ?? { brief: "", doneWhen: "", note: null };
    yield* saveOver(core, row, {
      ...row,
      title: input.title ?? row.title,
      card: {
        ...card,
        brief: input.brief ?? card.brief,
        doneWhen: input.doneWhen ?? card.doneWhen,
      },
      dependsOn: input.dependsOn ?? row.dependsOn,
    });
    if (input.dependsOn !== undefined && row.state === "queued") {
      yield* pump(core, row.member, { taskId: row.assignment, principal });
    }
  });

export const markFresh = (core: CrewCore, taskId: string) =>
  Effect.gen(function* () {
    const row = yield* requireTask(core, taskId);
    if (row.state !== "queued" && row.state !== "proposed") {
      return yield* refuse("wrong-state", `#${row.number} has started`);
    }
    yield* saveOver(core, row, { ...row, fresh: true });
  });

/**
 * Discards a task from any state; an open task's work is kept aside and its
 * copy reset first, so a reset that fails leaves the task as it was. A press
 * while its crewmate's turn end is handled waits for that end.
 */
export const discard = (core: CrewCore, taskId: string) =>
  Effect.flatMap(requireTask(core, taskId), (pressed) =>
    // A proposed task touches no copy: its discard needs nothing of its crewmate.
    (pressed.state === "proposed"
      ? (effect: Effect.Effect<void, CrewCommandError>) => effect
      : (effect: Effect.Effect<void, CrewCommandError>) =>
          pressCrewmate(core, pressed.member, effect))(
      Effect.gen(function* () {
        const applied = yield* requireApplied(core);
        const row = yield* requireTask(core, taskId);
        if (isOpenTask(row.state) && isWorking(core, applied, row.member)) {
          return yield* refuse("wrong-state", `@${row.member}'s turn is running`);
        }
        // Its merge or check runs (`integrate`): a discard now would be written over. One
        // left merging or checking with nothing running on it (a redeploy held its merge,
        // its check errored) is discarded as any other.
        if (core.memory.integrating.has(row.assignment)) {
          return yield* refuse("wrong-state", busyWords(row.member));
        }
        const member = memberOf(applied, row.member);
        if (isOpenTask(row.state) && member?.row.kind === "writer") {
          yield* asRefusal(
            core.workspace.keepAndReset(
              { crew: CREW_ID, handle: row.member },
              { run: null, assignment: row.assignment, attempt: row.attempt, abortMerge: true },
            ),
          );
        }
        const discarded = yield* stepTask(core, row, { type: "discard" });
        core.memory.cantStart.delete(discarded.assignment);
        yield* pump(core, row.member);
      }),
    ),
  );

/** *Try again* on a stopped task (parked → queued), or on a queued one admission refused. */
export const retryTask = (core: CrewCore, principal: TurnPrincipal, taskId: string) =>
  Effect.gen(function* () {
    const row = yield* requireTask(core, taskId);
    const refused = row.state === "queued" && core.memory.cantStart.has(row.assignment);
    if (row.state !== "parked" && !refused) {
      return yield* refuse("wrong-state", `#${row.number} is ${row.state}`);
    }
    yield* acknowledgeOperations(core, row.member, taskId);
    const queued =
      row.state === "queued"
        ? row
        : yield* stepTask(core, row, { type: "retry" }, (next) => ({ ...next, waiting: null }));
    if (queued !== row)
      yield* asRefusal(
        core.store.appendLog({
          crew: CREW_ID,
          run: null,
          at: yield* core.now,
          kind: RETRIED_LOG,
          payload: { task: queued.assignment, attempt: queued.attempt },
        }),
      );
    yield* pump(core, row.member, { taskId: queued.assignment, principal });
  });

/** The one turn *Save and apply now* sends to a crewmate its save interrupted. */
export const continueAfterSave = (core: CrewCore, handle: string, pending: PendingContinue) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const member = yield* requireMember(applied, handle);
    const tasks = yield* asRefusal(core.store.assignments(CREW_ID));
    const open = openTaskOf(tasks, handle);
    if (open === undefined) return;
    const text = continueCard({ number: open.number, title: open.title, change: pending.change });
    yield* continueTask(
      core,
      applied,
      member,
      open,
      { kind: "crew", startedBy: pending.startedBy },
      text,
    );
  });
