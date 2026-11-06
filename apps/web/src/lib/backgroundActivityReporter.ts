import { writeBrowserStorage } from "./storage";
import { connectedArrivals, EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import {
  EnvironmentRpcSubscriptionObserver,
  request,
  type EnvironmentRpcSubscriptionObservation,
} from "@t3tools/client-runtime/rpc";
import {
  type BackgroundScope,
  type ClientActivityReportInput,
  type EnvironmentId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { randomUUID } from "./utils";

const CLIENT_ID_STORAGE_KEY = "t3.backgroundActivity.clientId";
/** A later interaction is reported once the last one the server heard of is this old. */
const INTERACTION_REPORT_SPACING_MS = 15_000;
const BASELINE_SCOPES: ReadonlyArray<BackgroundScope> = [{ type: "provider-status" }];

interface RetainedScope {
  readonly environmentId: EnvironmentId;
  readonly scope: BackgroundScope;
  refCount: number;
}

const retainedScopes = new Map<string, RetainedScope>();
const retainedScopeListeners = new Set<() => void>();

function notifyRetainedScopesChanged(): void {
  for (const listener of retainedScopeListeners) {
    try {
      listener();
    } catch {
      // A failing observer must not corrupt retained-scope lifetime.
    }
  }
}

function stableScopeKey(environmentId: EnvironmentId, scope: BackgroundScope): string {
  switch (scope.type) {
    case "server-config":
    case "diagnostics":
      return JSON.stringify([environmentId, scope.type]);
    case "provider-status":
      return JSON.stringify([environmentId, scope.type, scope.instanceId ?? null]);
    case "vcs-status":
    case "git-refs":
      return JSON.stringify([environmentId, scope.type, scope.cwd]);
    case "thread":
      return JSON.stringify([environmentId, scope.type, scope.threadId]);
  }
}

function getClientId(): string {
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing) return existing;
    const next = randomUUID();
    writeBrowserStorage(window.localStorage, CLIENT_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return "ephemeral-browser-client";
  }
}

function resolveClientKind(): ClientActivityReportInput["clientKind"] {
  return window.desktopBridge ? "desktop-renderer" : "web";
}

/**
 * The person's last interaction as this client tells the server: every report carries how long ago
 * it was, and the server decides on its own clock how long that counts. An interaction asks for a
 * report only once the last one reported is INTERACTION_REPORT_SPACING_MS old, so continued use
 * reaches the server without a report per pointer move, and an idle client sends nothing.
 */
export function makeInteractionTracker(startedAtMs: number) {
  let lastInteractionAtMs = startedAtMs;
  let reportedInteractionAtMs = startedAtMs;
  return {
    /** Records an interaction; true when it should be reported. */
    interact: (atMs: number): boolean => {
      lastInteractionAtMs = atMs;
      return atMs - reportedInteractionAtMs >= INTERACTION_REPORT_SPACING_MS;
    },
    /** The idle time a report sent at `atMs` carries; the interaction counts as reported. */
    reportIdleMs: (atMs: number): number => {
      reportedInteractionAtMs = lastInteractionAtMs;
      return Math.max(0, atMs - lastInteractionAtMs);
    },
  };
}

function createActivityReport(
  environmentId: EnvironmentId,
  idleMs: number,
  observedAtMs: number,
): ClientActivityReportInput {
  const scopes = [...BASELINE_SCOPES];
  for (const entry of retainedScopes.values()) {
    if (entry.environmentId === environmentId) {
      scopes.push(entry.scope);
    }
  }
  return {
    environmentId,
    clientId: getClientId(),
    clientKind: resolveClientKind(),
    visible: document.visibilityState === "visible",
    focused: document.hasFocus(),
    idleMs,
    appState: document.visibilityState === "visible" ? "active" : "background",
    scopes,
    observedAt: DateTime.makeUnsafe(observedAtMs),
  };
}

function scopeForSubscription(
  observation: EnvironmentRpcSubscriptionObservation,
): BackgroundScope | null {
  if (observation.method === WS_METHODS.subscribeResourceTelemetry) {
    return { type: "diagnostics" };
  }
  if (observation.method !== WS_METHODS.subscribeVcsStatus) {
    return null;
  }
  const input = observation.input as { readonly cwd?: unknown; readonly includeRemote?: unknown };
  if (input.includeRemote === false) return null;
  return typeof input.cwd === "string" ? { type: "vcs-status", cwd: input.cwd } : null;
}

function retainBackgroundScope(environmentId: EnvironmentId, scope: BackgroundScope): () => void {
  const key = stableScopeKey(environmentId, scope);
  const existing = retainedScopes.get(key);
  if (existing) {
    existing.refCount += 1;
  } else {
    retainedScopes.set(key, { environmentId, scope, refCount: 1 });
    notifyRetainedScopesChanged();
  }

  return () => {
    const current = retainedScopes.get(key);
    if (!current) return;
    current.refCount -= 1;
    if (current.refCount <= 0) {
      retainedScopes.delete(key);
      notifyRetainedScopesChanged();
    }
  };
}

export function observeBackgroundActivitySubscription(
  observation: EnvironmentRpcSubscriptionObservation,
): Effect.Effect<Effect.Effect<void>> {
  const scope = scopeForSubscription(observation);
  if (scope === null) {
    return Effect.succeed(Effect.void);
  }
  return Effect.sync(() => {
    const release = retainBackgroundScope(observation.environmentId as EnvironmentId, scope);
    return Effect.sync(release);
  });
}

export function retainedBackgroundScopes(
  environmentId: EnvironmentId,
): ReadonlyArray<BackgroundScope> {
  return Array.from(retainedScopes.values(), (entry) =>
    entry.environmentId === environmentId ? entry.scope : null,
  ).filter((scope): scope is BackgroundScope => scope !== null);
}

export const backgroundActivityObserverLayer = Layer.succeed(
  EnvironmentRpcSubscriptionObserver,
  EnvironmentRpcSubscriptionObserver.of({
    observe: observeBackgroundActivitySubscription,
  }),
);

/**
 * Runs `report` on each environment connected now (A9): a Mate is connected only while something
 * holds it, and a report to a parked one would wake it — so one parked, connecting or blocked
 * hears nothing until it is up again. A report that fails is passed by.
 */
export const reportToConnected = <A, E, R>(
  registry: Pick<EnvironmentRegistry["Service"], "entries" | "state" | "run">,
  report: (environmentId: EnvironmentId) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const entries = yield* SubscriptionRef.get(registry.entries);
    yield* Effect.forEach(
      entries.keys(),
      (environmentId) =>
        Effect.gen(function* () {
          const state = yield* registry.state(environmentId);
          if (state.phase !== "connected") return;
          yield* registry.run(environmentId, report(environmentId));
        }).pipe(Effect.ignore),
      { concurrency: "unbounded", discard: true },
    );
  });

