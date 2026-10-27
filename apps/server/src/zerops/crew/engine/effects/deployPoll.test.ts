import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { CrewPlatformProcesses } from "../../crewDeployState.ts";
import { attempt, effectRow, okValue } from "../../testing/crewEffectFixture.ts";
import { makeDeployPoll, type DeployPollPayload } from "./deployPoll.ts";
import { CREW_EFFECT_KINDS } from "./shared.ts";

const PAYLOAD: DeployPollPayload = { host: "appdev", serviceId: "service-appdev" };

const row = (attemptNumber = 1) =>
  effectRow(CREW_EFFECT_KINDS.deployPoll, PAYLOAD, {
    effectId: "crew/main/e/crew.deployPoll/1",
    attempt: attemptNumber,
  });

/** The platform's process list, one answer per read; `reads` counts them. */
const platform = (answers: ReadonlyArray<ReadonlyArray<unknown> | undefined>) => {
  const state = { reads: 0 };
  const read = Effect.sync(() => answers[Math.min(state.reads++, answers.length - 1)]);
  return { state, provide: Effect.provideService(CrewPlatformProcesses, { read }) };
};

const deploy = (status: string) => ({
  serviceStackId: "service-appdev",
  actionName: "stack.deploy",
  status,
});

describe("crew.deployPoll", () => {
  it.effect("a deploy still running on the host is running; one that ended is settled", () => {
    const { provide } = platform([[deploy("RUNNING")], [deploy("FINISHED")]]);
    return Effect.gen(function* () {
      const handler = yield* makeDeployPoll;
      const running = okValue(yield* attempt(handler, row()));
      const settled = okValue(yield* attempt(handler, row()));
      assert.deepStrictEqual(
        { running, settled },
        { running: { state: "running" }, settled: { state: "settled" } },
      );
    }).pipe(provide);
  });

  it.effect("a poll the restart cut asks the platform again", () => {
    const { state, provide } = platform([[deploy("RUNNING")], [deploy("FINISHED")]]);
    return Effect.gen(function* () {
      const handler = yield* makeDeployPoll;
      yield* attempt(handler, row(1));
      const again = okValue(yield* attempt(handler, row(2)));
      assert.deepStrictEqual(
        { again, reads: state.reads },
        { again: { state: "settled" }, reads: 2 },
      );
    }).pipe(provide);
  });

  it.effect("a platform that cannot say is answered unknown, never settled", () => {
    const { provide } = platform([undefined, [{ serviceStackId: "service-appdev" }]]);
    return Effect.gen(function* () {
      const handler = yield* makeDeployPoll;
      const unread = okValue(yield* attempt(handler, row()));
      const unstated = okValue(yield* attempt(handler, row()));
      assert.deepStrictEqual(
        { unread, unstated },
        { unread: { state: "unknown" }, unstated: { state: "unknown" } },
      );
    }).pipe(provide);
  });
});
