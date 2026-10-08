import { type EnvironmentId, type ServerConfig } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentCacheStore } from "../platform/persistence.ts";
import { ShellSnapshotLoader } from "./shellSnapshotHttp.ts";
import type { EnvironmentCatalogState } from "./connections.ts";
import { followStreamInEnvironment } from "./runtime.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { engineRouteOf, mateEngineHostAtom, mateEngineReaderAtom } from "../data/engineHost.ts";
import { engineShellChanges, type EngineShellOverlay } from "../data/engineThreadChanges.ts";

import { openShellReplay, EMPTY_SHELL_STATE } from "../data/adapters/mateShellReplay.ts";
export const makeEnvironmentShellState = openShellReplay;
export { openShellReplay } from "../data/adapters/mateShellReplay.ts";
export type {
  EnvironmentShellState,
  EnvironmentShellStatus,
} from "../data/adapters/mateShellReplay.ts";
import type { EnvironmentShellState } from "../data/adapters/mateShellReplay.ts";

/**
 * What an engine Mate's rows lay over its V1 shell, once its door names a protocol this build
 * speaks and the account's engine host is mounted; `null` for every other Mate.
 */
function engineShellOverlays(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
): Stream.Stream<EngineShellOverlay | null, never, EnvironmentSupervisor> {
  return Stream.unwrap(
    Effect.map(EnvironmentSupervisor, (supervisor) =>
      SubscriptionRef.changes(supervisor.prepared).pipe(
        Stream.filter(Option.isSome),
        Stream.map(
          (prepared) =>
            engineRouteOf(prepared.value).kind === "engine" &&
            registry.get(mateEngineReaderAtom) === "engine",
        ),
        Stream.changes,
        Stream.switchMap((engine) =>
          engine
            ? AtomRegistry.toStream(registry, mateEngineHostAtom).pipe(
                Stream.switchMap((host) =>
                  host === null ? Stream.succeed(null) : engineShellChanges(host, environmentId),
                ),
              )
            : Stream.succeed(null),
        ),
      ),
    ),
  );
}

function shellStateChanges(registry: AtomRegistry.AtomRegistry, environmentId: EnvironmentId) {
  // A V1 Mate's shell passes through as its replay says; an engine Mate's carries its rows.
  return followStreamInEnvironment(
    environmentId,
    Stream.zipLatest(
      Stream.unwrap(makeEnvironmentShellState().pipe(Effect.map(SubscriptionRef.changes))),
      Stream.concat(Stream.succeed(null), engineShellOverlays(registry, environmentId)).pipe(
        Stream.changes,
      ),
    ).pipe(Stream.map(([shell, overlay]) => (overlay === null ? shell : overlay(shell)))),
  );
}

export interface EnvironmentShellSummary {
  readonly hasSnapshot: boolean;
  readonly hasSynchronizingShell: boolean;
  readonly hasCachedShell: boolean;
  readonly hasLiveShell: boolean;
  readonly firstError: string | null;
  readonly latestSnapshotUpdatedAt: string | null;
}

const EMPTY_ENVIRONMENT_SHELL_SUMMARY: EnvironmentShellSummary = Object.freeze({
  hasSnapshot: false,
  hasSynchronizingShell: false,
  hasCachedShell: false,
  hasLiveShell: false,
  firstError: null,
  latestSnapshotUpdatedAt: null,
});

const EMPTY_SERVER_CONFIGS: ReadonlyMap<EnvironmentId, ServerConfig> = new Map();

function shellSummariesEqual(
  left: EnvironmentShellSummary,
  right: EnvironmentShellSummary,
): boolean {
  return (
    left.hasSnapshot === right.hasSnapshot &&
    left.hasSynchronizingShell === right.hasSynchronizingShell &&
    left.hasCachedShell === right.hasCachedShell &&
    left.hasLiveShell === right.hasLiveShell &&
    left.firstError === right.firstError &&
    left.latestSnapshotUpdatedAt === right.latestSnapshotUpdatedAt
  );
}

function mapsEqual<K, V>(left: ReadonlyMap<K, V>, right: ReadonlyMap<K, V>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [key, value] of left) {
    if (right.get(key) !== value) {
      return false;
    }
  }
  return true;
}

export function createEnvironmentShellSummaryAtom(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly shellStateValueAtom: (environmentId: EnvironmentId) => Atom.Atom<EnvironmentShellState>;
}) {
  let previousSummary = EMPTY_ENVIRONMENT_SHELL_SUMMARY;
  return Atom.make((get) => {
    let hasSnapshot = false;
    let hasSynchronizingShell = false;
    let hasCachedShell = false;
    let hasLiveShell = false;
    let firstError: string | null = null;
    let latestSnapshotUpdatedAt: string | null = null;

    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      const state = get(input.shellStateValueAtom(environmentId));
      hasSynchronizingShell ||= state.status === "synchronizing";
      hasCachedShell ||= state.status === "cached";
      hasLiveShell ||= state.status === "live";
      if (firstError === null) {
        firstError = Option.getOrNull(state.error);
      }
      if (Option.isNone(state.snapshot)) {
        continue;
      }
      hasSnapshot = true;
      const updatedAt = state.snapshot.value.updatedAt;
      if (latestSnapshotUpdatedAt === null || updatedAt > latestSnapshotUpdatedAt) {
        latestSnapshotUpdatedAt = updatedAt;
      }
    }

    const next: EnvironmentShellSummary = {
      hasSnapshot,
      hasSynchronizingShell,
      hasCachedShell,
      hasLiveShell,
      firstError,
      latestSnapshotUpdatedAt,
    };
    if (shellSummariesEqual(previousSummary, next)) {
      return previousSummary;
    }
    previousSummary = next;
    return previousSummary;
  }).pipe(Atom.withLabel("environment-shell-summary"));
}

export function createEnvironmentServerConfigsAtom(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly serverConfigValueAtom: (environmentId: EnvironmentId) => Atom.Atom<ServerConfig | null>;
}) {
  let previousServerConfigs = EMPTY_SERVER_CONFIGS;
  return Atom.make((get) => {
    const next = new Map<EnvironmentId, ServerConfig>();
    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      const config = get(input.serverConfigValueAtom(environmentId));
      if (config !== null) {
        next.set(environmentId, config);
      }
    }
    if (mapsEqual(previousServerConfigs, next)) {
      return previousServerConfigs;
    }
    previousServerConfigs = next;
    return previousServerConfigs;
  }).pipe(Atom.withLabel("environment-server-configs"));
}

export function createEnvironmentShellAtoms<R, E>(
  runtime: Atom.AtomRuntime<
    EnvironmentRegistry | EnvironmentCacheStore | ShellSnapshotLoader | R,
    E
  >,
) {
  const stateAtom = Atom.family((environmentId: EnvironmentId) =>
    runtime.atom((get) => shellStateChanges(get.registry, environmentId), {
      initialValue: EMPTY_SHELL_STATE,
    }),
  );

  const stateValueAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) =>
      Option.getOrElse(AsyncResult.value(get(stateAtom(environmentId))), () => EMPTY_SHELL_STATE),
    ).pipe(Atom.withLabel(`environment-shell-state-value:${environmentId}`)),
  );

  return {
    stateAtom,
    stateValueAtom,
  };
}

export * from "./models.ts";
export * from "./shellCommands.ts";
export * from "./shellReducer.ts";
export * from "./shellSnapshotHttp.ts";
export * from "./snapshots.ts";