export const backgroundActivityReporterLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const registry = yield* EnvironmentRegistry;
    const clock = yield* Clock.Clock;
    const reportRequests = yield* Queue.sliding<void>(1);
    const requestReport = () => Queue.offerUnsafe(reportRequests, undefined);
    const interaction = makeInteractionTracker(clock.currentTimeMillisUnsafe());
    const recordInteraction = () => {
      if (interaction.interact(clock.currentTimeMillisUnsafe())) {
        requestReport();
      }
    };
    const passiveListenerOptions = { passive: true } as const;

    const reportRequest = Effect.gen(function* () {
      const observedAtMs = yield* Clock.currentTimeMillis;
      const idleMs = interaction.reportIdleMs(observedAtMs);
      return (environmentId: EnvironmentId) =>
        request(
          WS_METHODS.serverReportClientActivity,
          createActivityReport(environmentId, idleMs, observedAtMs),
        );
    });
    const report = reportRequest.pipe(
      Effect.flatMap((send) => reportToConnected(registry, send)),
      Effect.withSpan("web.backgroundActivity.report"),
    );
    // The server holds a client's lease exactly as long as its socket, so each new socket hears it.
    const reportArrival = (environmentId: EnvironmentId) =>
      reportRequest.pipe(
        Effect.flatMap((send) => registry.run(environmentId, send(environmentId))),
        Effect.ignore,
        Effect.withSpan("web.backgroundActivity.arrival"),
      );

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        retainedScopeListeners.add(requestReport);
        document.addEventListener("visibilitychange", requestReport);
        window.addEventListener("focus", requestReport);
        window.addEventListener("blur", requestReport);
        window.addEventListener("online", requestReport);
        window.addEventListener("pointermove", recordInteraction);
        window.addEventListener("keydown", recordInteraction);
        window.addEventListener("wheel", recordInteraction, passiveListenerOptions);
        window.addEventListener("touchstart", recordInteraction, passiveListenerOptions);
      }),
      () =>
        Effect.sync(() => {
          retainedScopeListeners.delete(requestReport);
          document.removeEventListener("visibilitychange", requestReport);
          window.removeEventListener("focus", requestReport);
          window.removeEventListener("blur", requestReport);
          window.removeEventListener("online", requestReport);
          window.removeEventListener("pointermove", recordInteraction);
          window.removeEventListener("keydown", recordInteraction);
          window.removeEventListener("wheel", recordInteraction);
          window.removeEventListener("touchstart", recordInteraction);
        }),
    );

    yield* connectedArrivals(registry).pipe(Stream.runForEach(reportArrival), Effect.forkScoped);
    yield* Stream.fromQueue(reportRequests).pipe(
      Stream.debounce("250 millis"),
      Stream.runForEach(() => report),
      Effect.forkScoped,
    );
  }),
);
