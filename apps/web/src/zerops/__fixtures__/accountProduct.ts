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
import type { Instant } from "@t3tools/client-runtime/zerops/data";
import type { Link } from "@t3tools/client-runtime/zerops/environments";
import {
  selectLocationChoice,
  type ZeropsResourceAdapter,
} from "@t3tools/client-runtime/zerops/data";
import { candidatesNotice, heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { FakeDatastream } from "@t3tools/client-runtime/zerops/testing";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { createElement, useEffect, useMemo, useState, type ReactNode } from "react";

import { SidebarZeropsTree } from "../../components/zerops/SidebarZeropsTree";
import { useConversationView } from "../../routes/-environmentTargets";
import { RouteGateView } from "../../routes/-routeGate";
import { ZeropsDataProvider } from "../ZeropsDataProvider";
import { conversationAccess, useZeropsInventory, withheldProjectNotice } from "../inventoryContext";
import { useNowMs } from "../useNowMs";
import { useZeropsCandidates } from "../useZeropsCandidates";
import { ZeropsInventoryProvider } from "../ZeropsInventoryProvider";
import { useKnown, useZeropsData } from "../zeropsDataContext";
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

/** What the organization's locations demand shows, as `locations: <state>[ <names>]`. */
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
  const shown = useKnown(runtime.resources.known(request));
  const names = selectLocationChoice(shown).locations.map(({ name }) => name);
  return [`locations: ${shown.state}`, ...names].join(" ");
}

/** How the menu's Mate tree names the listing it is drawn from, as the sidebar names it. */
const SIDEBAR_SURFACE = {
  subject: "your projects",
  entity: "project",
  source: "zerops",
  checking: "Reading your projects…",
  negative: null,
} as const;

/** The menu's Mate tree over the account's listing, wired the way the sidebar wires it. */
export function SidebarListing() {
  const { listing } = useZeropsCandidates();
  const nowMs = useNowMs();
  const held = heldCandidates(listing);
  return createElement(SidebarZeropsTree, {
    candidates: held.rows,
    complete: held.complete,
    notice: candidatesNotice(listing, SIDEBAR_SURFACE, nowMs),
    onSelect: () => undefined,
    onBrowseProjects: () => undefined,
  });
}

/** What the listing every sidebar and page region reads holds, as `listing: <state>`. */
export function ListingState() {
  return `listing: ${useZeropsCandidates().listing.state}`;
}

/**
 * A Mate conversation of project `projectId` as the route renders it: its messages and its
 * composer's draft under the route gate, over a link the test sets and the project's access as
 * the inventory publishes it (DESIGN §9 C1b).
 */
export function Conversation({
  projectId,
  link,
  linkLostAt,
}: {
  readonly projectId: string;
  readonly link: Link;
  readonly linkLostAt: Instant | null;
}) {
  const conversation = useConversationView(conversationAccess(useZeropsInventory(), projectId), {
    link,
    linkLostAt,
  });
  return createElement(RouteGateView, {
    gate: { kind: "outlet", banner: null, composer: "enabled" },
    phrase: { text: null, actions: [] },
    projectId,
    conversation,
    children: "conversation: hello · draft: my words",
  });
}
