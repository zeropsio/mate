/**
 * crewBoot — an applied crew after a Mate server restart.
 *
 * Every side effect of dispatch, checkpoint, check and landing persists its
 * operation and stage before it runs (`crewOperations`), so a restart knows
 * where each stopped. `boot` runs before the engine takes events: it marks
 * the operations still running interrupted at their last confirmed stage and
 * names them for the engine to carry on; an attempt whose turn ended without
 * the engine seeing it ends as no report, when the task last moved. A
 * running run stays running. `inspectBoot` reads landing evidence, claims,
 * missing copies and lane figures; it never writes git. Once the server
 * accepts commands, `carryOnAtBoot` sweeps each writer's service (copies
 * come back where no work is lost), resumes the named operations from their
 * stage as each crewmate is free (`resumeAfterRestart`), a conversation that
 * records no copy gets its crew copy, an Allow that waited on a turn the
 * restart ended goes out, and the run takes up what waits on it. Only work whose resume is ambiguous stays for a person.
 *
 * @module crewBoot
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ThreadId } from "@t3tools/contracts";

import { crewLane } from "./CrewDefinition.ts";
import { grantAfterTurn, refreshClaims } from "./crewClaims.ts";
import {
  asRefusal,
  currentStint,
  failureWords,
  feedWhenUnattended,
  memberOf,
  type AppliedCrew,
  type CrewCore,
} from "./crewCore.ts";
import { CREW_ID } from "./CrewHome.ts";
import { refreshLaneStats } from "./crewLanding.ts";
import { CHECKED_STATES, EDITED_AFTER_CHECK, NO_REPORT } from "./crewMachines.ts";
import { openTaskOf, parkTask } from "./crewTasks.ts";
import { beginOperation, updateOperation } from "./crewOperations.ts";
import { advanceAll, takeUpWaiting } from "./crewRunFlow.ts";
import { runOnAfterRestart } from "./crewRuns.ts";
import { repairUnsetCopies } from "./CrewStints.ts";
import { adoptOwnWrites, readLandedEvidence } from "./crewContinue.ts";
import { recoverLanes } from "./crewTurns.ts";

/** A task whose turn was running when the server stopped: its session died with it. */
const turnDied = (core: CrewCore, threadId: string | null) =>
  threadId === null
    ? Effect.succeed(false)
    : core.projection.getThreadShellById(ThreadId.make(threadId)).pipe(
        Effect.map((shell) =>
          Option.match(shell, {
            onNone: () => false,
            onSome: (thread) =>
              thread.session?.status === "running" || thread.latestTurn?.state === "running",
          }),
        ),
        Effect.orElseSucceed(() => false),
      );

export const boot = (core: CrewCore) =>
  Effect.gen(function* () {
    const applied = yield* core.applied;
    if (applied === undefined) return;
    const operations = [...(yield* asRefusal(core.store.operations(CREW_ID)))];
    for (const task of yield* asRefusal(core.store.assignments(CREW_ID))) {
      if (!["working", "merging", "checking", "landing"].includes(task.state)) continue;
      const attempts = yield* asRefusal(core.store.attemptsOf(task.assignment));
      const attempt = attempts.find((row) => row.attempt === task.attempt);
      const recorded = operations.some((operation) => operation.taskId === task.assignment);
      const died =
        task.state === "working" &&
        !recorded &&
        (yield* turnDied(
          core,
          currentStint(applied, task.member)?.threadId ?? attempt?.threadId ?? null,
        ));
      // Older builds kept only the task stage: a stage mid-way, or a turn the restart killed.
      if (!recorded && (task.state !== "working" || died)) {
        const legacy = yield* beginOperation(core, {
          kind:
            task.state === "landing" ? "landing" : task.state === "working" ? "dispatch" : "check",
          handle: task.member,
          task,
        });
        operations.push(
          yield* updateOperation(core, legacy.id, {
            stage: task.state,
            confirmedStage: "legacy-state-recorded",
            detail: "The previous server did not record this outcome.",
          }),
        );
      }
      if (attempt === undefined || attempt.endedAt !== null) continue;
      const interrupted = operations.some(
        (operation) => operation.taskId === task.assignment && operation.status === "running",
      );
      // A turn that ended unseen ends its attempt when the task last moved.
      yield* asRefusal(
        core.store.putAttempt(
          interrupted
            ? {
                ...attempt,
                ending: "interrupted",
                endingDetail: "The Mate restarted during its turn.",
                endedAt: yield* core.now,
              }
            : {
                ...attempt,
                ending: NO_REPORT.ending,
                endingDetail: NO_REPORT.detail,
                endedAt: task.updatedAt,
              },
        ),
      );
      if (!interrupted) yield* feedWhenUnattended(core);
    }
    for (const operation of operations) {
      if (operation.status !== "running") continue;
      yield* updateOperation(core, operation.id, {
        status: "interrupted",
        detail: operation.detail ?? "The Mate restarted before its outcome was recorded.",
      });
      core.memory.resumeAtBoot.add(operation.id);
    }
    yield* core.changed;
  });

