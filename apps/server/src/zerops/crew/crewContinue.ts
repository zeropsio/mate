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
import { updateOperation, withOperation, operationStep } from "./crewOperations.ts";
import { integrate, land, refreshLaneStats } from "./crewLanding.ts";
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

/** The selected work continues from its recorded stage: a person's press, or the engine's own after a restart. */
export const continueOperation = (
  core: CrewCore,
  principal: TurnPrincipal,
  handle: string,
  id: string,
) =>
  Effect.gen(function* () {
    const { operation, related, task, applied, member } = yield* selected(core, handle, id);
    if (operation.kind === "rebuild") {
      yield* rebuildCopy(core, principal, handle, true);
      for (const row of related) yield* updateOperation(core, row.id, { status: "continued" });
      return;
    }
    if (task === undefined && operation.kind !== "dispatch")
      return yield* refuse("wrong-state", "This work has no task to continue.");
    // Keep the old ending visible until the next operation owns the selected effects.
    if (task === undefined) {
      if (operation.kind !== "dispatch")
        return yield* refuse("wrong-state", "This work has no task to continue.");
      yield* leadTurn(core, member, principal, "Continue where you stopped.");
      for (const row of related) yield* updateOperation(core, row.id, { status: "continued" });
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
      for (const row of related) yield* updateOperation(core, row.id, { status: "continued" });
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
      if (task.state === "queued") {
        if (Option.isSome(readDirtyDispatch(operation.result)))
          yield* commitAndPolice(
            core,
            member,
            task,
            yield* asRefusal(core.store.assignments(CREW_ID)),
          );
        const preserved = yield* requireTask(core, task.assignment);
        if (preserved.state === "queued")
          yield* startTask(core, applied, member, preserved, principal);
      } else {
        const next = yield* saveTask(core, { ...task, state: "rework", waiting: null });
        yield* continueTask(
          core,
          applied,
          member,
          next,
          principal,
          "Continue where you stopped. Its edits remain in its copy.",
        );
      }
    } else {
      const resuming =
        task.state === "parked"
          ? yield* saveTask(core, { ...task, state: operation.resumeState, waiting: null })
          : task;
      if (member.row.kind === "writer")
        yield* commitAndPolice(
          core,
          member,
          resuming,
          yield* asRefusal(core.store.assignments(CREW_ID)),
        );
      const preserved = yield* requireTask(core, task.assignment);
      if (preserved.state === "parked") {
        for (const row of related) yield* updateOperation(core, row.id, { status: "continued" });
        return;
      }
      if (operation.kind === "checkpoint" && task.state === "working") {
        const next = yield* saveTask(core, { ...preserved, state: "rework", waiting: null });
        yield* continueTask(
          core,
          applied,
          member,
          next,
          principal,
          "Continue where you stopped. Its saved work remains in its copy.",
        );
      } else if (operation.kind !== "checkpoint" || task.state === "merging") {
        const merging = yield* saveTask(core, { ...preserved, state: "merging" });
        yield* integrate(core, merging.assignment, undefined, operation.stage === "setting-up");
        if (
          operation.kind === "landing" &&
          (yield* requireTask(core, task.assignment)).state === "ready"
        )
          yield* land(core, principal, task.assignment);
      }
    }
    for (const row of related) yield* updateOperation(core, row.id, { status: "continued" });
    yield* refreshLaneStats(core, member);
    yield* core.changed;
  });

/**
 * The operations a restart interrupted, carried on by the engine from their
 * last confirmed stage once the crewmate is free (its turn's end advances it
 * again): each redoes its side effect or records the outcome its receipt
 * already holds, as Continue does — the task's turn as the one its dispatch
 * runs as (`dispatchPrincipal`), a landing as the person who pressed Land.
 * A rebuild a person chose and a conversation's own turn outside a run stay
 * theirs; a resume that is refused leaves its row with the words why.
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
    // The newest first: Continue settles a task's older rows with it.
    for (const row of rows.toReversed()) {
      pending.delete(row.id);
      const found = yield* asRefusal(core.store.getOperation(row.id));
      if (Option.isNone(found) || found.value.status !== "interrupted") continue;
      if (row.kind === "rebuild") continue;
      if (row.taskId === null) {
        const lead = applied.members.get(handle)?.kind === "lead";
        // The run wakes its lead again, its wakes spaced; a person's own turn is theirs.
        if (lead && runningRun(applied) !== undefined)
          yield* updateOperation(core, row.id, { status: "continued" });
        continue;
      }
      const task = (yield* asRefusal(core.store.assignments(CREW_ID))).find(
        (candidate) => candidate.assignment === row.taskId,
      );
      if (task === undefined) continue;
      const principal: TurnPrincipal =
        row.kind === "landing" && row.startedBy !== ""
          ? { kind: "crew", startedBy: row.startedBy }
          : dispatchPrincipal(applied, task);
      const refused = yield* continueOperation(core, principal, handle, row.id).pipe(
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

/** Dropping an interrupted task cancels its records; its files remain exactly where they are. */
export const discardOperation = (core: CrewCore, handle: string, id: string) =>
  Effect.gen(function* () {
    const { operation, related, task, member } = yield* selected(core, handle, id);
    if (operation.kind === "landing" || task === undefined)
      return yield* refuse("wrong-state", "Inspect and continue this work before dropping it.");
    yield* saveTask(core, { ...task, state: "discarded" });
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
