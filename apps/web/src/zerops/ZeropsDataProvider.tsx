// @effect-diagnostics cryptoRandomUUID:off -- opaque runtime, receiver and subscription identities
import { RegistryContext } from "@effect/atom-react";
import {
  AccountEpoch,
  makeBuildLogTransport,
  makeZeropsApiOrigin,
  makeZeropsDataAdapter,
  makeZeropsDataRuntime,
  makeZeropsResourceRestAdapter,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  type AccountScope,
  type ManagedZeropsDataRuntime,
  type BuildLogSocketConstructor,
  type PlatformWatchSocket,
} from "@t3tools/client-runtime/zerops/data";
import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import * as Effect from "effect/Effect";
import * as Scheduler from "effect/Scheduler";
import * as Stream from "effect/Stream";
import { type AtomRegistry } from "effect/unstable/reactivity";
import { useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { ZeropsLandingWait } from "../components/zerops/landing/ZeropsLandingShell";
import { currentAccountEpoch, onAccountLifetimeClose } from "./accountLifetime";
import { makeBrowserDataScheduler } from "./dataScheduler";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { ZeropsDataContext, type ZeropsDataContextValue } from "./zeropsDataContext";

export function connectZeropsDataSocket(url: string): PlatformWatchSocket {
  const socket = new WebSocket(url);
  const wrapper: PlatformWatchSocket = {
    send: (data) => socket.send(data),
    close: () => socket.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  socket.onopen = () => wrapper.onopen?.();
  socket.onmessage = (event: MessageEvent) => wrapper.onmessage?.({ data: String(event.data) });
  socket.onclose = () => wrapper.onclose?.();
  socket.onerror = (event) => wrapper.onerror?.(event);
  return wrapper;
}

function browserVisibility() {
  return {
    current: Effect.sync(() => (document.visibilityState === "hidden" ? "hidden" : "visible")),
    changes: Stream.fromEventListener(document, "visibilitychange").pipe(
      Stream.map(() => (document.visibilityState === "hidden" ? "hidden" : "visible")),
    ),
  } as const;
}

/**
 * Builds one platform-data runtime for one account. The default is the real
 * browser adapter stack; a test may substitute a fake one (the only clean
 * seam onto `ZeropsDataProvider`'s ownership contract — `makeZeropsDataRuntime`
 * itself is not mockable without a module mock, and this component has no
 * other injection point).
 *
 * `signal` aborts the underlying Effect fiber: a startup that never settles
 * on its own still settles (rejected) the moment the provider unmounts,
 * instead of leaking the scheduler and MessageChannel forever (H4).
 */
export type MakeZeropsDataRuntime = (input: {
  readonly scope: AccountScope;
  readonly client: ZeropsApiClient;
  readonly registry: AtomRegistry.AtomRegistry;
  readonly scheduler: Scheduler.Scheduler;
  readonly signal: AbortSignal;
}) => Promise<ManagedZeropsDataRuntime>;

export const defaultMakeZeropsDataRuntime: MakeZeropsDataRuntime = ({
  scope,
  client,
  registry,
  scheduler,
  signal,
}) => {
  const adapter = makeZeropsDataAdapter({
    client,
    makeSocket: connectZeropsDataSocket,
    timers: {
      setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimer: (handle) => window.clearTimeout(handle as number),
    },
  });
  const logTimers = {
    setTimer: (callback: () => void, delayMs: number) => window.setTimeout(callback, delayMs),
    clearTimer: (handle: unknown) => window.clearTimeout(handle as number),
  };
  return Effect.runPromise(
    makeZeropsDataRuntime({
      scope,
      adapter,
      resourceAdapter: makeZeropsResourceRestAdapter(client),
      buildLogTransport: makeBuildLogTransport({
        scope,
        acquireGrant: (project, projectSignal) =>
          client.fetchProjectLogAccess(project.projectId, projectSignal),
        fetchImpl: (url, fetchSignal) => fetch(url, { signal: fetchSignal }),
        WebSocketCtor: WebSocket as unknown as BuildLogSocketConstructor,
      }),
      logTimers,
      atomRegistry: registry,
      makeOpaqueId: () => crypto.randomUUID(),
      visibility: browserVisibility(),
    }).pipe(Effect.provideService(Scheduler.Scheduler, scheduler)),
    { signal },
  );
};

export function ZeropsDataStartupFailure({
  message,
  retry,
  signOut,
}: {
  readonly message: string;
  readonly retry: () => void;
  readonly signOut: () => void;
}) {
  return (
    <div role="alert" className="p-8">
      Could not start Zerops data. {message}{" "}
      <button type="button" onClick={retry}>
        Try again
      </button>{" "}
      <button type="button" onClick={signOut}>
        Sign out
      </button>
    </div>
  );
}

/** Owns exactly one platform-data runtime for one verified account lifetime. */
export function ZeropsDataProvider({
  children,
  makeRuntime = defaultMakeZeropsDataRuntime,
}: {
  readonly children: ReactNode;
  /** Test-only seam: substitutes the real adapter/runtime construction. */
  readonly makeRuntime?: MakeZeropsDataRuntime;
}) {
  const { client, signOut, status, user } = useZeropsSession();
  const registry = useContext(RegistryContext);
  const accountId = status === "signed-in" ? (user?.id ?? null) : null;
  const [runtime, setRuntime] = useState<ManagedZeropsDataRuntime | null>(null);
  const [startupFailure, setStartupFailure] = useState<{
    readonly accountId: string;
    readonly message: string;
  } | null>(null);
  const [startupAttempt, setStartupAttempt] = useState(0);

  useEffect(() => {
    if (accountId === null) return;
    let cancelled = false;
    let current: ManagedZeropsDataRuntime | null = null;
    let removeLifetimeClose: () => void = () => undefined;
    setStartupFailure(null);
    const scope = {
      account: {
        apiOrigin: makeZeropsApiOrigin(client.baseUrl),
        accountId: ZeropsAccountId.make(accountId),
      },
      epoch: AccountEpoch.make(currentAccountEpoch()),
    };
    const taskScheduler = makeBrowserDataScheduler();
    const abort = new AbortController();
    let shutdownPromise: Promise<void> | null = null;
    const shutdown = (created: ManagedZeropsDataRuntime, reason: "account-replaced" | "logout") => {
      shutdownPromise ??= Effect.runPromise(created.shutdown(reason)).finally(
        taskScheduler.dispose,
      );
      return shutdownPromise;
    };
    void makeRuntime({
      scope,
      client,
      registry,
      scheduler: taskScheduler.scheduler,
      signal: abort.signal,
    }).then(
      (created) => {
        current = created;
        if (cancelled) {
          void shutdown(created, "account-replaced");
          return;
        }
        removeLifetimeClose = onAccountLifetimeClose(() => {
          void shutdown(created, "logout");
        });
        setRuntime(created);
      },
      (cause: unknown) => {
        // Also reached when `abort` fires on unmount before startup settled
        // on its own — the interrupted fiber rejects, and cleanup below has
        // already flipped `cancelled`, so this only disposes the scheduler.
        taskScheduler.dispose();
        if (!cancelled) setStartupFailure({ accountId, message: zeropsErrorMessage(cause) });
      },
    );

    return () => {
      cancelled = true;
      abort.abort();
      removeLifetimeClose();
      setRuntime(null);
      if (current !== null) void shutdown(current, "account-replaced");
    };
  }, [accountId, client, makeRuntime, registry, startupAttempt]);

  const value = useMemo<ZeropsDataContextValue | null>(() => {
    if (runtime === null || runtime.scope.account.accountId !== accountId) return null;
    const organizationRef = (organizationId: string) => ({
      kind: "organization" as const,
      account: runtime.scope.account,
      organizationId: ZeropsOrganizationId.make(organizationId),
    });
    return {
      runtime,
      organizationRef,
      projectRef: (organizationId, projectId) => ({
        kind: "project",
        organization: organizationRef(organizationId),
        projectId: ZeropsProjectId.make(projectId),
      }),
    };
  }, [accountId, runtime]);

  const startupError = startupFailure?.accountId === accountId ? startupFailure.message : null;
  if (value === null)
    return startupError === null ? (
      <ZeropsLandingWait label="Starting Zerops data…" />
    ) : (
      <ZeropsDataStartupFailure
        message={startupError}
        retry={() => setStartupAttempt((attempt) => attempt + 1)}
        signOut={() => void signOut()}
      />
    );
  return <ZeropsDataContext value={value}>{children}</ZeropsDataContext>;
}
