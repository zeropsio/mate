/**
 * Component-facing reads of the Zerops feeds.
 *
 * The lifecycle and agent-auth reads are `Known` (DESIGN §2.C C12–C13): a
 * caller tells "not read yet", "read, now stale" and "this Mate cannot say"
 * apart instead of seeing one `undefined` for all three. `undefined` means
 * only that there is no environment (or thread) to read.
 *
 * `useZeropsTopology` is a PURE atom read, deliberately: it must never import
 * `useProjectTopology`, platform data transport, candidate loading, or `api.ts` — the
 * design-system rule a protected root's whole module graph must satisfy
 * (`scripts/mate-zone-architecture.test.ts` "protected roots render only",
 * and every file in this one is reachable from `ZeropsServiceMap.tsx`,
 * `ZeropsLifecycleStrip.tsx`, `ZeropsOperationCard.tsx`,
 * `ZeropsQuickActions.tsx`). It reads the project's topology atom, derived from the
 * account's runtime (`../state/zerops.ts`'s `projectTopologyAtom`), through the environment's
 * project (`useEnvironmentProjectRef`); `useProjectTopology` is where a non-protected host
 * (`ZeropsPanel.tsx`) demands it, and where a caller that needs liveness or
 * the last-read error reads it instead of through this thin view-only read.
 */
import { useDatabaseSession } from "./useDatabaseSession";
import { useMateBrowserStream } from "./browserStreamLinks.tsx";

import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ThreadId,
  ZeropsAgentAuthSnapshot,
  ZeropsLifecycle,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { type ZeropsBrowserStreamState } from "@t3tools/client-runtime/zerops/browserStream";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import type { ProjectRef } from "@t3tools/client-runtime/zerops/data";
import type { ZeropsTopologyView } from "@t3tools/client-runtime/zerops/topology";
import { useMemo } from "react";

import {
  environmentProjectRef,
  environmentProjectsAtom,
  projectTopologyAtom,
  projectTopologyViewAtom,
  zeropsFeeds,
  inventoryReadAtom,
} from "../state/zerops";
import {
  EMPTY_PROJECT_TOPOLOGY_SNAPSHOT,
  type ProjectTopologySnapshot,
} from "@t3tools/client-runtime/data";
import { useMateOfEnvironment } from "./accountEnvironments";

/**
 * Selected when there is no environment or thread to read. Hooks cannot be
 * called conditionally, and pointing the real family at a placeholder id would
 * open a subscription against an environment that does not exist.
 */
const EMPTY_ATOM = Atom.make(undefined).pipe(Atom.withLabel("zerops:feed-empty"));

const NO_TOPOLOGY_ATOM = Atom.make(EMPTY_PROJECT_TOPOLOGY_SNAPSHOT).pipe(
  Atom.withLabel("zerops:topology-empty"),
);

/**
 * The project an environment belongs to (DESIGN §2.C C3): its descriptor, the Mate this tab read
 * serving it, or a listing row, resolved against the account's inventory. Null while none places
 * it.
 */
export function useEnvironmentProjectRef(environmentId: EnvironmentId | null): ProjectRef | null {
  const mate = useMateOfEnvironment(environmentId);
  const located = useAtomValue(environmentProjectsAtom);
  const inventory = useAtomValue(inventoryReadAtom);
  return useMemo(
    () =>
      environmentId === null || inventory === null
        ? null
        : environmentProjectRef({ environmentId, mate, located, inventory }),
    [environmentId, inventory, located, mate],
  );
}

/** The topology of the project an environment belongs to, derived; empty while it is not placed. */
export function useEnvironmentTopology(
  environmentId: EnvironmentId | null,
): ProjectTopologySnapshot {
  const project = useEnvironmentProjectRef(environmentId);
  return useAtomValue(project === null ? NO_TOPOLOGY_ATOM : projectTopologyAtom(project));
}

export function useZeropsTopology(
  environmentId: EnvironmentId | null,
): ZeropsTopologyView | undefined {
  const project = useEnvironmentProjectRef(environmentId);
  return useAtomValue(project === null ? EMPTY_ATOM : projectTopologyViewAtom(project));
}

export function useZeropsLifecycle(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): Known<ZeropsLifecycle> | undefined {
  return useAtomValue(
    environmentId === null || threadId === null
      ? EMPTY_ATOM
      : zeropsFeeds.lifecycle({ environmentId, input: { threadId } }),
  );
}

export function useZeropsAgentAuth(
  environmentId: EnvironmentId | null,
): Known<ZeropsAgentAuthSnapshot> | undefined {
  return useAtomValue(
    environmentId === null ? EMPTY_ATOM : zeropsFeeds.agentAuth({ environmentId, input: {} }),
  );
}

/**
 * `undefined` — no environment, nothing to show. `"unavailable"` — the
 * subscription itself failed (a server without `subscribeZeropsBrowserStream`,
 * 0.2.5 and older): the panel says so, never an error toast. Otherwise the
 * accumulated `{status, url, frame}` snapshot (`foldBrowserStreamEvent`).
 */
export type ZeropsBrowserStreamRead = ZeropsBrowserStreamState | "unavailable" | undefined;

export function useZeropsBrowserStream(
  environmentId: EnvironmentId | null,
): ZeropsBrowserStreamRead {
  return useMateBrowserStream(environmentId);
}

/** The console process's status through its account projection and shared detail demand. */
export const useZeropsDataConsole = useDatabaseSession;
