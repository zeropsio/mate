import type { EnvironmentId } from "@t3tools/contracts";
import * as Array from "effect/Array";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { SupervisorConnectionState } from "./model.ts";
import type { EnvironmentRegistry } from "./registry.ts";

/** One element each time the socket comes up: on connect and again after every reconnect. */
export const socketArrivals = <E, R>(
  states: Stream.Stream<SupervisorConnectionState, E, R>,
): Stream.Stream<void, E, R> =>
  states.pipe(
    Stream.map((state) => state.phase === "connected"),
    Stream.changes,
    Stream.filter((connected) => connected),
    Stream.as(undefined),
  );

const sameEnvironments = Array.makeEquivalence<EnvironmentId>((a, b) => a === b);

/**
 * Each registered environment, every time its socket comes up. State the server keeps per socket
 * (a client's activity lease) is sent here, since a closed socket took it along.
 */
export const connectedArrivals = (
  registry: Pick<EnvironmentRegistry["Service"], "entries" | "stateChanges">,
): Stream.Stream<EnvironmentId> =>
  SubscriptionRef.changes(registry.entries).pipe(
    Stream.map((entries) => [...entries.keys()]),
    Stream.changesWith(sameEnvironments),
    Stream.switchMap((environmentIds) =>
      Stream.mergeAll(
        environmentIds.map((environmentId) =>
          socketArrivals(registry.stateChanges(environmentId)).pipe(
            Stream.as(environmentId),
            Stream.catchTag("EnvironmentNotRegisteredError", () => Stream.empty),
          ),
        ),
        { concurrency: "unbounded" },
      ),
    ),
  );
