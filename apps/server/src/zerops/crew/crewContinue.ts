import type { CrewOperation } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { TurnPrincipal } from "../ZeropsTurnAdmission.ts";
import {
  asRefusal,
  dispatchPrincipal,
  failureWords,
  refuse,
  requireApplied,
  requireMember,
  isWorking,
  principalUser,
  runningRun,
  type CrewCore,
  type CrewMember,
} from "./crewCore.ts";
import { CREW_ID } from "./CrewHome.ts";
import { CHECKED_STATES } from "./crewMachines.ts";
import type { CrewAssignmentRow } from "./CrewStore.ts";
import { operationStep, sentBySession, updateOperation, withOperation } from "./crewOperations.ts";
import { integrate, land, refreshLaneStats, reworkCard } from "./crewLanding.ts";
import { readTaskWait } from "./crewTaskData.ts";
import { commitAndPolice } from "./crewTurns.ts";
import { continueTask, requireTask, saveTask, startTask, leadTurn } from "./crewTasks.ts";

const readDispatchEnding = Schema.decodeUnknownOption(
  Schema.Struct({ terminalReason: Schema.optional(Schema.String) }),
);

const readDirtyDispatch = Schema.decodeUnknownOption(Schema.TaggedStruct("dirty", {}));

const readLandedEvidenceOption = Schema.decodeUnknownOption(
  Schema.TaggedStruct("already-landed", {
    commit: Schema.String,
  }),
);

/** The landed commit a landing's boot inspection recorded, if any. */
export const readLandedEvidence = (result: unknown) =>
  Option.getOrUndefined(readLandedEvidenceOption(result));

/** A selected ending, guarded against a changed task, a running turn, or a newer operation. */
const selected = (core: CrewCore, handle: string, id: string) =>
  Effect.gen(function* () {
    const found = yield* asRefusal(core.store.getOperation(id));
    if (
      Option.isNone(found) ||
      found.value.handle !== handle ||
      !["interrupted", "failed"].includes(found.value.status)
    ) {
      return yield* refuse("wrong-state", "This work is no longer waiting to continue.");
    }
    const operation = found.value;
    const applied = yield* requireApplied(core);
    if (
      isWorking(core, applied, handle) ||
      (operation.taskId !== null && core.memory.integrating.has(operation.taskId))
    ) {
      return yield* refuse("wrong-state", "This crewmate is working.");
    }
    const pending = yield* asRefusal(core.store.operations(CREW_ID));
    const related = pending.filter(
      (row) =>
        row.handle === handle &&
        row.taskId === operation.taskId &&
        ["failed", "interrupted"].includes(row.status),
    );
    if (related.at(-1)?.id !== operation.id)
      return yield* refuse("wrong-state", "Open the latest interruption before continuing.");
    const task = operation.taskId === null ? undefined : yield* requireTask(core, operation.taskId);
    if (
      task !== undefined &&
      (task.attempt !== operation.targets.attempt ||
        task.state === "discarded" ||
        (task.state === "landed" && operation.kind !== "landing"))
    ) {
      return yield* refuse("wrong-state", "This task changed. Open it again before continuing.");
    }
    return { operation, related, task, applied, member: yield* requireMember(applied, handle) };
  });

/**
 * A git write the interrupted operations finished on the service after the
 * Mate stopped — a WIP or merge commit carrying their trailer, a dispatch's
 * reset to your tree, or their landing — becomes the copy's recorded tip, so
 * nothing parks on an outcome the operation itself produced.
 */
export const adoptOwnWrites = (
  core: CrewCore,
  member: CrewMember,
  operations: ReadonlyArray<CrewOperation>,
  landed?: string,
) =>
  Effect.gen(function* () {
    if (member.row.kind !== "writer") return;
    const key = { crew: CREW_ID, handle: member.row.handle };
    for (const operation of operations) {
      if (operation.kind === "rebuild") continue;
      const outcome = yield* asRefusal(
        core.workspace.adopt(key, {
          operation: operation.id,
          landed: operation.kind === "landing" ? landed : undefined,
        }),
      );
      if (outcome._tag === "adopted") return;
    }
  });

