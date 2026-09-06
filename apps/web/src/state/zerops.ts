import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { createZeropsFeedAtoms } from "../zerops/feeds";
import type { ZeropsMateIdentity } from "../zerops/mateIdentities";
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
export { deriveZeropsThreadModel } from "@t3tools/client-runtime/zerops/model";

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

/**
 * The Zerops project's name per environment (`zeropsEnvironmentNames`),
 * published by `useZeropsCandidates` from whichever host mounts it and read
 * by anything that must call an environment by name — the draft headline's
 * picker, where six containers would otherwise all be "www".
 */
export const zeropsEnvironmentNamesAtom = Atom.make<ReadonlyMap<EnvironmentId, string>>(
  new Map(),
).pipe(Atom.withLabel("zerops:environment-names"));

/**
 * Who lives in each connected environment — the Mate's name, colour and
 * project (`mateIdentities.ts`) — for the chat header, an empty conversation
 * and a draft's headline. Published by `useZeropsCandidates` next to the names.
 */
export const zeropsMatesAtom = Atom.make<ReadonlyMap<EnvironmentId, ZeropsMateIdentity>>(
  new Map(),
).pipe(Atom.withLabel("zerops:mates"));
