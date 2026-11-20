import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { BootId, ConversationId, EffectId } from "@t3tools/contracts";

import type { Decision, EffectClass, EffectLane } from "../domain/command.ts";
import { EngineStore } from "../store/EngineStore.ts";
import { envelope } from "../testing/fixtures.ts";
import { engineLayer } from "../testing/world.ts";
import { handlersOf } from "./EffectWorker.ts";
import { EffectOutbox, type EffectPool } from "./EffectOutbox.ts";

const boot = BootId.make("boot-1");

interface Queued {
  readonly id: string;
  readonly lane?: EffectLane;
  readonly class?: EffectClass;
}

/** Commits a step that only queues effects, at time 0, as `decide` would for a run. */
const enqueue = (conversation: ConversationId, effects: ReadonlyArray<Queued>) =>
  Effect.gen(function* () {
    const store = yield* EngineStore;
    const state = yield* store.load(conversation);
    const rows = effects.map((effect) => ({
      effectId: EffectId.make(effect.id),
      kind: "test.echo",
      lane: effect.lane ?? "turn",
      class: effect.class ?? "replay-safe",
      runId: null,
      payload: { id: effect.id },
    }));
    const decision: Decision = {
      _tag: "Accept",
      step: {
        events: rows.map((row) => ({
          _tag: "EffectRequested" as const,
          effectId: row.effectId,
          kind: row.kind,
          runId: null,
        })),
        effects: rows,
        details: [],
        result: { _tag: "Accepted", seq: state.headSeq + rows.length },
      },
    };
    yield* store.commit({
      envelope: envelope({ _tag: "Archive" }, { conversation }),
      decision,
      state,
      now: 0,
    });
  });

/** The row a claim at `now` takes, as `<effect>#<attempt>`, or "none". */
const take = (now: number, pool?: EffectPool) =>
  Effect.flatMap(EffectOutbox, (outbox) => outbox.claim(boot, now, pool)).pipe(
    Effect.map(
      Option.match({
        onNone: () => "none",
        onSome: (row) => `${row.effectId}#${row.attempt}`,
      }),
    ),
  );

// witness: apps/server/src/engine/outbox/EffectOutbox.ts | AND p.state IN ('pending', 'running', 'settling') → AND p.state IN ('running', 'settling')
it.effect(
  "EO1: Effects are claimed first-in first-out per conversation and lane, and a row in backoff holds the rows behind it while other lanes and conversations go on; breaks: a message overtakes the one before it",
  () =>
    Effect.gen(function* () {
      const outbox = yield* EffectOutbox;
      const a = ConversationId.make("a");
      const b = ConversationId.make("b");
      yield* enqueue(a, [{ id: "a1" }, { id: "a2" }, { id: "a3", lane: "side" }]);
      yield* enqueue(b, [{ id: "b1" }]);
      const first = [yield* take(0), yield* take(0), yield* take(0), yield* take(0)];
      // a1's first try fails: back to pending, due after its backoff (100 ms after the first try).
      const a1 = Option.getOrThrow(yield* outbox.row(EffectId.make("a1")));
      yield* outbox.retry(a1, 0, "busy");
      const inBackoff = yield* take(99);
      const due = yield* take(100);
      yield* outbox.close(EffectId.make("a1"), "done", "test");
      const behind = yield* take(100);
      expect({ first, inBackoff, due, behind }).toEqual({
        first: ["a1#1", "a3#1", "b1#1", "none"],
        inBackoff: "none",
        due: "a1#2",
        behind: "a2#1",
      });
    }).pipe(Effect.provide(engineLayer(":memory:", handlersOf()))),
);

// witness: apps/server/src/engine/outbox/EffectOutbox.ts | AND ${alias}.lane != '${MATE_WIDE_LANE}') → AND ${alias}.lane = 'turn')
it.effect(
  "EO2: A Stop or an answer is claimed while the send before it is still in flight; breaks: a Stop waits behind a hanging send",
  () =>
    Effect.gen(function* () {
      const c = ConversationId.make("lanes");
      yield* enqueue(c, [
        { id: "send", lane: "turn", class: "process-bound" },
        { id: "next-send", lane: "turn", class: "process-bound" },
        { id: "interrupt", lane: "control", class: "process-bound" },
        { id: "answer", lane: "control", class: "process-bound" },
      ]);
      // The conversations' fibers claim: the send is in flight, its interrupt goes, each lane's
      // next row waits for the one before it.
      const claimed = [
        yield* take(0, "conversations"),
        yield* take(0, "conversations"),
        yield* take(0, "conversations"),
      ];
      expect(claimed).toEqual(["send#1", "interrupt#1", "none"]);
    }).pipe(Effect.provide(engineLayer(":memory:", handlersOf()))),
);
