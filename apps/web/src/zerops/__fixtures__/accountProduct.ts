/**
 * The signed-in product below the session provider, as `AppRoot` composes it
 * (`ZeropsAccountDataBoundary`), with the account's data runtime built over the
 * harness datastream instead of a platform socket.
 *
 * Lives outside `*.test.*` on purpose: it runs `Effect.runSync`, which
 * `no-manual-effect-runtime-in-tests` forbids in test files. A harness tab
 * imports it after its module graph is reset, so every module it renders is
 * the tab's own.
 */
import { RegistryContext } from "@effect/atom-react";
import type { FakeDatastream } from "@t3tools/client-runtime/zerops/testing";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { createElement, useEffect, useState, type ReactNode } from "react";

import { ZeropsDataProvider } from "../ZeropsDataProvider";
import { useZeropsInventory, withheldProjectNotice } from "../inventoryContext";
import { ZeropsInventoryProvider } from "../ZeropsInventoryProvider";
import { useZeropsData } from "../zeropsDataContext";
import { harnessRuntime } from "./harnessRuntime";

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

/** What a project's region says while the grant withholds its content, as `id: notice`. */
export function ProjectNotice({ projectId }: { readonly projectId: string }) {
  const notice = withheldProjectNotice(useZeropsInventory(), projectId);
  return notice === null ? null : `${projectId}: ${notice}`;
}
