import type { CrewOperation } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { asRefusal, currentStint, type CrewCore } from "./crewCore.ts";
import { crewLane } from "./CrewDefinition.ts";
import { CREW_ID } from "./CrewHome.ts";
import type { CrewAssignmentRow } from "./CrewStore.ts";

const SESSION_OPERATION = "crew-operation:session:";

/** Whether a person's own session sent the operation's turn. */
export const sentBySession = (operation: Pick<CrewOperation, "id">): boolean =>
  operation.id.startsWith(SESSION_OPERATION);

/** A durable handle is written before any effect belonging to the attempt. */
export const beginOperation = (
  core: CrewCore,
  input: {
    readonly kind: CrewOperation["kind"];
    readonly handle: string;
    readonly task?: CrewAssignmentRow | undefined;
    readonly startedBy?: string;
    readonly id?: string;
    /** A turn a person's own session sent, not a run's or the engine's: named in its id. */
    readonly bySession?: boolean;
  },
) =>
  Effect.gen(function* () {
    const applied = yield* core.applied;
    const member = applied?.members.get(input.handle);
    const repository =
      member?.host === null || member?.host === undefined
        ? undefined
        : applied?.repositories.get(member.host);
    const now = yield* core.now;
    const row: CrewOperation = {
      id:
        input.id ??
        `${input.bySession === true ? SESSION_OPERATION : "crew-operation:"}${yield* core.uuid}`,
      crew: CREW_ID,
      handle: input.handle,
      taskId: input.task?.assignment ?? null,
      kind: input.kind,
      status: "running",
      stage: "prepared",
      confirmedStage: "prepared",
      startedBy: input.startedBy ?? input.task?.createdBy ?? "",
      resumeState: input.task?.state ?? "working",
      targets: {
        host: member?.host ?? null,
        path: repository === undefined ? null : crewLane(repository, input.handle).mountDir,
        ref:
          input.kind === "landing" && input.task !== undefined
            ? `refs/t3/crew/landing/${input.task.assignment}`
            : member?.lane === null || member?.lane === undefined
              ? null
              : `refs/heads/crew/${input.handle}`,
        threadId:
          applied === undefined ? null : (currentStint(applied, input.handle)?.threadId ?? null),
        commandId: null,
        attempt: input.task?.attempt ?? 0,
      },
      result: null,
      detail: null,
      startedAt: now,
      updatedAt: now,
    };
    yield* asRefusal(core.store.putOperation(row));
    return row;
  });

export const updateOperation = (core: CrewCore, id: string, fields: Partial<CrewOperation>) =>
  Effect.gen(function* () {
    const row = Option.getOrThrow(yield* asRefusal(core.store.getOperation(id)));
    const next = { ...row, ...fields, id: row.id, updatedAt: yield* core.now };
    yield* asRefusal(core.store.putOperation(next));
    return next;
  });

/** The outcome belongs to the step that produced it, including errors. There is no retry. */
export const operationStep = <A, E, R>(
  core: CrewCore,
  id: string,
  stage: string,
  effect: Effect.Effect<A, E, R>,
  confirmed = stage,
) =>
  Effect.gen(function* () {
    yield* updateOperation(core, id, { stage });
    const result = yield* effect.pipe(
      Effect.tapError((error) =>
        updateOperation(core, id, {
          status: "failed",
          detail: error instanceof Error ? error.message : "The operation failed.",
        }),
      ),
    );
    yield* updateOperation(core, id, { confirmedStage: confirmed, result: result ?? null });
    return result;
  });

export const finishOperation = (core: CrewCore, id: string, result: unknown, failed = false) =>
  updateOperation(core, id, { status: failed ? "failed" : "succeeded", result: result ?? null });

/** The selected member's unfinished work holds its queue until a person settles it. */
export const operationHolds = (core: CrewCore, handle: string) =>
  Effect.gen(function* () {
    const rows = yield* asRefusal(core.store.operations(CREW_ID));
    const tasks = yield* asRefusal(core.store.assignments(CREW_ID));
    return rows.some(
      (row) =>
        row.handle === handle &&
        ["failed", "interrupted"].includes(row.status) &&
        !tasks.some(
          (task) => task.assignment === row.taskId && ["landed", "discarded"].includes(task.state),
        ),
    );
  });

/** Keep ownership through the task/attempt writes that consume a side effect's receipt. */
export const withOperation = <A, E, R>(
  core: CrewCore,
  input: Parameters<typeof beginOperation>[1],
  run: (operation: CrewOperation) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const operation = yield* beginOperation(core, input);
    return yield* run(operation).pipe(
      Effect.tap(() =>
        Effect.gen(function* () {
          const current = Option.getOrThrow(
            yield* asRefusal(core.store.getOperation(operation.id)),
          );
          if (current.status === "running")
            yield* finishOperation(core, operation.id, current.result, current.detail !== null);
        }),
      ),
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          if (exit._tag === "Success") return;
          // The engine is shutting down (a Mate update, SIGTERM): the row stays running, its stage
          // confirmed, and the next boot marks it interrupted and carries it on (`crewBoot`).
          if (Cause.hasInterruptsOnly(exit.cause)) return;
          const current = Option.getOrThrow(
            yield* asRefusal(core.store.getOperation(operation.id)),
          );
          if (current.status !== "running") return;
          yield* updateOperation(core, operation.id, {
            status: "interrupted",
            detail: "The operation ended before its outcome was recorded.",
          });
        }),
      ),
    );
  });

export const acknowledgeOperations = (core: CrewCore, handle: string, taskId?: string) =>
  Effect.gen(function* () {
    for (const row of yield* asRefusal(core.store.operations(CREW_ID))) {
      if (
        row.handle === handle &&
        (taskId === undefined || row.taskId === taskId) &&
        (["failed", "interrupted"].includes(row.status) ||
          // The failed receipt may already have changed the task while its final read still runs.
          (row.status === "running" && row.detail !== null))
      ) {
        yield* updateOperation(core, row.id, { status: "continued" });
      }
    }
  });
