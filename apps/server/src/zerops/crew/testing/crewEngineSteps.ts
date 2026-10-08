/**
 * The steps engine tests share: the person's presses as `KAREL`, the feed's
 * latest frame, what the engine dispatched, and a crew applied with a first
 * turn running. Every step runs against the engine `withCrewEngine` builds.
 *
 * @module crewEngineSteps
 */
import { type CrewSnapshot, type OrchestrationCommand, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { ZEROPS_SUBJECT_PREFIX } from "../../ZeropsMembershipWatch.ts";
import type { TurnPrincipal } from "../../ZeropsTurnAdmission.ts";
import { CrewEngine } from "../CrewEngine.ts";
import { CrewThreadDirectory, CrewToolHost } from "../crewSeams.ts";
import { eventually, spiEvent, writeCrewHome, type CrewWorld } from "./crewEngineFixture.ts";

export const KAREL: TurnPrincipal = {
  kind: "session",
  subject: `${ZEROPS_SUBJECT_PREFIX}user-karel`,
};

/** The engine acting for the person outside their session: a run's or a task's later turns. */
export const AS_CREW: TurnPrincipal = {
  kind: "crew",
  startedBy: KAREL.kind === "session" ? KAREL.subject.slice(ZEROPS_SUBJECT_PREFIX.length) : "",
};

export const latest = Effect.flatMap(CrewEngine, (engine) =>
  engine.snapshot.pipe(Stream.take(1), Stream.runHead, Effect.map(Option.getOrThrow)),
);

/** A press of the person's. */
export const command = (input: Parameters<CrewEngine["Service"]["command"]>[0]) =>
  Effect.flatMap(CrewEngine, (engine) => engine.command(input, KAREL));

/** A press of the person's once the crewmate's copy is free: the boot's own work may hold it a moment. */
export const commandWhenFree = (input: Parameters<CrewEngine["Service"]["command"]>[0]) =>
  eventually(
    command(input).pipe(
      Effect.as(true),
      Effect.catchTags({
        CrewCommandError: (error) =>
          error.detail?.includes("is busy") === true ? Effect.succeed(false) : Effect.fail(error),
      }),
    ),
  );

export const dispatchedOf = <T extends OrchestrationCommand["type"]>(world: CrewWorld, type: T) =>
  Effect.map(Ref.get(world.dispatched), (all) =>
    all.filter(
      (entry): entry is Extract<OrchestrationCommand, { readonly type: T }> => entry.type === type,
    ),
  );

/** The seam lines the engine wrote into crewmates' chats: thread, words, payload. */
export const seamsOf = (world: CrewWorld) =>
  Effect.map(dispatchedOf(world, "thread.activity.append"), (all) =>
    all
      .filter((entry) => entry.activity.kind === "crew.seam")
      .map((entry) => [entry.threadId, entry.activity.summary, entry.activity.payload]),
  );

export const everyCopyReady = (snapshot: CrewSnapshot) =>
  snapshot.status === "applied" &&
  snapshot.crewmates.every((mate) => mate.readOnly || mate.lane?.state === "ready");

/**
 * The first snapshot the engine publishes that `check` holds for, the one it holds now included.
 * It waits on the engine, not on a clock: a loaded machine makes it wait longer, and only the
 * test's own budget ends it.
 */
export const snapshotWhere = (check: (snapshot: CrewSnapshot) => boolean) =>
  Effect.flatMap(CrewEngine, (engine) =>
    engine.snapshot.pipe(Stream.filter(check), Stream.runHead, Effect.map(Option.getOrThrow)),
  );

/** A ready task can still be finishing its lane read; editing waits for its owner's receipt. */
export const copyOperationsFinished = (handle: string) =>
  snapshotWhere(
    (snapshot) =>
      snapshot.operations !== undefined &&
      snapshot.operations.every(
        (operation) => operation.handle !== handle || operation.status !== "running",
      ),
  );

/** Applies the crew home and waits until every copy is ready. */
export const applied = (world: CrewWorld) =>
  Effect.gen(function* () {
    writeCrewHome(world.workspace);
    yield* command({ _tag: "apply" });
    yield* snapshotWhere(everyCopyReady);
  });

/** Opens a task with a message and starts its first turn, with `edit` made in the copy. */
export const firstTurn = (world: CrewWorld, edit: () => void) =>
  Effect.gen(function* () {
    yield* command({ _tag: "message", handle: "backend", text: "Change a.txt", attachments: [] });
    const thread = (yield* dispatchedOf(world, "thread.crew.create")).find(
      (entry) => entry.crew.crewmate === "backend",
    )!.threadId;
    yield* world.publish(spiEvent("turn.started", thread, {}));
    edit();
    return thread;
  });

/** The crewmate of `thread` calls `crew_report(done)`. */
export const reportDone = (thread: ThreadId) =>
  Effect.gen(function* () {
    const member = Option.getOrThrow(yield* (yield* CrewThreadDirectory).memberFor(thread));
    yield* (yield* CrewToolHost).report(member, { status: "done", summary: "Done." });
  });