const readPendingTurn = Schema.decodeUnknownOption(Schema.Struct({ turn: Schema.String }));

/**
 * The words a resumed turn carries, by the stage its dispatch confirmed: a
 * turn that never reached its agent (a task card, a person's message) goes as
 * it was; a rework hand-off cut off before its card sends that card; a turn
 * the agent had begun is asked to continue.
 */
const resumedTurn = (operation: CrewOperation, member: CrewMember, task: CrewAssignmentRow) => {
  const pending =
    operation.kind === "dispatch" && operation.confirmedStage !== "dispatched"
      ? Option.getOrUndefined(readPendingTurn(operation.result))?.turn
      : undefined;
  if (pending !== undefined) return pending;
  const on = readTaskWait(task.waiting)?.on;
  if (task.state === "rework" && (on === "conflict" || on === "check-failed" || on === "review"))
    return reworkCard(member, task, on);
  return "Continue where you stopped. Your edits remain in your copy.";
};

/** Who presses Continue: a person, or the engine itself after a restart (`resumeAfterRestart`). */
export type ContinuedBy = "person" | "engine";

/**
 * The selected work continues from its recorded stage, by the task's state —
 * never a forced rework: a queued task starts; a working task's died turn
 * continues in its attempt, and its turn-end commit is redone (a person's
 * press then carries the task on; the engine's leaves that to a running run);
 * a merging, checking or landing task merges and checks again, and a landing
 * lands; a blocked report waits for its answer, and a checked task stays as
 * it is.
 */
export const continueOperation = (
  core: CrewCore,
  principal: TurnPrincipal,
  handle: string,
  id: string,
  by: ContinuedBy = "person",
) =>
  Effect.gen(function* () {
    const { operation, related, task, applied, member } = yield* selected(core, handle, id);
    const settle = Effect.forEach(related, (row) =>
      updateOperation(core, row.id, { status: "continued" }),
    );
    if (operation.kind === "rebuild") {
      yield* rebuildCopy(core, principal, handle, true);
      yield* settle;
      return;
    }
    if (task === undefined) {
      if (operation.kind === "dispatch") {
        yield* leadTurn(core, member, principal, "Continue where you stopped.");
      } else if (operation.kind === "checkpoint") {
        // A copy saved outside any task: the save is all there is to redo.
        yield* adoptOwnWrites(core, member, related);
        yield* commitAndPolice(
          core,
          member,
          undefined,
          yield* asRefusal(core.store.assignments(CREW_ID)),
        );
      } else {
        return yield* refuse("wrong-state", "This work has no task to continue.");
      }
      yield* settle;
      yield* refreshLaneStats(core, member);
      yield* core.changed;
      return;
    }
    let evidence = readLandedEvidenceOption(operation.result);
    // The inspection may still be running at the first press. Read this exact landing before any git writes.
    if (
      operation.kind === "landing" &&
      Option.isNone(evidence) &&
      operation.targets.host !== null
    ) {
      const commit = yield* operationStep(
        core,
        operation.id,
        "reading-landing",
        asRefusal(core.integration.landingEvidence(operation.targets.host, task.assignment)),
      );
      if (commit !== null) evidence = Option.some({ _tag: "already-landed" as const, commit });
    }
    yield* adoptOwnWrites(
      core,
      member,
      related,
      Option.isSome(evidence) && operation.kind === "landing" ? evidence.value.commit : undefined,
    );
    if (operation.kind === "landing" && Option.isSome(evidence)) {
      yield* saveTask(core, {
        ...task,
        state: "landed",
        landedCommit: evidence.value.commit,
        waiting: null,
      });
      yield* settle;
      yield* core.changed;
      return;
    }
    if (operation.kind === "dispatch") {
      const ending = readDispatchEnding(operation.result);
      if (
        Option.isSome(ending) &&
        ending.value.terminalReason !== undefined &&
        operation.targets.threadId !== null
      )
        core.memory.terminalReasons.set(operation.targets.threadId, ending.value.terminalReason);
    }
    const resuming =
      task.state === "parked" && operation.kind !== "dispatch"
        ? yield* saveTask(core, { ...task, state: operation.resumeState, waiting: null })
        : task;
    const tasks = () => asRefusal(core.store.assignments(CREW_ID));
    const save = (state: CrewAssignmentRow) =>
      member.row.kind === "writer" && !CHECKED_STATES.has(state.state)
        ? Effect.flatMap(tasks(), (all) => commitAndPolice(core, member, state, all))
        : Effect.void;
    switch (resuming.state) {
      case "queued": {
        if (Option.isSome(readDirtyDispatch(operation.result))) yield* save(resuming);
        const preserved = yield* requireTask(core, task.assignment);
        if (preserved.state === "queued")
          yield* startTask(core, applied, member, preserved, principal);
        break;
      }
      case "working":
      case "rework": {
        if (operation.kind !== "dispatch") yield* save(resuming);
        const preserved = yield* requireTask(core, task.assignment);
        // Its turn died, or a person asks it on: a turn in the attempt it stands in.
        if (
          ["working", "rework"].includes(preserved.state) &&
          (operation.kind === "dispatch" || by === "person")
        )
          yield* continueTask(
            core,
            applied,
            member,
            preserved,
            principal,
            resumedTurn(operation, member, preserved),
          );
        break;
      }
      case "merging":
      case "checking":
      case "landing": {
        yield* save(resuming);
        const preserved = yield* requireTask(core, task.assignment);
        if (preserved.state === "parked") break;
        const merging =
          preserved.state === "merging"
            ? preserved
            : yield* saveTask(core, { ...preserved, state: "merging" });
        yield* integrate(core, merging.assignment, undefined, operation.stage === "setting-up");
        if (
          (operation.kind === "landing" || resuming.state === "landing") &&
          (yield* requireTask(core, task.assignment)).state === "ready"
        )
          yield* land(core, principal, task.assignment);
        break;
      }
      default:
        // Blocked on its question, checked and waiting on review or Land, or settled: as it stands.
        break;
    }
    yield* settle;
    yield* refreshLaneStats(core, member);
    yield* core.changed;
  });

