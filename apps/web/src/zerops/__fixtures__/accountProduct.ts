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
import {
  accountReadsAtom,
  makeAccountStore,
  makeZeropsWire,
  observeAccount,
  repairZeropsSession,
} from "@t3tools/client-runtime/data";
import type { PlatformWatchSocket } from "@t3tools/client-runtime/zerops/data";
import type { Instant } from "@t3tools/client-runtime/zerops/data";
import type { Link } from "@t3tools/client-runtime/zerops/environments";
import { selectLocationChoice, type ZeropsCellAdapter } from "@t3tools/client-runtime/zerops/data";
import { candidatesNotice, heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { FakeDatastream } from "@t3tools/client-runtime/zerops/testing";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { Fragment, createElement, useEffect, useMemo, useState, type ReactNode } from "react";

import { AccountVoiceLine } from "../../components/zerops/AccountVoiceLine";
import { SidebarZeropsTree } from "../../components/zerops/SidebarZeropsTree";
import { useConversationView } from "../../routes/-environmentTargets";
import { RouteGateView } from "../../routes/-routeGate";
import { ZeropsDataProvider } from "../ZeropsDataProvider";
import { conversationAccess, useZeropsInventory, withheldProjectNotice } from "../inventoryContext";
import { useZeropsSession } from "../ZeropsSessionProvider";
import { useNowMs } from "../useNowMs";
import { useZeropsCandidates } from "../useZeropsCandidates";
import { ZeropsInventoryProvider } from "../ZeropsInventoryProvider";
import { useKnown, useZeropsData, useZeropsDataInterest } from "../zeropsDataContext";
import { harnessRuntime } from "./harnessRuntime";

export function AccountProduct({
  datastream,
  cellAdapter,
  overRest,
  demandedProjects = [],
  children,
}: {
  readonly datastream: FakeDatastream;
  /** Where the runtime's cells read; every cell is unavailable without one. */
  readonly cellAdapter?: ZeropsCellAdapter;
  /** Cells, commands and token writes through the harness's REST platform (`harnessRuntime`). */
  readonly overRest?: boolean;
  readonly children: ReactNode;
  readonly demandedProjects?: ReadonlyArray<string>;
}) {
  const [registry] = useState(() => AtomRegistry.make());
  const [makeRuntime] = useState(() =>
    harnessRuntime(datastream, cellAdapter, overRest === undefined ? {} : { overRest }),
  );
  return createElement(RegistryContext, {
    value: registry,
    children: createElement(
      HarnessAccountData,
      { registry },
      createElement(ZeropsDataProvider, {
        makeRuntime,
        // The product and the account's one line at the menu's foot, as the sidebar places it.
        children: createElement(ZeropsInventoryProvider, {
          children: createElement(
            Fragment,
            null,
            demandedProjects.map((projectId) =>
              createElement(ProjectNotice, { key: projectId, projectId }),
            ),
            children,
            createElement(AccountVoiceLine),
          ),
        }),
      }),
    ),
  });
}

/** A receiver that greets, answers every ping and says nothing else: the harness pushes nothing. */
function quietSocket(): PlatformWatchSocket {
  const socket: PlatformWatchSocket = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: (data) => {
      if (data.includes('"ping"'))
        setTimeout(() => socket.onmessage?.({ data: '{"type":"pong"}' }));
    },
    close: () => undefined,
  };
  setTimeout(() => socket.onmessage?.({ data: '{"type":"SocketSuccess"}' }));
  return socket;
}

/**
 * The account's store as `ZeropsAccountData` mounts it, over the harness platform's REST and a
 * quiet receiver: the active organization's roster read once, live after.
 */
function HarnessAccountData({
  registry,
  children,
}: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly children?: ReactNode;
}) {
  const { client, status, activeOrganization } = useZeropsSession();
  const store = useMemo(() => makeAccountStore(registry), [registry]);
  const observation = useMemo(
    () =>
      observeAccount({
        store,
        wire: makeZeropsWire({ client, makeSocket: quietSocket }),
        repairSession: repairZeropsSession(client),
      }),
    [client, store],
  );
  const orgId = status === "signed-in" ? (activeOrganization?.id ?? null) : null;
  useEffect(() => {
    observation.show(orgId);
  }, [observation, orgId]);
  useEffect(() => () => observation.close(), [observation]);
  useEffect(() => {
    registry.set(accountReadsAtom, {
      data: store.data,
      orgId,
      demandDetail: observation.demandDetail,
    });
  }, [observation, orgId, registry, store]);
  return children;
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

/** Demand represents an opened project or an explicit action in a product fixture. */
function useProjectDemand(projectId: string) {
  const { projectRef } = useZeropsData();
  const session = useZeropsSession();
  const orgId = session.activeOrganization?.id;
  const descriptor = useMemo(
    () =>
      orgId === undefined
        ? null
        : { kind: "project-inventory" as const, project: projectRef(orgId, projectId) },
    [orgId, projectId, projectRef],
  );
  useZeropsDataInterest(descriptor);
}

export function ProjectNotice({ projectId }: { readonly projectId: string }) {
  useProjectDemand(projectId);
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
      kind: "locations" as const,
      account: runtime.scope,
      organization: organizationRef(organizationId),
    }),
    [organizationId, organizationRef, runtime.scope],
  );
  const shown = useKnown(runtime.cells.known(request));
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
  useProjectDemand(projectId);
  const inventory = useZeropsInventory();
  const conversation = useConversationView(conversationAccess(inventory, projectId), {
    link,
    linkLostAt,
  });
  return createElement(RouteGateView, {
    gate: { kind: "outlet", banner: null, composer: "enabled" },
    phrase: { text: null, actions: [] },
    projectId,
    conversation,
    voice: { surface: "none" },
    stage: null,
    children: "conversation: hello · draft: my words",
  });
}
