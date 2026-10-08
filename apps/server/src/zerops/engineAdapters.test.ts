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
      { kind: "person", subject: "zerops-user:jan" },
      { kind: "person", itemId: "mate/r/1/i/1" },
      { kind: "session", subject: "zerops-user:jan" },
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
      { kind: "person", subject: "zerops-user:eva" },
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

  it.effect(
    "a run a restart cut is explained by the platform's record: who restarted the Mate, and when",
    () =>
      Effect.gen(function* () {
        const evidence = yield* RestartEvidence;
        const facts = {
          name: "Fen",
          projectId: "p1",
          serviceId: "s1",
          containerStartedAt: null,
          processes: [
            {
              status: "FINISHED",
              actionName: "stack.restart",
              serviceStackId: "s1",
              started: "2026-10-07T10:00:00.000Z",
              createdByUser: { fullName: "Ana Novak" },
            },
          ],
        };
        const window = {
          lastActivityAt: Date.parse("2026-10-07T09:59:00.000Z"),
          bootAt: Date.parse("2026-10-07T10:01:00.000Z"),
        };
        assert.deepStrictEqual(evidence.explain(facts, window), {
          cause: "restarted",
          at: "2026-10-07T10:00:00.000Z",
        });
        assert.deepStrictEqual(evidence.explain(null, window), {
          cause: "restarted",
          at: "2026-10-07T10:01:00.000Z",
        });
      }).pipe(Effect.provide(engineAdaptersOpen)),
  );
});