/**
 * The operations a restart interrupted, carried on by the engine from their
 * last confirmed stage once the crewmate is free (its turn's end advances it
 * again), by the task's state as Continue does — the task's turn as the one
 * its dispatch runs as (`dispatchPrincipal`), a landing as the person who
 * pressed Land. A run the person paused or stopped stays as they left it: no
 * turn goes out, and Resume carries the task on. A rebuild a person chose and
 * a person's own turn in a conversation stay theirs; a resume that is refused
 * leaves its row with the words why.
 */
export const resumeAfterRestart = (core: CrewCore, handle: string) =>
  Effect.gen(function* () {
    const pending = core.memory.resumeAtBoot;
    if (pending.size === 0) return;
    const applied = yield* core.applied;
    if (applied === undefined || isWorking(core, applied, handle)) return;
    const rows = (yield* asRefusal(core.store.operations(CREW_ID))).filter(
      (row) => row.handle === handle && pending.has(row.id),
    );
    const held = applied.run !== undefined && applied.run.state !== "running";
    // The newest first: Continue settles a task's older rows with it.
    for (const row of rows.toReversed()) {
      pending.delete(row.id);
      const found = yield* asRefusal(core.store.getOperation(row.id));
      if (Option.isNone(found) || found.value.status !== "interrupted") continue;
      if (row.kind === "rebuild") continue;
      const tasks = yield* asRefusal(core.store.assignments(CREW_ID));
      const task = tasks.find((candidate) => candidate.assignment === row.taskId);
      if (row.kind === "dispatch") {
        const lead = applied.members.get(handle)?.kind === "lead";
        // The run wakes its lead again, its wakes spaced; a person's own turn is theirs.
        if (task === undefined) {
          if (lead && runningRun(applied) !== undefined && !sentBySession(row))
            yield* updateOperation(core, row.id, { status: "continued" });
          continue;
        }
        // A paused or stopped run sends no turn; Resume carries a working task on.
        if (held && ["working", "rework"].includes(task.state)) {
          yield* updateOperation(core, row.id, { status: "continued" });
          continue;
        }
      }
      if (row.taskId !== null && task === undefined) continue;
      const principal: TurnPrincipal =
        row.kind === "landing" && row.startedBy !== ""
          ? { kind: "crew", startedBy: row.startedBy }
          : task === undefined
            ? { kind: "crew", startedBy: row.startedBy }
            : dispatchPrincipal(applied, task);
      const refused = yield* continueOperation(core, principal, handle, row.id, "engine").pipe(
        Effect.as(undefined),
        Effect.catch((error) => Effect.succeed(failureWords(error))),
      );
      if (refused === undefined) continue;
      // The row a person now sees: this one, or the operation its resume began.
      const shown = (yield* asRefusal(core.store.operations(CREW_ID))).findLast(
        (candidate) =>
          candidate.handle === handle &&
          candidate.taskId === row.taskId &&
          ["failed", "interrupted"].includes(candidate.status),
      );
      if (shown !== undefined)
        yield* updateOperation(core, shown.id, {
          detail: `The Mate restarted and could not carry this on: ${refused}`,
        });
    }
  });

