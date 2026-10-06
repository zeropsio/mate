/**
 * The account's data runtime over the harness datastream instead of a
 * platform socket, in the shape `ZeropsDataProvider` builds it with.
 *
 * Lives outside `*.test.*` on purpose: it runs `Effect.runPromise`, which
 * `no-manual-effect-runtime-in-tests` forbids in test files. A harness tab
 * imports it after its module graph is reset, so the runtime is the tab's own.
 */
import {
  makeZeropsDataAdapter,
  makeZeropsDataRuntime,
  type ZeropsDataAdapter,
} from "@t3tools/client-runtime/zerops/data";
import type { FakeDatastream } from "@t3tools/client-runtime/zerops/testing";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Scheduler from "effect/Scheduler";

import { signalsVisibility } from "../browserSignals";
import type { MakeZeropsDataRuntime } from "../ZeropsDataProvider";
import { tabClock } from "../tabClock";

/**
 * `overRest` reads the runtime's cells and runs its commands through the harness's REST platform,
 * as the browser's REST adapter does, so a test counts what reached the platform.
 */
export function harnessRuntime(
  datastream: FakeDatastream,
  options: { readonly overRest?: boolean } = {},
): MakeZeropsDataRuntime {
  let opaque = 0;
  return ({ scope, client, registry, scheduler, signals, signal }) => {
    const reads = makeZeropsDataAdapter({
      client,
      makeSocket: () => {
        throw new Error("Harness reads do not open sockets.");
      },
      timers: {
        setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
    });
    const rest: Partial<ZeropsDataAdapter> = {
      read: (ticket, context) =>
        ticket.target.kind === "project" ||
        (ticket.target.kind === "query" &&
          ticket.target.descriptor.kind === "projects-of-organization")
          ? reads.read(ticket, context)
          : datastream.adapter.read(ticket, context),
    };
    if (options.overRest === true) {
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: () => {
          throw new Error("The harness's push half is its datastream.");
        },
        timers: {
          setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
          clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
      });
      Object.assign(rest, {
        cells: adapter.cells,
        execute: adapter.execute,
        onTokensWritten: adapter.onTokensWritten,
      });
    }
    return Effect.runPromise(
      makeZeropsDataRuntime({
        scope,
        adapter: {
          ...datastream.adapter,
          ...rest,
        },
        atomRegistry: registry,
        makeOpaqueId: () => `opaque-${++opaque}`,
        // The tab's visibility, as the browser runtime hears it: a hidden tab pauses its push half.
        visibility: signalsVisibility(signals),
      }).pipe(
        Effect.provideService(Scheduler.Scheduler, scheduler),
        Effect.provideService(Clock.Clock, tabClock),
      ),
      { signal },
    );
  };
}
