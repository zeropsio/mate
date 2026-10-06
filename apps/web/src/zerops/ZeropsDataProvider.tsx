// @effect-diagnostics cryptoRandomUUID:off -- opaque runtime, receiver and subscription identities
import { RegistryContext } from "@effect/atom-react";
import {
  makeAccountRuntime,
  type AccountRuntime,
} from "@t3tools/client-runtime/zerops/account/runtime";
import {
  AccountEpoch,
  DEFAULT_ZEROPS_GRANT_POLICY,
  grantCapabilities,
  makeRestAccessVerifier,
  makeZeropsApiOrigin,
  makeZeropsDataAdapter,
  makeZeropsDataRuntime,
  writeAdmissionOf,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  type AccountScope,
  type ManagedZeropsDataRuntime,
  type PlatformWatchSocket,
} from "@t3tools/client-runtime/zerops/data";
import type { ZeropsApiClient, ZeropsUser } from "@t3tools/client-runtime/zerops";
import type { PlatformSignals } from "@t3tools/client-runtime/zerops/knowledge";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Scheduler from "effect/Scheduler";
import { type AtomRegistry } from "effect/unstable/reactivity";
import {
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ZeropsFrameWait } from "../components/zerops/landing/ZeropsLandingShell";
import { bindAccountEnvironments, useAccountEnvironments } from "./accountEnvironments";
import { bindAccountFlow } from "./accountForge";
import { bindAccountInvalidations } from "./accountInvalidations";
import { holdRegistryUntil } from "../rpc/atomRegistry";
import { currentAccountEpoch, onAccountLifetimeClose } from "./accountLifetime";
import { browserPlatformSignals, signalsVisibility } from "./browserSignals";
import { makeBrowserDataScheduler } from "./dataScheduler";
import { webEnvironmentPorts } from "./environmentPorts";
import { useAccountStoreForAdapters } from "./ZeropsAccountData";
import { tabClock } from "./tabClock";
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
  /** The account's tab signals: the runtime pauses its push half while the tab is hidden. */
  readonly signals: PlatformSignals;
  readonly signal: AbortSignal;
}) => Promise<ManagedZeropsDataRuntime>;

