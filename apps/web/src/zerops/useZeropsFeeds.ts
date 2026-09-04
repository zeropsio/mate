/**
 * Component-facing reads of the Zerops feeds.
 *
 * Every read here returns `undefined` until the first snapshot arrives, and
 * stays `undefined` forever in a non-Zerops environment. Callers render
 * nothing in that case — there is no loading or error state worth showing
 * for a panel that does not apply here.
 *
 * `useZeropsTopology` is a PURE atom read, deliberately: it must never import
 * `useProjectTopology`, the watcher, candidate loading, or `api.ts` — the
 * design-system rule a protected root's whole module graph must satisfy
 * (`scripts/mate-zone-architecture.test.ts` "protected roots render only",
 * and every file in this one is reachable from `ZeropsServiceMap.tsx`,
 * `ZeropsLifecycleStrip.tsx`, `ZeropsOperationCard.tsx`,
 * `ZeropsQuickActions.tsx`). `useProjectTopology` is the WRITER for the atom
 * this reads (`../state/zerops.ts`'s `projectTopologyViewAtom`); it runs only
 * in non-protected hosts (`ChatView.tsx`, `ZeropsPanel.tsx`), which is also
 * where a caller that needs liveness or the last-read error reads it
 * directly instead of through this thin view-only read.
 */
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ThreadId,
  ZeropsAgentAuthSnapshot,
  ZeropsLifecycle,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import {
  INITIAL_BROWSER_STREAM_STATE,
  type ZeropsBrowserStreamState,
} from "@t3tools/client-runtime/zerops/browserStream";
import type { ZeropsTopologyView } from "@t3tools/client-runtime/zerops/topology";
import { projectTopologyViewAtom, zeropsFeeds } from "../state/zerops";

/**
 * Selected when there is no environment or thread to read. Hooks cannot be
 * called conditionally, and pointing the real family at a placeholder id would
 * open a subscription against an environment that does not exist.
 */
const EMPTY_ATOM = Atom.make(undefined).pipe(Atom.withLabel("zerops:feed-empty"));

export function useZeropsTopology(
  environmentId: EnvironmentId | null,
): ZeropsTopologyView | undefined {
  return useAtomValue(environmentId === null ? EMPTY_ATOM : projectTopologyViewAtom(environmentId))
    ?.view;
}

export function useZeropsLifecycle(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): ZeropsLifecycle | undefined {
  return useAtomValue(
    environmentId === null || threadId === null
      ? EMPTY_ATOM
      : zeropsFeeds.lifecycleValue({ environmentId, input: { threadId } }),
  );
}

export function useZeropsAgentAuth(
  environmentId: EnvironmentId | null,
): ZeropsAgentAuthSnapshot | undefined {
  return useAtomValue(
    environmentId === null ? EMPTY_ATOM : zeropsFeeds.agentAuthValue({ environmentId, input: {} }),
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
  const result = useAtomValue(
    environmentId === null ? EMPTY_ATOM : zeropsFeeds.browserStream({ environmentId, input: {} }),
  );
  if (environmentId === null || result === undefined) {
    return undefined;
  }
  if (AsyncResult.isFailure(result)) {
    return "unavailable";
  }
  return AsyncResult.getOrElse(result, () => INITIAL_BROWSER_STREAM_STATE);
}
