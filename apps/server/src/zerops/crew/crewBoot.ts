import { crewLane } from "./CrewDefinition.ts";
import { refreshClaims } from "./crewClaims.ts";
/** A restart ends recorded work. It never commits, reconstructs a copy, or advances a queue. */
import * as Effect from "effect/Effect";
import { asRefusal, type CrewCore } from "./crewCore.ts";
import { CREW_ID } from "./CrewHome.ts";
import { beginOperation, updateOperation } from "./crewOperations.ts";
import { refreshLaneStats } from "./crewLanding.ts";
import { memberOf } from "./crewCore.ts";

export const boot = (core: CrewCore) =>
  Effect.gen(function* () {
    const applied = yield* core.applied;
    if (applied === undefined) return;
    const operations = [...(yield* asRefusal(core.store.operations(CREW_ID)))];
    for (const task of yield* asRefusal(core.store.assignments(CREW_ID))) {
      if (!["working", "merging", "checking", "landing"].includes(task.state)) continue;
      const attempts = yield* asRefusal(core.store.attemptsOf(task.assignment));
      const attempt = attempts.find((row) => row.attempt === task.attempt);
      // Older builds kept only the task stage. An ended turn already has its receipt.
      if (
        !operations.some((operation) => operation.taskId === task.assignment) &&
        !(task.state === "working" && attempt?.endedAt !== null && attempt?.endedAt !== undefined)
      ) {
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
      if (attempt !== undefined && attempt.endedAt === null)
        yield* asRefusal(
          core.store.putAttempt({
            ...attempt,
            ending: "interrupted",
            endingDetail: "The Mate restarted before its outcome was recorded.",
            endedAt: yield* core.now,
          }),
        );
    }
    for (const operation of operations) {
      if (operation.status !== "running") continue;
      yield* updateOperation(core, operation.id, {
        status: "interrupted",
        detail: operation.detail ?? "The Mate restarted before its outcome was recorded.",
      });
    }
    if (applied.run?.state === "running") {
      yield* asRefusal(
        core.store.putRun({
          ...applied.run,
          state: "paused",
          reason: "person",
          reasonDetail: "The Mate restarted. Continue the work you choose.",
        }),
      );
      yield* asRefusal(core.reload);
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