export const defaultMakeZeropsDataRuntime: MakeZeropsDataRuntime = ({
  scope,
  client,
  registry,
  scheduler,
  signals,
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
  return Effect.runPromise(
    makeZeropsDataRuntime({
      scope,
      adapter,
      atomRegistry: registry,
      makeOpaqueId: () => crypto.randomUUID(),
      visibility: signalsVisibility(signals),
    }).pipe(
      Effect.provideService(Scheduler.Scheduler, scheduler),
      Effect.provideService(Clock.Clock, tabClock),
    ),
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

/** The account's organization and project refs, keyed off the data runtime's account. */
function accountRefs(
  runtime: ManagedZeropsDataRuntime,
): Pick<ZeropsDataContextValue, "organizationRef" | "projectRef"> {
  const organizationRef = (organizationId: string) => ({
    kind: "organization" as const,
    account: runtime.scope.account,
    organizationId: ZeropsOrganizationId.make(organizationId),
  });
  return {
    organizationRef,
    projectRef: (organizationId, projectId) => ({
      kind: "project",
      organization: organizationRef(organizationId),
      projectId: ZeropsProjectId.make(projectId),
    }),
  };
}

/**
 * Owns exactly one account runtime for one verified account lifetime: the
 * platform-data runtime `makeRuntime` builds, its access grant verified
 * through the session's client, its invalidation bus bound for the web's
 * surfaces, and — once the epoch's first grant built it — its post-grant
 * stage: the Mate environments, the project flow's deployments, and the births
 * beside them.
 */
export function ZeropsDataProvider({
  children,
  pending,
  makeRuntime = defaultMakeZeropsDataRuntime,
}: {
  readonly children: ReactNode;
  readonly pending?: ReactNode;
  /** Test-only seam: substitutes the real adapter/runtime construction. */
  readonly makeRuntime?: MakeZeropsDataRuntime;
}) {
  const { activeOrganization, client, signOut, status, updateVerifiedMemberships, user } =
    useZeropsSession();
  const verifiedMemberships = useEffectEvent((verified: ZeropsUser) =>
    updateVerifiedMemberships(verified),
  );
  const registry = useContext(RegistryContext);
  const store = useAccountStoreForAdapters();
  if (store === null) throw new Error("ZeropsDataProvider must be inside ZeropsAccountData.");
  const activeId = useRef(activeOrganization?.id ?? null);
  const accountOwner = useRef<AccountRuntime | null>(null);
  useEffect(() => {
    activeId.current = activeOrganization?.id ?? null;
    accountOwner.current?.selectOrganization(activeId.current);
  }, [activeOrganization?.id]);
  const accountId = status === "signed-in" ? (user?.id ?? null) : null;
  const [opened, setOpened] = useState<{
    readonly runtime: ManagedZeropsDataRuntime;
    readonly signals: PlatformSignals;
  } | null>(null);
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
    let unbindInvalidations: () => void = () => undefined;
    let unbindEnvironments: () => void = () => undefined;
    let unbindFlow: () => void = () => undefined;
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
    const signals = browserPlatformSignals(document, window);
    /** The account runtime being built on the data runtime, once there is one. */
    let account: Promise<AccountRuntime> | null = null;
    let shutdownPromise: Promise<void> | null = null;
    // The account's registry outlives this epoch's teardown, from the moment it starts: whenever
    // the account's lifetime closes — mid-startup too — its registry goes only once whatever runtime
    // stood has shut down (a grant closing still publishes its last view).
    let endTeardown: () => void = () => undefined;
    const teardown = new Promise<void>((resolve) => {
      endTeardown = resolve;
    });
    const removeTeardownHold = onAccountLifetimeClose(() => holdRegistryUntil(teardown));
    void teardown.then(removeTeardownHold);
    const shutdown = (created: ManagedZeropsDataRuntime, reason: "account-replaced" | "logout") => {
      shutdownPromise ??= (account ?? Promise.resolve(null))
        .then(
          (built) => Effect.runPromise(built?.close(reason) ?? created.shutdown(reason)),
          // An account runtime that never stood leaves only the data runtime to close.
          () => Effect.runPromise(created.shutdown(reason)),
        )
        .finally(() => {
          taskScheduler.dispose();
          endTeardown();
        });
      return shutdownPromise;
    };
    void makeRuntime({
      scope,
      client,
      registry,
      scheduler: taskScheduler.scheduler,
      signals,
      signal: abort.signal,
    }).then(
      (created) => {
        current = created;
        if (cancelled) {
          void shutdown(created, "account-replaced");
          return;
        }
        // Project writes are this epoch's from now on; once it closed, its grant refuses them.
        client.admitWritesThrough(writeAdmissionOf(grantCapabilities(created.access)));
        account = Effect.runPromise(
          makeAccountRuntime({
            data: created,
            verifier: makeRestAccessVerifier({
              client,
              readProject: created.readProjectForAccess,
              account: scope.account,
              concurrency: DEFAULT_ZEROPS_GRANT_POLICY.roundProjectConcurrency,
              onUser: (verified) => verifiedMemberships(verified),
              // The session read the user as it opened: the first round takes it.
              recentUser: () => client.verifiedUser(),
            }),
            signals,
            atomRegistry: registry,
            environments: webEnvironmentPorts({ client, registry }),
            store,
          }),
        );
        void account.then(
          (built) => {
            // A cleanup before the account runtime stood closes it through `shutdown`.
            if (cancelled) return;
            removeLifetimeClose = onAccountLifetimeClose(() => {
              void shutdown(created, "logout");
            });
            accountOwner.current = built;
            built.selectOrganization(activeId.current);
            // Surfaces send their intents to this account's bus from the first mount.
            unbindInvalidations = bindAccountInvalidations(built.invalidations);
            setOpened({ runtime: created, signals });
            // The post-grant stage stands on the epoch's first grant: surfaces read its Mate
            // environments and its project flow's deployments from then on.
            void Effect.runPromise(built.postGrant).then(
              (stage) => {
                if (cancelled) return;
                unbindEnvironments = bindAccountEnvironments(stage.environments);
                unbindFlow = bindAccountFlow(stage);
              },
              // An epoch that closed before its first grant never had a post-grant stage.
              () => undefined,
            );
          },
          (cause: unknown) => {
            void shutdown(created, "account-replaced");
            if (!cancelled) setStartupFailure({ accountId, message: zeropsErrorMessage(cause) });
          },
        );
      },
      (cause: unknown) => {
        // Also reached when `abort` fires on unmount before startup settled
        // on its own — the interrupted fiber rejects, and cleanup below has
        // already flipped `cancelled`, so this only disposes the scheduler. No runtime stood:
        // nothing holds the registry any longer.
        taskScheduler.dispose();
        endTeardown();
        if (!cancelled) setStartupFailure({ accountId, message: zeropsErrorMessage(cause) });
      },
    );

    return () => {
      cancelled = true;
      accountOwner.current = null;
      abort.abort();
      removeLifetimeClose();
      unbindInvalidations();
      unbindEnvironments();
      unbindFlow();
      setOpened(null);
      if (current !== null) void shutdown(current, "account-replaced");
    };
  }, [accountId, client, makeRuntime, registry, startupAttempt, store]);

  const value = useMemo<ZeropsDataContextValue | null>(() => {
    if (opened === null || opened.runtime.scope.account.accountId !== accountId) return null;
    const { runtime, signals } = opened;
    return { runtime, signals, ...accountRefs(runtime) };
  }, [accountId, opened]);

  // Auto-connect wants the ready Mates of the organization this tab has open (D13).
  const environments = useAccountEnvironments();
  const activeOrganizationId = activeOrganization?.id ?? null;
  useEffect(() => {
    environments?.setActiveOrganization(activeOrganizationId);
  }, [activeOrganizationId, environments]);

  const startupError = startupFailure?.accountId === accountId ? startupFailure.message : null;
  if (value === null)
    return (
      <>
        {pending}
        {startupError === null ? (
          <ZeropsFrameWait label="Starting Zerops data…" signedIn />
        ) : (
          <ZeropsDataStartupFailure
            message={startupError}
            retry={() => setStartupAttempt((attempt) => attempt + 1)}
            signOut={() => void signOut()}
          />
        )}
      </>
    );
  return <ZeropsDataContext value={value}>{children}</ZeropsDataContext>;
}
