import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { SessionId, type TurnHandle } from "@t3tools/contracts";

import { hostEvent, makeHostHarness } from "../testing/pump/hostHarness.ts";

const S1 = SessionId.make("mate/s/1.1");
const H1 = "mate/r/1" as TurnHandle;

describe("SessionHost", () => {
  it.effect("a send's evidence reaches it even when the driver answered before it waited", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { host } = yield* makeHostHarness();
        yield* host.begin(S1);
        yield* host.record({ kind: "start", session: S1, from: "fresh" });
        yield* host.record({ kind: "started" });
        yield* host.openGate(S1);
        const evidence = yield* host.beginSend(H1, "new");
        yield* host.record({ kind: "sent", turn: H1, nativeTurn: "T1" });
        // The driver took it, and the host folded that, before the handler waits.
        yield* host.settled;
        assert.deepStrictEqual(yield* evidence, { _tag: "Accepted", as: "opened", into: null });
      }),
    ),
  );

  it.effect(
    "a batch the actor fails to take is told again until it takes it, so a turn's end is never lost",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { host, told } = yield* makeHostHarness({ failFirst: 8 });
          yield* host.begin(S1);
          yield* host.record({ kind: "start", session: S1, from: "fresh" });
          yield* host.record({ kind: "started" });
          yield* host.openGate(S1);
          yield* Effect.asVoid(host.beginSend(H1, "new"));
          yield* host.record({ kind: "sent", turn: H1, nativeTurn: "T1" });
          yield* host.offer(
            hostEvent("turn.completed", { turnId: "T1", payload: { state: "completed" } }),
          );
          const settled = yield* Effect.forkChild(host.settled);
          for (let i = 0; i < 20; i++) yield* TestClock.adjust("30 seconds");
          yield* Fiber.join(settled);
          assert.deepStrictEqual(
            told.flat().map((signal) => signal.kind),
            ["turn-started", "turn-ended"],
          );
        }),
      ),
  );
});
