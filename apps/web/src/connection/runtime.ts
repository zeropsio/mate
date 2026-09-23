import { Connection, EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { shellSnapshotLoaderLayer } from "@t3tools/client-runtime/state/shell";
import { threadSnapshotLoaderLayer } from "@t3tools/client-runtime/state/threads";
import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom } from "effect/unstable/reactivity";
import type { EnvironmentId } from "@t3tools/contracts";

import { runtimeContextLayer } from "../lib/runtime";
import {
  backgroundActivityObserverLayer,
  backgroundActivityReporterLayer,
} from "../lib/backgroundActivityReporter";
import { connectionPlatformLayer } from "./platform";

const providedConnectionPlatformLayer = connectionPlatformLayer.pipe(
  Layer.provide(runtimeContextLayer),
);

const snapshotLoaderLayer = Layer.mergeAll(threadSnapshotLoaderLayer, shellSnapshotLoaderLayer);

type ConnectionLayerSource =
  | typeof Connection.layer
  | typeof snapshotLoaderLayer
  | typeof runtimeContextLayer
  | typeof connectionPlatformLayer
  | typeof backgroundActivityObserverLayer
  | typeof backgroundActivityReporterLayer;

const providedClientConnectionLayer = Layer.merge(
  Connection.layerWithOptions({ usageLimitSources: true, usageLimitsCommand: true }),
  snapshotLoaderLayer,
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      runtimeContextLayer,
      providedConnectionPlatformLayer,
      backgroundActivityObserverLayer,
    ),
  ),
);

/**
 * The catalog's lifetime, for diagnostics: this runtime built, each
 * environment it gains or loses, and the runtime disposed.
 */
const catalogDiagnosticsLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* EnvironmentRegistry;
    yield* Effect.acquireRelease(
      Effect.sync(() => mateDiagnostics.record({ kind: "catalog", change: "built" })),
      () => Effect.sync(() => mateDiagnostics.record({ kind: "catalog", change: "disposed" })),
    );
    let known: ReadonlySet<EnvironmentId> = new Set();
    yield* SubscriptionRef.changes(registry.entries).pipe(
      Stream.runForEach((entries) =>
        Effect.sync(() => {
          for (const environmentId of entries.keys()) {
            if (!known.has(environmentId))
              mateDiagnostics.record({ kind: "catalog", change: "added", environmentId });
          }
          for (const environmentId of known) {
            if (!entries.has(environmentId))
              mateDiagnostics.record({ kind: "catalog", change: "removed", environmentId });
          }
          known = new Set(entries.keys());
        }),
      ),
      Effect.forkScoped,
    );
  }),
);

const connectionLayer = Layer.mergeAll(
  backgroundActivityReporterLayer,
  catalogDiagnosticsLayer,
).pipe(Layer.provideMerge(providedClientConnectionLayer));

export const connectionAtomRuntime: Atom.AtomRuntime<
  Layer.Success<ConnectionLayerSource>,
  Layer.Error<ConnectionLayerSource>
> = Atom.runtime(connectionLayer);
