import {
  type EnvironmentId as EnvironmentIdType,
  type ThreadId as ThreadIdType,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom } from "effect/unstable/reactivity";

import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentCacheStore } from "../platform/persistence.ts";
import { ThreadSnapshotLoader } from "./threadSnapshotHttp.ts";
import { parseThreadKey, threadKey } from "./entities.ts";
import { THREAD_SNAPSHOT_IDLE_TTL_MS } from "./threadRetention.ts";
import { followStreamInEnvironment } from "./runtime.ts";
import { EMPTY_ENVIRONMENT_THREAD_STATE, type EnvironmentThreadState } from "./threadState.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { engineRouteOf } from "../data/engineHost.ts";
import * as Option from "effect/Option";

/** What a V1-only reader shows for a Mate whose conversation runs on the engine. */
export const NATIVE_ENGINE_THREAD_STATE: EnvironmentThreadState = {
  ...EMPTY_ENVIRONMENT_THREAD_STATE,
  error: Option.some(
    "This Mate's conversation runs on its engine, which this app does not read yet. Update the app to keep talking to it.",
  ),
};

import {
  openThreadReplay,
  cachedThreadState,
  type ThreadResumeCache,
} from "../data/adapters/mateThreadReplay.ts";
export const makeEnvironmentThreadState = openThreadReplay;
export {
  requestOlderThreadTurns,
  INITIAL_THREAD_USER_TURN_LIMIT,
  isThreadSessionRunning,
} from "../data/adapters/mateThreadReplay.ts";

function threadStateChanges(
  environmentId: EnvironmentIdType,
  threadId: ThreadIdType,
  resumeCache?: ThreadResumeCache,
) {
  return followStreamInEnvironment(
    environmentId,
    Stream.unwrap(
      Effect.map(EnvironmentSupervisor, (supervisor) =>
        SubscriptionRef.changes(supervisor.prepared).pipe(
          Stream.filter(Option.isSome),
          Stream.map((prepared) => engineRouteOf(prepared.value).kind === "v1"),
          Stream.changes,
          // This reader speaks V1 only: a Mate whose conversation runs on the engine is read by an
          // updated app, never through its parked V1 history.
          Stream.switchMap((v1) =>
            v1
              ? Stream.unwrap(
                  makeEnvironmentThreadState(threadId, resumeCache).pipe(
                    Effect.map(SubscriptionRef.changes),
                  ),
                )
              : Stream.succeed(NATIVE_ENGINE_THREAD_STATE),
          ),
        ),
      ),
    ),
  );
}

export function createEnvironmentThreadStateAtoms<R, E>(
  runtime: Atom.AtomRuntime<
    EnvironmentRegistry | EnvironmentCacheStore | ThreadSnapshotLoader | R,
    E
  >,
) {
  // Cache definitions must outlive collectible live-atom definitions. The
  // registry retains these nodes without retaining environment or RPC scopes.
  const resumeFamily = Atom.family((key: string) =>
    Atom.make((): ThreadResumeCache => ({
      snapshot: undefined,
      owner: undefined,
    })).pipe(
      Atom.setIdleTTL(THREAD_SNAPSHOT_IDLE_TTL_MS),
      Atom.withLabel(`environment-thread-resume:${key}`),
    ),
  );
  const family = Atom.family((key: string) => {
    const { environmentId, threadId } = parseThreadKey(key);
    const resumeAtom = resumeFamily(key);
    return runtime
      .atom(
        (get) => {
          get.mount(resumeAtom);
          const resume = get.once(resumeAtom);
          const live = threadStateChanges(environmentId, threadId, resume);
          return resume.snapshot === undefined
            ? live
            : Stream.concat(Stream.succeed(cachedThreadState(resume.snapshot.state)), live);
        },
        {
          initialValue: EMPTY_ENVIRONMENT_THREAD_STATE,
        },
      )
      .pipe(Atom.setIdleTTL(0), Atom.withLabel(`environment-thread-state:${key}`));
  });

  return {
    stateAtom: (environmentId: EnvironmentIdType, threadId: ThreadIdType) =>
      family(threadKey({ environmentId, threadId })),
  };
}

export * from "./archivedThreads.ts";
export * from "./checkpointDiff.ts";
export * from "./threadSnapshotHttp.ts";
export * from "./composerPathSearch.ts";
export * from "./threadCommands.ts";
export * from "./threadFeedback.ts";
export * from "./threadDetail.ts";
export * from "./threadReducer.ts";
export * from "./threadShell.ts";
export * from "./threadState.ts";

export * from "./checkpointHistory.ts";
