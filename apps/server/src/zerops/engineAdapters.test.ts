import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { RestartEvidence, RunAdmission, type RunPrincipal } from "../engine/ports.ts";
import { engineAdaptersOpen, turnPrincipalOf } from "./engineAdapters.ts";
import type { TurnPrincipal } from "./ZeropsTurnAdmission.ts";

describe("engineAdapters", () => {
  it.each([
    [
      "a person's run is their session's turn",
      { kind: "person", subject: "zerops:jan" },
      { kind: "session", subject: "zerops:jan" },
    ],
    [
      "a crew wake is a crew turn for its starter",
      { kind: "wake", owner: "crew", startedBy: "jan" },
      { kind: "crew", startedBy: "jan" },
    ],
    [
      "a stand-up wake is the stand-up's turn",
      { kind: "wake", owner: "standup", startedBy: "jan" },
      { kind: "standup", startedBy: "jan" },
    ],
    [
      "any other wake is admitted like a stand-up, for the person it continues",
      { kind: "wake", owner: "usage-resume", startedBy: "eva" },
      { kind: "standup", startedBy: "eva" },
    ],
  ] as const satisfies ReadonlyArray<readonly [string, RunPrincipal, TurnPrincipal]>)(
    "%s",
    (_, principal, expected) => {
      assert.deepStrictEqual(turnPrincipalOf(principal), expected);
    },
  );

  it.effect("outside Zerops every run is admitted and there is no restart to read", () =>
    Effect.gen(function* () {
      yield* (yield* RunAdmission).admit({
        instanceId: "claudeAgent",
        principal: { kind: "person", subject: "local" },
      });
      assert.strictEqual(yield* (yield* RestartEvidence).read, null);
    }).pipe(Effect.provide(engineAdaptersOpen)),
  );
});
