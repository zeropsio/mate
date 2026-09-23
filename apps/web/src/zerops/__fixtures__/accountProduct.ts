/**
 * The signed-in product below the session provider, as `AppRoot` composes it
 * (`ZeropsAccountDataBoundary`), with the account's data runtime built over the
 * harness datastream instead of a platform socket.
 *
 * Lives outside `*.test.*` on purpose: it runs `Effect.runSync` and
 * `Effect.runPromise`, which `no-manual-effect-runtime-in-tests` forbids in
 * test files. A harness tab imports it after its module graph is reset, so
 * every module it renders is the tab's own.
 */
import { RegistryContext } from "@effect/atom-react";
import { makeZeropsDataRuntime } from "@t3tools/client-runtime/zerops/data";
import type { FakeDatastream } from "@t3tools/client-runtime/zerops/testing";
import * as Effect from "effect/Effect";
import * as Scheduler from "effect/Scheduler";
import { AtomRegistry } from "effect/unstable/reactivity";
import { createElement, useEffect, useState, type ReactNode } from "react";

import { ZeropsDataProvider, type MakeZeropsDataRuntime } from "../ZeropsDataProvider";
import { ZeropsInventoryProvider } from "../ZeropsInventoryProvider";
import { useZeropsData } from "../zeropsDataContext";

function harnessRuntime(datastream: FakeDatastream): MakeZeropsDataRuntime {
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

export function AccountProduct({
  datastream,
  children,
}: {
  readonly datastream: FakeDatastream;
  readonly children: ReactNode;
}) {
  const [registry] = useState(() => AtomRegistry.make());
  const [makeRuntime] = useState(() => harnessRuntime(datastream));
  return createElement(RegistryContext, {
    value: registry,
    children: createElement(ZeropsDataProvider, {
      makeRuntime,
      children: createElement(ZeropsInventoryProvider, { children }),
    }),
  });
}

/**
 * A product child: it says it is there, and reports the access state the data
 * runtime holds when the child mounts on it.
 */
export function ProductChild({
  label,
  onMount,
}: {
  readonly label: string;
  readonly onMount: (access: string) => void;
}) {
  const { runtime } = useZeropsData();
  useEffect(() => {
    onMount(Effect.runSync(runtime.state).access.status);
  }, [onMount, runtime]);
  return label;
}
