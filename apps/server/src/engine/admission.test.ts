import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { runId, type Principal } from "@t3tools/contracts";

import { makeEngineWorld, mate } from "./testing/pump/engineWorld.ts";

const bob: Principal = { kind: "person", subject: "zerops:bob" };
const refuseBob = (principal: Principal) =>
  principal.kind === "person" && principal.subject === "zerops:bob"
    ? "Bob did not sign this agent in."
    : undefined;

const world = Effect.gen(function* () {
  const w = yield* makeEngineWorld({ driver: "claudeAgent", refuse: refuseBob });
  yield* w.boot;
  yield* w.tell({
    _tag: "AssignAgent",
    agent: {
      instanceId: "claudeAgent",
      driver: "claudeAgent",
      model: "m1",
      profile: { kind: "mate" },
    },
  });
  return w;
});

describe("D6 on the engine: whose login a person's words spend", () => {
  it.effect(
    "a steer into someone else's run is admitted for the person steering, and refused reads refused",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          yield* w.tell({ _tag: "Send", text: "Deploy the api" });
          const sentBefore = w.provider.calls.length;
          yield* w.tell({ _tag: "Steer", runId: runId(mate, 1), text: "and the web too" }, bob);
          assert.strictEqual(
            w.provider.calls.length,
            sentBefore,
            "nothing of Bob's reached the agent",
          );
          const steered = (yield* w.items(runId(mate, 1))).find(
            (item) => item.kind === "person" && item.body.text === "and the web too",
          );
          assert.deepStrictEqual(
            (steered?.body.delivery as { readonly state: string } | undefined)?.state,
            "refused",
          );
          assert.strictEqual((yield* w.run(runId(mate, 1)))?.state, "running");
          yield* w.shutdown;
        }),
      ),
  );

  it.effect("a maintenance command is admitted like any run, without a workspace capture", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        yield* w.tell({ _tag: "Send", text: "/compact", maintenance: true }, bob);
        const run = yield* w.run(runId(mate, 1));
        assert.deepStrictEqual(
          [run?.state, run?.end],
          ["ended", { kind: "failed", reason: "Bob did not sign this agent in.", next: null }],
        );
        assert.deepStrictEqual(w.provider.calls, []);
        assert.deepStrictEqual(w.history.calls, []);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("a person's own maintenance command goes without a capture", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        yield* w.tell({ _tag: "Send", text: "/compact", maintenance: true });
        assert.strictEqual((yield* w.run(runId(mate, 1)))?.state, "running");
        assert.deepStrictEqual(
          w.history.calls.filter((call) => call.startsWith("prepare")),
          [],
        );
        yield* w.shutdown;
      }),
    ),
  );
});
