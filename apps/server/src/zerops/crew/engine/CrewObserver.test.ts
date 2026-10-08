import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import {
  CommandId,
  ConversationId,
  ItemId,
  type EngineEvent,
  type ItemBody,
} from "@t3tools/contracts";

import type { CrewInput } from "./command.ts";
import { observeCrew } from "./CrewObserver.ts";
import { initialCrewState, type CrewState, type MemberRecord } from "./state.ts";

const MATE = ConversationId.make("mate");
const BACKEND = ConversationId.make("crew-main-backend-1");

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
const scene = (records: Record<string, Array<EngineEvent>>) =>
  Effect.gen(function* () {
    const changes = yield* PubSub.unbounded<ConversationId>();
    let state = crewWith({});
    const told: Array<{ readonly input: CrewInput; readonly commandId: string }> = [];
    yield* observeCrew({
      changes: Stream.fromPubSub(changes),
      eventsAfter: (conversationId, afterSeq, limit = 200) =>
        Effect.succeed(
          (records[conversationId] ?? []).filter((event) => event.seq > afterSeq).slice(0, limit),
        ),
      crewState: Effect.sync(() => state),
      tell: (input, commandId) =>
        Effect.sync(() => {
          told.push({ input, commandId });
          if (input._tag === "Observed") {
            state = crewWith({
              ...state.cursors,
              [input.conversationId]: input.events.at(-1)!.seq,
            });
          }
        }),
      conversations: Effect.succeed([MATE]),
      gauges: Stream.empty,
      signIns: Stream.empty,
    });
    const settle = Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow, {
      discard: true,
    });
    yield* settle;
    return {
      told,
      changed: (conversationId: ConversationId) =>
        PubSub.publish(changes, conversationId).pipe(Effect.andThen(settle)),
    };
  });

describe("the crew's observer", () => {
  it.effect("reads each conversation's record after the crew's cursor, each event once", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const backend: Array<EngineEvent> = [
          { _tag: "RunQueued", ...header(BACKEND, 1) } as unknown as EngineEvent,
        ];
        const world = yield* scene({ [BACKEND]: backend });
        backend.push({ _tag: "RunAdmitted", ...header(BACKEND, 2) } as unknown as EngineEvent);
        yield* world.changed(BACKEND);
        yield* world.changed(BACKEND);
        assert.deepStrictEqual(
          world.told.flatMap(({ input }) =>
            input._tag === "Observed"
              ? [[input.conversationId, input.events.map((event) => event.seq)]]
              : [],
          ),
          [
            [BACKEND, [1]],
            [BACKEND, [2]],
          ],
        );
      }),
    ),
  );

  it.effect("tells a deploy the Mate's chat shows before the batch that holds it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const item = ItemId.make("mate/r/1/i/2");
        const world = yield* scene({
          [MATE]: [
            {
              _tag: "ItemOpened",
              ...header(MATE, 1),
              runId: null,
              itemId: item,
              key: null,
              by: { kind: "agent" },
              body: deployCall("running"),
            } as unknown as EngineEvent,
            {
              _tag: "ItemClosed",
              ...header(MATE, 2),
              runId: null,
              itemId: item,
              body: deployCall("done"),
            } as unknown as EngineEvent,
          ],
        });
        assert.deepStrictEqual(
          world.told.map(({ input }) =>
            input._tag === "Deploy"
              ? `${input.host} ${input.phase}`
              : input._tag === "Observed"
                ? `observed ${input.conversationId}`
                : input._tag,
          ),
          ["appdev started", "appdev ended", "observed mate"],
        );
      }),
    ),
  );

  it.effect("a deploy call a restart cut off is no deploy's end: it may still run", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const item = ItemId.make("mate/r/1/i/2");
        const world = yield* scene({
          [MATE]: [
            {
              _tag: "ItemClosed",
              ...header(MATE, 1),
              runId: null,
              itemId: item,
              body: deployCall("unreturned" as never),
            } as unknown as EngineEvent,
          ],
        });
        assert.deepStrictEqual(
          world.told.map(({ input }) => input._tag),
          ["Observed"],
        );
      }),
    ),
  );
});
