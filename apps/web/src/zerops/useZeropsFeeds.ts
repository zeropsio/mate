/**
 * Component-facing reads of the Zerops feeds.
 *
 * `useZeropsLifecycle`/`useZeropsAgentAuth` return `undefined` until the
 * first snapshot arrives, and stay `undefined` forever in a non-Zerops
 * environment. Callers render nothing in that case — there is no loading or
 * error state worth showing for a panel that does not apply here, and a live
 * snapshot says so for itself with `available: false`.
 *
 * `useZeropsTopology` is different: topology is no longer a mate-server feed
 * (S3) — it is a thin read of `useProjectTopology`'s own view, a client-side
 * projection of the Zerops API. A caller that also needs liveness or the
 * last-read error (the service map panel) reads `useProjectTopology`
 * directly instead.
 */
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ThreadId,
  ZeropsAgentAuthSnapshot,
  ZeropsLifecycle,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { ZeropsTopologyView } from "@t3tools/client-runtime/zerops/topology";
import { zeropsFeeds } from "../state/zerops";
import { useProjectTopology } from "./useProjectTopology";

/**
 * Selected when there is no environment or thread to read. Hooks cannot be
 * called conditionally, and pointing the real family at a placeholder id would
 * open a subscription against an environment that does not exist.
 */
const EMPTY_ATOM = Atom.make(undefined).pipe(Atom.withLabel("zerops:feed-empty"));

export function useZeropsTopology(
  environmentId: EnvironmentId | null,
): ZeropsTopologyView | undefined {
  return useProjectTopology(environmentId).view;
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
