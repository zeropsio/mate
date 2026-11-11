import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { connectedArrivals, socketArrivals } from "./arrivals.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  type SupervisorConnectionPhase,
  type SupervisorConnectionState,
} from "./model.ts";

const at = (
  phase: SupervisorConnectionPhase,
  stage: SupervisorConnectionState["stage"] = null,
): SupervisorConnectionState => ({ ...AVAILABLE_CONNECTION_STATE, desired: true, phase, stage });

describe("connectedArrivals", () => {
  it.effect(
    "a socket arrives once per connect: again after a reconnect, never while it stays up",
    () =>
      Effect.gen(function* () {
        const states = Stream.fromIterable([
          at("available"),
          at("connecting", "opening"),
          at("connected"),
          at("connected", "synchronizing"),
          at("connected"),
          at("backoff"),
          at("connecting", "opening"),
          at("connected"),
        ]);
        const arrivals = yield* Stream.runCollect(socketArrivals(states));
        expect(Array.from(arrivals)).toHaveLength(2);
      }),
  );

  it.effect("names each registered Mate every time its socket comes up", () =>
    Effect.gen(function* () {
      const flaky = EnvironmentId.make("env-flaky");
      const steady = EnvironmentId.make("env-steady");
      const entries = yield* SubscriptionRef.make(new Map([flaky, steady].map((id) => [id, {}])));
      const scripts = new Map([
        [flaky, [at("connected"), at("backoff"), at("connected")]],
        [steady, [at("connecting", "opening"), at("connected")]],
      ]);
      const arrivals = connectedArrivals({
        entries: entries as never,
        stateChanges: (environmentId) => Stream.fromIterable(scripts.get(environmentId) ?? []),
      });
      const heard = Array.from(yield* Stream.runCollect(Stream.take(arrivals, 3)));
      expect(heard.toSorted()).toEqual([flaky, flaky, steady]);
    }),
  );
});
