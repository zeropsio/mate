import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CrewPlatformProcesses } from "../../crewDeployState.ts";
import { withCrewEffects } from "../../testing/crewEffectFixture.ts";
import { CrewDelivery } from "./deliver.ts";
import { crewEffects, makeCrewEffectHandlers } from "./index.ts";
import { CREW_EFFECT_KINDS } from "./shared.ts";

const ports = Layer.mergeAll(
  Layer.succeed(CrewPlatformProcesses, { read: Effect.succeed(undefined) }),
  Layer.succeed(CrewDelivery, { deliver: () => Effect.die("not delivered in this test") }),
);

describe("crew effects", () => {
  it.effect("every crew effect kind has exactly one handler", () =>
    withCrewEffects(() =>
      Effect.gen(function* () {
        const handlers = yield* makeCrewEffectHandlers;
        assert.deepStrictEqual(
          handlers.map((handler) => handler.kind).toSorted(),
          Object.values(CREW_EFFECT_KINDS).toSorted(),
        );
      }).pipe(Effect.provide(ports)),
    ),
  );

  it("queues a copy's writes on its git lane, its check apart, its deliveries in order, a host's work on the host", () => {
    assert.deepStrictEqual(
      [
        crewEffects.checkpoint({ handle: "backend", assignment: "a-1", turn: 1, explained: [] }),
        crewEffects.mergeIn({ handle: "backend" }),
        crewEffects.check({ handle: "backend", host: "appdev", kind: "check", command: "true" }),
        crewEffects.land("appdev", { handle: "backend", assignment: "a-1", title: "Score" }),
        crewEffects.sweep({ host: "appdev", checked: [] }),
      ].map((effect) => [effect.kind, effect.lane, effect.class]),
      [
        ["crew.checkpoint", "git/backend", "replay-safe"],
        ["crew.mergeIn", "git/backend", "replay-safe"],
        ["crew.check", "check/backend", "replay-safe"],
        ["crew.land", "host/appdev", "replay-safe"],
        ["crew.sweep", "host/appdev", "replay-safe"],
      ],
    );
  });
});
