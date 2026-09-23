/**
 * The account's data runtime over the harness datastream instead of a
 * platform socket, in the shape `ZeropsDataProvider` builds it with.
 *
 * Lives outside `*.test.*` on purpose: it runs `Effect.runPromise`, which
 * `no-manual-effect-runtime-in-tests` forbids in test files. A harness tab
 * imports it after its module graph is reset, so the runtime is the tab's own.
 */
import {
  makeZeropsDataRuntime,
  type ZeropsResourceAdapter,
} from "@t3tools/client-runtime/zerops/data";
import type { FakeDatastream } from "@t3tools/client-runtime/zerops/testing";
import * as Effect from "effect/Effect";
import * as Scheduler from "effect/Scheduler";
import * as Stream from "effect/Stream";

import type { MakeZeropsDataRuntime } from "../ZeropsDataProvider";

export function harnessRuntime(
  datastream: FakeDatastream,
  resourceAdapter?: ZeropsResourceAdapter,
): MakeZeropsDataRuntime {
  let opaque = 0;
  return ({ scope, registry, scheduler, signal }) =>
    Effect.runPromise(
      makeZeropsDataRuntime({
        scope,
        adapter: datastream.adapter,
        ...(resourceAdapter === undefined ? {} : { resourceAdapter }),
        atomRegistry: registry,
        makeOpaqueId: () => `opaque-${++opaque}`,
        // The tab's visibility, as the browser runtime reads it: a hidden tab pauses its push half.
        visibility: {
          current: Effect.sync(() =>
            document.visibilityState === "hidden" ? "hidden" : "visible",
          ),
          changes: Stream.fromEventListener(document, "visibilitychange").pipe(
            Stream.map(() => (document.visibilityState === "hidden" ? "hidden" : "visible")),
          ),
        },
      }).pipe(Effect.provideService(Scheduler.Scheduler, scheduler)),
      { signal },
    );
}
