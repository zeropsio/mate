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

const deployCall = (state: "running" | "done" | "unreturned"): ItemBody =>
  ({
    kind: "call",
    step: "mcp",
    tool: { name: "mcp__zerops__zerops_deploy", server: "zerops" },
    words: null,
    state,
    endedAt: null,
    shows: { targetService: "appdev" },
  }) as ItemBody;

const crewWith = (cursors: Readonly<Record<string, number>>): CrewState => ({
  ...initialCrewState(),
  order: ["backend"],
  members: { backend: { handle: "backend", conversationId: BACKEND } as MemberRecord },
  cursors,
});

/** A world of records and a crew whose cursor moves as each batch is told. */
const scene = (
  records: Record<string, Array<EngineEvent>>,
  /** How many of the first `Observed` tells the crew does not take in. */
  unrecorded = 0,
) =>
  Effect.gen(function* () {
    let failures = unrecorded;
    const changes = yield* PubSub.unbounded<ConversationId>();
    const changeSubscription = yield* PubSub.subscribe(changes);
    const reads = yield* Queue.unbounded<ConversationId>();
    let state = crewWith({});
    const told: Array<{ readonly input: CrewInput; readonly commandId: string }> = [];
    yield* observeCrew({
      changes: Stream.fromSubscription(changeSubscription),
      eventsAfter: (conversationId, afterSeq, limit = 200) =>
        Effect.gen(function* () {
          const events = (records[conversationId] ?? [])
            .filter((event) => event.seq > afterSeq)
            .slice(0, limit);
          if (events.length === 0) yield* Queue.offer(reads, conversationId);
          return events;
        }),
      crewState: Effect.sync(() => state),
      tell: (input, commandId) =>
        Effect.gen(function* () {
          if (input._tag === "Observed" && failures-- > 0) {
            yield* Queue.offer(reads, input.conversationId);
            return yield* Effect.fail(
              new CrewInputUnrecorded({ detail: "the step did not commit" }),
            );
          }
          told.push({ input, commandId });
          if (input._tag === "Observed") {
            state = crewWith({
              ...state.cursors,
              [input.conversationId]: input.events.at(-1)!.seq,
            });
            yield* Queue.offer(reads, input.conversationId);
          }
        }),
      conversations: Effect.succeed([MATE]),
      gauges: Stream.empty,
      signIns: Stream.empty,
      processes: Effect.succeed(Stream.empty),
    });
    // The initial backend and Mate catch-ups each report either their read or their tell.
    yield* Queue.take(reads);
    yield* Queue.take(reads);
    return {
      told,
      read: Queue.take(reads),
      changed: (conversationId: ConversationId) =>
        PubSub.publish(changes, conversationId).pipe(Effect.andThen(Queue.take(reads))),
    };
  });

const observedSeqs = (told: ReadonlyArray<{ readonly input: CrewInput }>) =>
  told.flatMap(({ input }) =>
    input._tag === "Observed"
      ? [[input.conversationId, input.events.map((event) => event.seq)] as const]
      : [],
  );

// witness: apps/server/src/zerops/crew/engine/CrewObserver.ts | let cursor = state.cursors[conversationId] ?? 0; → let cursor = 0;
it.effect(
  "CD36: The crew's observer reads each conversation's record after the crew's cursor and tells each event once, and a batch the crew could not take in is read again from the same cursor, nothing skipped",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const backend: Array<EngineEvent> = [
          { _tag: "RunQueued", ...header(BACKEND, 1) } as unknown as EngineEvent,
        ];
        const world = yield* scene({ [BACKEND]: backend });
        backend.push({ _tag: "RunAdmitted", ...header(BACKEND, 2) } as unknown as EngineEvent);
        yield* world.changed(BACKEND);
        yield* world.changed(BACKEND);
        expect(observedSeqs(world.told)).toEqual([
          [BACKEND, [1]],
          [BACKEND, [2]],
        ]);

        // The crew does not take in the first batch; no change follows.
        const refused = yield* scene(
          {
            [BACKEND]: [
              { _tag: "RunQueued", ...header(BACKEND, 1) } as unknown as EngineEvent,
              { _tag: "RunAdmitted", ...header(BACKEND, 2) } as unknown as EngineEvent,
            ],
          },
          1,
        );
        yield* refused.read;
        expect(observedSeqs(refused.told)).toEqual([[BACKEND, [1, 2]]]);
      }),
    ).pipe(Effect.provideService(Clock.Clock, INSTANT)),
);

// witness: apps/server/src/zerops/crew/engine/CrewObserver.ts | if (body.state === "unreturned" || body.state === "stopped") return undefined; → if (body.state === "stopped") return undefined;
it.effect(
  "CD37: A zerops_deploy call a restart cut off is no end of the deploy, so its host stays frozen",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const world = yield* scene({
          [MATE]: [
            {
              _tag: "ItemClosed",
              ...header(MATE, 1),
              runId: null,
              itemId: ItemId.make("mate/r/1/i/2"),
              body: deployCall("unreturned"),
            } as unknown as EngineEvent,
          ],
        });
        expect(world.told.map(({ input }) => input._tag)).toEqual(["Observed"]);
      }),
    ).pipe(Effect.provideService(Clock.Clock, INSTANT)),
);

// witness: apps/server/src/zerops/crew/engine/CrewObserver.ts | result.migratedToSupervisor !== true → result.migratedToSupervisor !== "true"
it.effect(
  "CD38: A dev server start that moved the dev service onto the supervisor is a deploy of that host: frozen, then recovered",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const world = yield* scene({
          [MATE]: [
            {
              _tag: "ItemClosed",
              ...header(MATE, 1),
              runId: null,
              itemId: ItemId.make("mate/r/1/i/3"),
              body: {
                kind: "call",
                step: "mcp",
                tool: { name: "mcp__zerops__zerops_dev_server", server: "zerops" },
                words: null,
                state: "done",
                endedAt: null,
                input: 'mcp__zerops__zerops_dev_server: {"action":"start","hostname":"appdev"}',
                result: {
                  toolName: "zerops_dev_server",
                  resultText: JSON.stringify({
                    running: true,
                    message: "Dev server web is running.",
                    migratedToSupervisor: true,
                  }),
                },
              },
            } as unknown as EngineEvent,
            {
              _tag: "ItemClosed",
              ...header(MATE, 2),
              runId: null,
              itemId: ItemId.make("mate/r/1/i/4"),
              body: {
                kind: "call",
                step: "mcp",
                tool: { name: "mcp__zerops__zerops_dev_server", server: "zerops" },
                words: null,
                state: "done",
                endedAt: null,
                result: {
                  toolName: "zerops_dev_server",
                  resultText: JSON.stringify({
                    running: true,
                    message: "Dev server web is running.",
                  }),
                },
              },
            } as unknown as EngineEvent,
          ],
        });
        expect(
          world.told.map(({ input }) =>
            input._tag === "Deploy" ? `${input.host} ${input.phase}` : input._tag,
          ),
        ).toEqual(["appdev started", "appdev ended", "Observed"]);
      }),
    ).pipe(Effect.provideService(Clock.Clock, INSTANT)),
);