/** Dropping an interrupted task, or a copy save outside any, cancels its records; its files remain exactly where they are. */
export const discardOperation = (core: CrewCore, handle: string, id: string) =>
  Effect.gen(function* () {
    const { operation, related, task, member } = yield* selected(core, handle, id);
    if (operation.kind === "landing" || (task === undefined && operation.kind === "dispatch"))
      return yield* refuse("wrong-state", "Inspect and continue this work before dropping it.");
    // A copy save outside any task drops only its record; the files stay as they are.
    if (task !== undefined) yield* saveTask(core, { ...task, state: "discarded" });
    for (const row of related) yield* updateOperation(core, row.id, { status: "discarded" });
    yield* refreshLaneStats(core, member);
    yield* core.changed;
  });

/** Only a selected missing copy can be reconstructed, from the engine's recorded branch. */
export const rebuildCopy = (
  core: CrewCore,
  principal: TurnPrincipal,
  handle: string,
  continuing = false,
) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const member = yield* requireMember(applied, handle);
    if (
      member.row.kind !== "writer" ||
      isWorking(core, applied, handle) ||
      (!continuing && !core.memory.missingLanes.has(handle))
    )
      return yield* refuse("wrong-state", "This copy is not waiting to be rebuilt.");
    yield* withOperation(
      core,
      { kind: "rebuild", handle, startedBy: principalUser(principal) },
      (operation) =>
        Effect.gen(function* () {
          const result = yield* operationStep(
            core,
            operation.id,
            "rebuilding-copy",
            asRefusal(core.workspace.rebuild({ crew: CREW_ID, handle })),
            "copy-rebuilt",
          );
          if (result._tag !== "rebuilt" && !(continuing && result._tag === "present")) {
            yield* updateOperation(core, operation.id, {
              detail: "The recorded copy could not be rebuilt. Inspect its saved branch.",
              result,
            });
            return;
          }
          if (member.spec.setup !== undefined && member.row.host !== null) {
            const setup = yield* operationStep(
              core,
              operation.id,
              "setting-up",
              asRefusal(
                core.checks.run({
                  host: member.row.host,
                  lane: handle,
                  kind: "setup",
                  command: member.spec.setup,
                  crewPort: member.row.crewPort ?? undefined,
                  env: member.spec.env,
                }),
              ),
            );
            if (setup._tag !== "passed") {
              yield* updateOperation(core, operation.id, {
                detail: "Its copy was rebuilt, but setup failed.",
                result: setup,
              });
              core.memory.progress.set(handle, { state: "failed", detail: "Its setup failed." });
              return;
            }
          }
          core.memory.missingLanes.delete(handle);
          yield* refreshLaneStats(core, member);
        }),
    );
    yield* core.changed;
  });
