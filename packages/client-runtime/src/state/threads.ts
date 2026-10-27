import {
  type EnvironmentId as EnvironmentIdType,
  type ThreadId as ThreadIdType,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry } from "effect/reactivity";

import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentCacheStore } from "../platform/persistence.ts";
import { parseThreadKey, threadKey } from "./entities.ts";
import { followStreamInEnvironment } from "./runtime.ts";
import { EMPTY_ENVIRONMENT_THREAD_STATE, type EnvironmentThreadState } from "./threadState.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { engineRouteOf, mateEngineHostAtom, type EngineRoute } from "../data/engineHost.ts";
import { engineThreadChanges } from "../data/engineThreadChanges.ts";
import { MATE_OLDER_WORDS, NATIVE_UPDATE_WORDS } from "../data/projections/mateEngine.ts";
import * as Option from "effect/Option";

export { requestOlderThreadTurns } from "../data/olderTurns.ts";

/** A Mate whose engine speaks only a newer protocol than this build: on the phone, an update. */
const NEWER_ENGINE_THREAD_STATE: EnvironmentThreadState = {
  ...EMPTY_ENVIRONMENT_THREAD_STATE,
  error: Option.some(NATIVE_UPDATE_WORDS),
};

/** An engine conversation whose account is not mounted yet: opening, nothing to draw. */
const OPENING_ENGINE_THREAD_STATE: EnvironmentThreadState = {
  ...EMPTY_ENVIRONMENT_THREAD_STATE,
  status: "synchronizing",
};

/** A Mate's conversation, read from the account's engine records once its host is mounted. */
function engineThreadStateChanges(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentIdType,
  threadId: ThreadIdType,
): Stream.Stream<EnvironmentThreadState> {
  return AtomRegistry.toStream(registry, mateEngineHostAtom).pipe(
    Stream.switchMap((host) =>
      host === null
        ? Stream.succeed(OPENING_ENGINE_THREAD_STATE)
        : engineThreadChanges(host, { environmentId, conversationId: threadId }),
    ),
  );
}

/** A Mate from before the engine: only its update brings its conversation here. */
const OLDER_MATE_THREAD_STATE: EnvironmentThreadState = {
  ...EMPTY_ENVIRONMENT_THREAD_STATE,
  error: Option.some(MATE_OLDER_WORDS),
};

function threadStateChanges(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentIdType,
  threadId: ThreadIdType,
) {
  return followStreamInEnvironment(
    environmentId,
    Stream.unwrap(
      Effect.gen(function* () {
        const supervisor = yield* EnvironmentSupervisor;
        const cache = yield* EnvironmentCacheStore;
        // The engine's records paint at once, offline too, unless the Mate's door — or the
        // configuration it last cached — says this build and the Mate speak no common protocol.
        const cached = yield* cache
          .loadServerConfig(environmentId)
          .pipe(Effect.orElseSucceed(() => Option.none()));
        const routeBefore = Option.match(cached, {
          onNone: (): EngineRoute["kind"] => "unknown",
          onSome: (config) => {
            const served = config.environment.capabilities.mateEngine;
            return engineRouteOf(served === undefined ? {} : { mateEngine: served.protocol }).kind;
          },
        });
        return Stream.concat(
          Stream.make(routeBefore),
          SubscriptionRef.changes(supervisor.prepared).pipe(
            Stream.filter(Option.isSome),
            Stream.map((prepared) => engineRouteOf(prepared.value).kind),
          ),
        ).pipe(
          // Before the door answers the engine reads already: its answer never opens it again.
          Stream.map((route) => (route === "unknown" ? "engine" : route)),
          Stream.changes,
          Stream.switchMap((route) =>
            route === "update"
              ? Stream.succeed(NEWER_ENGINE_THREAD_STATE)
              : route === "older"
                ? Stream.succeed(OLDER_MATE_THREAD_STATE)
                : engineThreadStateChanges(registry, environmentId, threadId),
          ),
        );
      }),
    ),
  );
}

export function createEnvironmentThreadStateAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | EnvironmentCacheStore | R, E>,
) {
  const family = Atom.family((key: string) => {
    const { environmentId, threadId } = parseThreadKey(key);
    return runtime
      .atom((get) => threadStateChanges(get.registry, environmentId, threadId), {
        initialValue: EMPTY_ENVIRONMENT_THREAD_STATE,
      })
      .pipe(Atom.setIdleTTL(0), Atom.withLabel(`environment-thread-state:${key}`));
  });

  return {
    stateAtom: (environmentId: EnvironmentIdType, threadId: ThreadIdType) =>
      family(threadKey({ environmentId, threadId })),
  };
}

export * from "./archivedThreads.ts";
export * from "./composerPathSearch.ts";
export * from "./threadCommands.ts";
export * from "./threadFeedback.ts";
export * from "./threadDetail.ts";
export * from "./threadReducer.ts";
export * from "./threadShell.ts";
export * from "./threadState.ts";
