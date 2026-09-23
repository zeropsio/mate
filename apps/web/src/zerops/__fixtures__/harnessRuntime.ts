/**
 * The account's data runtime over the harness datastream instead of a
 * platform socket, in the shape `ZeropsDataProvider` builds it with.
 *
 * Lives outside `*.test.*` on purpose: it runs `Effect.runPromise`, which
 * `no-manual-effect-runtime-in-tests` forbids in test files. A harness tab
 * imports it after its module graph is reset, so the runtime is the tab's own.
 */
import { makeZeropsDataRuntime } from "@t3tools/client-runtime/zerops/data";
import type { FakeDatastream } from "@t3tools/client-runtime/zerops/testing";
import * as Effect from "effect/Effect";
import * as Scheduler from "effect/Scheduler";

import type { MakeZeropsDataRuntime } from "../ZeropsDataProvider";

export function harnessRuntime(datastream: FakeDatastream): MakeZeropsDataRuntime {
  let opaque = 0;
  return ({ scope, registry, scheduler, signal }) =>
    Effect.runPromise(
      makeZeropsDataRuntime({
        scope,
        adapter: datastream.adapter,
        atomRegistry: registry,
        makeOpaqueId: () => `opaque-${++opaque}`,
      }).pipe(Effect.provideService(Scheduler.Scheduler, scheduler)),
      { signal },
    );
}
