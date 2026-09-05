import type {
  EnvironmentId,
  OrchestrationThreadActivity,
  TurnId,
  ZeropsLifecycle,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import {
  deriveZeropsThreadModel,
  type ZeropsThreadModel,
} from "@t3tools/client-runtime/zerops/model";

import { connectionAtomRuntime } from "../connection/runtime";
import { createZeropsFeedAtoms } from "../zerops/feeds";
import type { ProjectTopologySnapshot } from "../zerops/projectTopologyWatcher";

export const zeropsFeeds = createZeropsFeedAtoms(connectionAtomRuntime);

/**
 * `deriveZeropsThreadModel`, re-exported from thread state alongside the
 * other Zerops derivations this module owns. Not an Effect `Atom` in its
 * own right — the model has no subscription to hold: it is a pure
 * projection of activities (already local component state) and the
 * lifecycle feed (`useZeropsLifecycle`), so the caller memoizes it on
 * reference identity the same way it memoizes every other thread
 * derivation (`useMemo`), rather than this module owning a second copy of
 * that state behind an atom.
 */
export function zeropsThreadModelAtom(input: {
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly lifecycle: ZeropsLifecycle | undefined;
  readonly runningTurnId: TurnId | null;
}): ZeropsThreadModel {
  return deriveZeropsThreadModel(input);
}

/**
 * The read-only side of `useProjectTopology`'s watcher (S3 mate-zone-
 * architecture fix): protected roots (`ZeropsServiceMap.tsx`,
 * `ZeropsLifecycleStrip.tsx`, `ZeropsOperationCard.tsx`,
 * `ZeropsQuickActions.tsx`) must never reach `api.ts`'s mutating REST client,
 * so the watcher itself — which needs it — runs only in non-protected hosts
 * (`ChatView.tsx`, `ZeropsPanel.tsx`) via `useProjectTopology`, which WRITES
 * here. Protected code reads only this atom, through
 * `useZeropsFeeds.ts`'s `useZeropsTopology`, a pure read with no import of
 * the watcher, candidate loading, or `api.ts` at all. One atom per
 * environment regardless of how many hosts mount the writer hook, so two
 * hosts (e.g. `ChatView` and `ZeropsPanel` open at once) publish to and read
 * from the very same value.
 */
const EMPTY_PROJECT_TOPOLOGY_SNAPSHOT: ProjectTopologySnapshot = {
  view: undefined,
  liveness: undefined,
  lastReadAt: undefined,
  error: undefined,
};

const projectTopologyViewFamily = Atom.family((environmentId: string) =>
  Atom.make<ProjectTopologySnapshot>(EMPTY_PROJECT_TOPOLOGY_SNAPSHOT).pipe(
    Atom.withLabel(`zerops:project-topology-view:${environmentId}`),
  ),
);

export function projectTopologyViewAtom(environmentId: EnvironmentId) {
  return projectTopologyViewFamily(String(environmentId));
}
