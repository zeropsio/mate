import {
  CommandId,
  ConversationId,
  ItemId,
  type EngineEvent,
  type ItemBody,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import type { CrewInput } from "./command.ts";
import { CrewInputUnrecorded, observeCrew } from "./CrewObserver.ts";
import { initialCrewState, type CrewState, type MemberRecord } from "./state.ts";

const MATE = ConversationId.make("mate");
const BACKEND = ConversationId.make("crew-main-backend-1");
/** A conversation with no record whose change the scene sends last, to wait out the others. */
const LAST = ConversationId.make("last");

/** The injected clock: a fixed instant, and a wait that is over at once (a catch-up's retry). */
const INSTANT: Clock.Clock = {
  currentTimeMillisUnsafe: () => 1_000,
  currentTimeMillis: Effect.succeed(1_000),
  currentTimeNanosUnsafe: () => 1_000_000_000n,
  currentTimeNanos: Effect.succeed(1_000_000_000n),
  monotonicTimeNanosUnsafe: () => 1_000_000_000n,
  monotonicTimeNanos: Effect.succeed(1_000_000_000n),
  sleep: () => Effect.void,
};

const header = (conversationId: ConversationId, seq: number) => ({
  v: 1,
  conversationId,
  seq,
  at: 1_000 + seq,
  commandId: CommandId.make(`c${seq}`),
});

const crewWith = (cursors: Readonly<Record<string, number>>): CrewState => ({
  ...initialCrewState(),
  order: ["backend"],
  members: { backend: { handle: "backend", conversationId: BACKEND } as MemberRecord },
  cursors,
});

/**
 * A world of records and a crew whose cursor moves to each range told. Catch-ups run in the order
 * their changes came, so the read of an empty last conversation says every earlier one is done.
 */
const scene = (
  records: Record<string, Array<EngineEvent>>,
  /** How many of the first `Observed` tells the crew does not take in. */
  unrecorded = 0,
) =>
  Effect.gen(function* () {
    let failures = unrecorded;
    const changes = yield* PubSub.unbounded<ConversationId>();
    const changeSubscription = yield* PubSub.subscribe(changes);
    const lastReads = yield* Queue.unbounded<void>();
    const tells = yield* Queue.unbounded<void>();
    let state = crewWith({});
    const told: Array<{ readonly input: CrewInput; readonly commandId: string }> = [];
    yield* observeCrew({
      changes: Stream.fromSubscription(changeSubscription),
      eventsAfter: (conversationId, afterSeq, limit = 200) =>
        Effect.gen(function* () {
          if (conversationId === LAST) yield* Queue.offer(lastReads, undefined);
          return (records[conversationId] ?? [])
            .filter((event) => event.seq > afterSeq)
            .slice(0, limit);
        }),
      crewState: Effect.sync(() => state),
      tell: (input, commandId) =>
        Effect.gen(function* () {
          if (input._tag === "Observed" && failures-- > 0) {
            return yield* Effect.fail(
              new CrewInputUnrecorded({ detail: "the step did not commit" }),
            );
          }
          told.push({ input, commandId });
          if (input._tag === "Observed") {
            state = crewWith({ ...state.cursors, [input.conversationId]: input.upTo });
          }
          yield* Queue.offer(tells, undefined);
        }),
      conversations: Effect.succeed([MATE]),
      gauges: Stream.empty,
      signIns: Stream.empty,
      processes: Effect.succeed(Stream.empty),
    });
    const settled = PubSub.publish(changes, LAST).pipe(Effect.andThen(Queue.take(lastReads)));
    // The initial backend and Mate catch-ups.
    yield* settled;
    return {
      told,
      nextTell: Queue.take(tells),
      changed: (conversationId: ConversationId) =>
        PubSub.publish(changes, conversationId).pipe(Effect.andThen(settled)),
    };
  });

const observedRanges = (told: ReadonlyArray<{ readonly input: CrewInput }>) =>
  told.flatMap(({ input }) =>
    input._tag === "Observed"
      ? [
          [
            input.conversationId,
            input.from,
            input.upTo,
            input.events.map((event) => event.seq),
          ] as const,
        ]
      : [],
  );

// witness: apps/server/src/zerops/crew/engine/CrewObserver.ts | let cursor = state.cursors[conversationId] ?? 0; → let cursor = 0;
it.effect(
  "CD36: The crew's observer reads each conversation's record after the crew's cursor and tells each event the crew reads once, and a batch the crew could not take in is read again from the same cursor, nothing skipped",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const backend: Array<EngineEvent> = [
          { _tag: "RunAdmitted", ...header(BACKEND, 1) } as unknown as EngineEvent,
        ];
        const world = yield* scene({ [BACKEND]: backend });
        backend.push({ _tag: "RunStarted", ...header(BACKEND, 2) } as unknown as EngineEvent);
        yield* world.changed(BACKEND);
        yield* world.changed(BACKEND);
        expect(observedRanges(world.told)).toEqual([
          [BACKEND, 1, 1, [1]],
          [BACKEND, 2, 2, [2]],
        ]);

        // The crew does not take in the first batch; no change follows.
        const refused = yield* scene(
          {
            [BACKEND]: [
              { _tag: "RunAdmitted", ...header(BACKEND, 1) } as unknown as EngineEvent,
              { _tag: "RunStarted", ...header(BACKEND, 2) } as unknown as EngineEvent,
            ],
          },
          1,
        );
        yield* refused.nextTell;
        expect(observedRanges(refused.told)).toEqual([[BACKEND, 1, 2, [1, 2]]]);
      }),
    ).pipe(Effect.provideService(Clock.Clock, INSTANT)),
);

// witness: apps/server/src/zerops/crew/engine/CrewObserver.ts | if (read.length > 0) { → if (read.length >= 0) {
it.effect(
  "CD+1: The crew takes in a conversation's range in one step, the events it reads folded and its cursor moved past the rest; breaks: the crew misses a run's end the observer skipped, or its record grows by an event per commit",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const run = "mate/r/1";
        const note = (text: string): ItemBody => ({ kind: "note", text }) as unknown as ItemBody;
        const mate: Array<EngineEvent> = [
          { _tag: "RunAdmitted", ...header(MATE, 1), runId: run } as unknown as EngineEvent,
        ];
        const world = yield* scene({ [MATE]: mate });
        // Two commits of the Mate's turn that hold nothing the crew reads, then its end.
        mate.push({
          _tag: "ItemOpened",
          ...header(MATE, 2),
          runId: run,
          itemId: ItemId.make("mate/r/1/i/1"),
          body: note("Reading the logs"),
        } as unknown as EngineEvent);
        yield* world.changed(MATE);
        mate.push({
          _tag: "ItemUpdated",
          ...header(MATE, 3),
          runId: run,
          itemId: ItemId.make("mate/r/1/i/1"),
          body: note("Reading the logs of appdev"),
        } as unknown as EngineEvent);
        yield* world.changed(MATE);
        mate.push({ _tag: "RunEnded", ...header(MATE, 4), runId: run } as unknown as EngineEvent);
        yield* world.changed(MATE);
        expect(observedRanges(world.told)).toEqual([
          [MATE, 1, 1, [1]],
          [MATE, 2, 4, [4]],
        ]);
      }),
    ).pipe(Effect.provideService(Clock.Clock, INSTANT)),
);
