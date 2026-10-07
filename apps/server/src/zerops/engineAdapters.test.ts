import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { Principal, RunTrigger } from "@t3tools/contracts";

import { RestartEvidence, RunAdmission } from "../engine/ports.ts";
import { engineAdaptersOpen, turnPrincipalOf } from "./engineAdapters.ts";
import type { TurnPrincipal } from "./ZeropsTurnAdmission.ts";

describe("engineAdapters", () => {
  const wake = (cause: string): RunTrigger => ({ kind: "wake", cause, wakeId: null });
  it.each([
    [
      "a person's run is their session's turn",
      { kind: "person", subject: "zerops:jan" },
      { kind: "person", itemId: "mate/r/1/i/1" },
      { kind: "session", subject: "zerops:jan" },
    ],
    [
      "a crew wake is a crew turn for its starter",
      { kind: "crew", startedBy: "jan" },
      wake("crew"),
      { kind: "crew", startedBy: "jan" },
    ],
    [
      "a stand-up wake is the stand-up's turn",
      { kind: "standup", startedBy: "jan" },
      wake("standup"),
      { kind: "standup", startedBy: "jan" },
    ],
    [
      "any other wake is admitted like a stand-up, for the person it continues",
      { kind: "person", subject: "zerops:eva" },
      wake("usage-resume"),
      { kind: "standup", startedBy: "eva" },
    ],
    ["the engine itself is never admitted", { kind: "engine" }, wake("watchdog"), null],
  ] as ReadonlyArray<readonly [string, Principal, RunTrigger, TurnPrincipal | null]>)(
    "%s",
    (_, principal, trigger, expected) => {
      assert.deepStrictEqual(turnPrincipalOf(principal, trigger), expected);
    },
  );

  it.effect("outside Zerops every run is admitted and there is no restart to read", () =>
    Effect.gen(function* () {
      yield* (yield* RunAdmission).admit({
        instanceId: "claudeAgent",
        principal: { kind: "person", subject: "local" },
        trigger: { kind: "wake", cause: "standup", wakeId: null },
      });
      assert.strictEqual(yield* (yield* RestartEvidence).read, null);
    }).pipe(Effect.provide(engineAdaptersOpen)),
  );
});
