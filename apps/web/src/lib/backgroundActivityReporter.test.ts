import { EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  makeInteractionTracker,
  observeBackgroundActivitySubscription,
  reportToConnected,
  retainedBackgroundScopes,
} from "./backgroundActivityReporter.ts";

describe("makeInteractionTracker", () => {
  it("reports an interaction once the last one reported is 15 s old, and nothing while idle", () => {
    const interaction = makeInteractionTracker(0);
    // The socket's arrival report: the person was here when the app started.
    expect(interaction.reportIdleMs(0)).toBe(0);

    expect(interaction.interact(1_000)).toBe(false);
    expect(interaction.interact(14_999)).toBe(false);
    expect(interaction.interact(15_000)).toBe(true);
    expect(interaction.reportIdleMs(15_250)).toBe(250);

    // A blur 35 s after the last interaction carries the idle time; it renews nothing.
    expect(interaction.interact(20_000)).toBe(false);
    expect(interaction.reportIdleMs(55_000)).toBe(35_000);
    expect(interaction.interact(55_100)).toBe(true);
  });
});

describe("background activity scopes", () => {
  it.effect("retains an observed subscription until its returned finalizer runs", () =>
    Effect.gen(function* () {
      const environmentId = EnvironmentId.make("environment-observation-test");
      const scope = { type: "vcs-status" as const, cwd: "/repo" };
      const releasePassive = yield* observeBackgroundActivitySubscription({
        environmentId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: scope.cwd, includeRemote: false },
      });
      expect(retainedBackgroundScopes(environmentId)).toEqual([]);
      const release = yield* observeBackgroundActivitySubscription({
        environmentId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: scope.cwd },
      });

      expect(retainedBackgroundScopes(environmentId)).toEqual([scope]);

      yield* releasePassive;
      expect(retainedBackgroundScopes(environmentId)).toEqual([scope]);

      yield* release;
      expect(retainedBackgroundScopes(environmentId)).toEqual([]);
    }),
  );

  it.effect("keeps delimiter-containing environment and scope values distinct", () =>
    Effect.gen(function* () {
      const firstEnvironmentId = EnvironmentId.make("a");
      const secondEnvironmentId = EnvironmentId.make("a:vcs-status:b");
      const releaseFirst = yield* observeBackgroundActivitySubscription({
        environmentId: firstEnvironmentId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: "b:vcs-status:c" },
      });
      const releaseSecond = yield* observeBackgroundActivitySubscription({
        environmentId: secondEnvironmentId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: "c" },
      });

      expect(retainedBackgroundScopes(firstEnvironmentId)).toEqual([
        { type: "vcs-status", cwd: "b:vcs-status:c" },
      ]);
      expect(retainedBackgroundScopes(secondEnvironmentId)).toEqual([
        { type: "vcs-status", cwd: "c" },
      ]);

      yield* Effect.all([releaseFirst, releaseSecond]);
    }),
  );
});

describe("reportToConnected", () => {
  // A9: a Mate is connected only while something holds it; a report to a parked one would wake it.
  it.effect("reports only to connected Mates", () =>
    Effect.gen(function* () {
      const up = EnvironmentId.make("env-up");
      const parked = EnvironmentId.make("env-parked");
      const blinking = EnvironmentId.make("env-blinking");
      const phases = new Map([
        [up, "connected"],
        [parked, "available"],
        [blinking, "connecting"],
      ]);
      const entries = yield* SubscriptionRef.make(
        new Map([up, parked, blinking].map((id) => [id, {}])),
      );
      const reported: Array<EnvironmentId> = [];
      yield* reportToConnected(
        {
          entries: entries as never,
          state: (environmentId) => Effect.succeed({ phase: phases.get(environmentId) } as never),
          run: (environmentId) =>
            Effect.sync(() => {
              reported.push(environmentId);
            }) as never,
        },
        (environmentId) => Effect.succeed(environmentId),
      );
      expect(reported).toEqual([up]);
    }),
  );
});