/** Exact reads report preserved copies and landing evidence; they never advance work. */
export const inspectBoot = (core: CrewCore) =>
  Effect.gen(function* () {
    const applied = yield* core.applied;
    if (applied === undefined) return;
    for (const operation of yield* asRefusal(core.store.operations(CREW_ID))) {
      if (
        operation.status === "interrupted" &&
        operation.kind === "landing" &&
        operation.taskId !== null &&
        operation.targets.host !== null
      ) {
        const commit = yield* core.integration
          .landingEvidence(operation.targets.host, operation.taskId)
          .pipe(Effect.orElseSucceed(() => null));
        if (commit !== null)
          yield* updateOperation(core, operation.id, {
            result: { _tag: "already-landed", commit },
            detail: "Already in the code. Continue to record the outcome.",
          });
      }
    }
    yield* refreshClaims(core);
    // Read the preserved edits for the row; these reads never write git or start work.
    for (const handle of applied.members.keys()) {
      const member = memberOf(applied, handle);
      if (member !== undefined) {
        const repository =
          member.row.host === null ? undefined : applied.repositories.get(member.row.host);
        if (
          member.row.kind === "writer" &&
          repository !== undefined &&
          !(yield* core.fileExists(crewLane(repository, handle).mountDir))
        )
          core.memory.missingLanes.add(handle);
        yield* refreshLaneStats(core, member);
      }
    }
    yield* core.changed;
  });

/**
 * Each writer's service read from git, not the tables: a lane gitdir made
 * relative, a dirty lane's work saved as a WIP commit (nothing is lost by a
 * commit), an unreadable ref or a tip the engine did not write parked, and
 * a missing copy brought back only where its branch, landings and saved
 * tip all remain; otherwise the loss is named and the copy stays missing.
 */
const sweepHost = (core: CrewCore, applied: AppliedCrew, host: string) =>
  Effect.gen(function* () {
    // A self-deploy the restart cut off has nobody left to see it end: the host thaws, and
    // the sweep and recovery below read what the deploy left.
    yield* asRefusal(core.workspace.unfreeze(host));
    const tasks = yield* asRefusal(core.store.assignments(CREW_ID));
    const open = (handle: string) => openTaskOf(tasks, handle);
    const checked = new Set(
      [...applied.members.keys()].filter((handle) => {
        const task = open(handle);
        return task !== undefined && CHECKED_STATES.has(task.state);
      }),
    );
    const swept = yield* asRefusal(core.workspace.sweep(host, checked));
    // Edits on a copy its check passed: never committed, never landed, and its landing stops.
    for (const lane of swept.lanes) {
      const task = lane._tag === "held" ? open(lane.handle) : undefined;
      if (task === undefined) continue;
      for (const row of yield* asRefusal(core.store.operations(CREW_ID))) {
        if (row.taskId !== task.assignment || row.status !== "interrupted") continue;
        core.memory.resumeAtBoot.delete(row.id);
        yield* updateOperation(core, row.id, { status: "continued" });
      }
      yield* parkTask(core, task, EDITED_AFTER_CHECK);
    }
    const missing = swept.lanes
      .filter((lane) => lane._tag === "missing")
      .map((lane) => lane.handle);
    for (const handle of missing) core.memory.missingLanes.add(handle);
    if (missing.length > 0) yield* recoverLanes(core, applied, host, "came back from a restart");
  });

/**
 * Once the server accepts commands: the run's clock counts again, every free
 * crewmate carries its interrupted work on, and a running run takes up what
 * waits on it.
 */
export const carryOnAtBoot = (core: CrewCore) =>
  Effect.gen(function* () {
    const applied = yield* core.applied;
    if (applied === undefined) return;
    yield* runOnAfterRestart(core);
    // A git write an interrupted operation finished after the Mate stopped is its own, not a stranger's.
    const interrupted = (yield* asRefusal(core.store.operations(CREW_ID))).filter((row) =>
      core.memory.resumeAtBoot.has(row.id),
    );
    for (const handle of applied.members.keys()) {
      const member = memberOf(applied, handle);
      const own = interrupted.filter((row) => row.handle === handle);
      if (member === undefined || own.length === 0) continue;
      const landed = own
        .map((row) => readLandedEvidence(row.result))
        .find((evidence) => evidence !== undefined)?.commit;
      yield* adoptOwnWrites(core, member, own, landed).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            core.memory.lastError = failureWords(error);
          }),
        ),
      );
    }
    for (const host of applied.repositories.keys()) {
      yield* sweepHost(core, applied, host).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            core.memory.lastError = failureWords(error);
          }),
        ),
      );
    }
    for (const handle of applied.members.keys()) {
      const member = memberOf(applied, handle);
      if (member !== undefined && member.row.kind === "writer")
        yield* refreshLaneStats(core, member);
    }
    yield* repairUnsetCopies(core, applied);
    // An Allow that waited on a turn the restart ended goes out first; its work carries on after.
    for (const handle of applied.members.keys()) yield* grantAfterTurn(core, handle);
    yield* takeUpWaiting(core);
    yield* advanceAll(core);
    yield* core.changed;
  });
