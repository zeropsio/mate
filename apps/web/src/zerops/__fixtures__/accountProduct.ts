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
import type { ZeropsResourceAdapter } from "@t3tools/client-runtime/zerops/data";
import type { FakeDatastream } from "@t3tools/client-runtime/zerops/testing";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { createElement, useEffect, useMemo, useState, type ReactNode } from "react";

import { ZeropsDataProvider } from "../ZeropsDataProvider";
import { useZeropsInventory, withheldProjectNotice } from "../inventoryContext";
import { ZeropsInventoryProvider } from "../ZeropsInventoryProvider";
import { useZeropsData, useZeropsResource } from "../zeropsDataContext";
import { harnessRuntime } from "./harnessRuntime";

export function AccountProduct({
  datastream,
  resourceAdapter,
  children,
}: {
  readonly datastream: FakeDatastream;
  /** Where the runtime's resource broker reads; every resource is unavailable without one. */
  readonly resourceAdapter?: ZeropsResourceAdapter;
  readonly children: ReactNode;
}) {
  const [registry] = useState(() => AtomRegistry.make());
  const [makeRuntime] = useState(() => harnessRuntime(datastream, resourceAdapter));
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

/** The names of the projects the inventory holds: platform text. */
export function ProjectNames() {
  const names = useZeropsInventory()
    .projects.map(({ name }) => name)
    .join(", ");
  return `projects: ${names}`;
}

/** What the organization's locations lease holds, as `locations: <status>[ <names>]`. */
export function OrganizationLocations({ organizationId }: { readonly organizationId: string }) {
  const { runtime, organizationRef } = useZeropsData();
  const request = useMemo(
    () => ({
      kind: "organization-locations" as const,
      account: runtime.scope,
      organization: organizationRef(organizationId),
    }),
    [organizationId, organizationRef, runtime.scope],
  );
  const snapshot = useZeropsResource(request);
  return snapshot.status === "success"
    ? `locations: success ${snapshot.value.map(({ name }) => name).join(", ")}`
    : `locations: ${snapshot.status}`;
}
