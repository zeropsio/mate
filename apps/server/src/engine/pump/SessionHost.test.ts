import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { SessionId, type TurnHandle } from "@t3tools/contracts";

import { makeHostHarness } from "../testing/pump/hostHarness.ts";

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
});
