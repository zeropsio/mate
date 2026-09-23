import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/unstable/reactivity";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import {
  makeAccountRuntime,
  type AccountEnvironments,
  type AccountRuntime,
} from "@t3tools/client-runtime/zerops/account/runtime";
import {
  AccountEpoch,
  makeZeropsApiOrigin,
  makeZeropsDataAdapter,
  makeZeropsDataRuntime,
  makeZeropsResourceRestAdapter,
  ZeropsAccountId,
  type AccountScope,
  type ManagedZeropsDataRuntime,
  type ZeropsVisibility,
} from "@t3tools/client-runtime/zerops/data";
import type { ZeropsApiClient, ZeropsUser } from "@t3tools/client-runtime/zerops";
import type { PlatformWatchSocket } from "@t3tools/client-runtime/zerops/data";

import { mobileAccountPorts, type MobileAccountPorts } from "./environment-ports";

export interface MobileZeropsDataAccount {
  readonly client: ZeropsApiClient;
  /** This is the verified Zerops principal ID, never an access token. */
  readonly userId: string;
  /** Told each user the account's grant rounds read, so the session's memberships stay current. */
  readonly onUser: (user: ZeropsUser) => void;
}

export interface ZeropsDataBinding {
  readonly account: AccountScope;
  readonly runtime: ManagedZeropsDataRuntime;
  readonly registry: AtomRegistry.AtomRegistry;
}

export interface ZeropsDataValue {
  readonly binding: ZeropsDataBinding | null;
  /**
   * The account runtime's Mate environments (DESIGN §7.5): null until the epoch's first grant built
   * its post-grant stage, and again once the account closed.
   */
  readonly environments: AccountEnvironments | null;
  readonly error: Error | null;
}

type RuntimeFactory = (input: {
  readonly account: AccountScope;
  readonly client: ZeropsApiClient;
  readonly registry: AtomRegistry.AtomRegistry;
}) => Promise<ManagedZeropsDataRuntime>;

/** What the account runtime reaches the platform and the device through, besides its data. */
type AccountPortsFactory = (input: {
  readonly account: AccountScope;
  readonly client: ZeropsApiClient;
  readonly onUser: (user: ZeropsUser) => void;
}) => Promise<MobileAccountPorts>;

const ZeropsDataContext = createContext<ZeropsDataValue | null>(null);

let opaqueId = 0;

function nextOpaqueId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId !== undefined) return randomId;
  opaqueId += 1;
  return `mobile-zerops-${opaqueId}`;
}

function connectPlatformSocket(url: string): PlatformWatchSocket {
  return new WebSocket(url) as unknown as PlatformWatchSocket;
}

function toVisibilityState(state: AppStateStatus): "visible" | "hidden" {
  return state === "active" ? "visible" : "hidden";
}

/** React Native has no page-visibility DOM event; AppState is its equivalent. */
export function mobileZeropsVisibility(): ZeropsVisibility {
  return {
    current: Effect.sync(() => toVisibilityState(AppState.currentState)),
    changes: Stream.callback<"visible" | "hidden">((queue) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          AppState.addEventListener("change", (nextState) => {
            Queue.offerUnsafe(queue, toVisibilityState(nextState));
          }),
        ),
        (subscription) => Effect.sync(() => subscription.remove()),
      ).pipe(Effect.asVoid),
    ),
  };
}

const createRuntime: RuntimeFactory = ({ account, client, registry }) =>
  Effect.runPromise(
    makeZeropsDataRuntime({
      scope: account,
      atomRegistry: registry,
      adapter: makeZeropsDataAdapter({
        client,
        makeSocket: connectPlatformSocket,
        timers: {
          setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
          clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
      }),
      resourceAdapter: makeZeropsResourceRestAdapter(client),
      makeOpaqueId: nextOpaqueId,
      visibility: mobileZeropsVisibility(),
    }),
  );

/** The account closes: its runtime ends its stages and then the data runtime (§5 L9). */
async function closeAccount(
  account: AccountRuntime,
  registry: AtomRegistry.AtomRegistry,
  reason: "logout" | "account-replaced",
) {
  try {
    // Runtime shutdown marks the scope closed before it interrupts transport or
    // releases atoms, so late callbacks cannot publish into a later account.
    await Effect.runPromise(account.close(reason));
  } finally {
    registry.dispose();
  }
}

const CLOSED: ZeropsDataValue = { binding: null, environments: null, error: null };

/**
 * Owns the account runtime of one verified Zerops account (DESIGN §7.5): the platform-data runtime
 * `runtimeFactory` builds, its access grant verified through the session's client, and — once
 * the epoch's first grant built it — its post-grant stage, the Mate environments. An inactive
 * account intentionally creates no adapter, transport, atom registry, or platform data.
 */
export function ZeropsDataProvider({
  account,
  children,
  runtimeFactory = createRuntime,
  accountPorts = mobileAccountPorts,
}: {
  readonly account: MobileZeropsDataAccount | null;
  readonly children: ReactNode;
  /** Test seam; product callers use the frozen shared adapter/runtime factory. */
  readonly runtimeFactory?: RuntimeFactory;
  /** Test seam; product callers reach the device and the platform through the native ports. */
  readonly accountPorts?: AccountPortsFactory;
}) {
  const [value, setValue] = useState<ZeropsDataValue>(CLOSED);
  const lifecycle = useRef(Promise.resolve());
  const epoch = useRef(0);
  const accountKey = account === null ? null : `${account.client.baseUrl}\u0000${account.userId}`;
  const client = account?.client ?? null;
  // Layout effects for a commit all finish — cleanup and setup — before any
  // passive effect's cleanup runs, so this ref is already current by the
  // time the account-effect below tears down the account it is replacing.
  // That is what lets its cleanup tell logout from account-replaced.
  const nextAccountIsNull = useRef(account === null);
  useLayoutEffect(() => {
    nextAccountIsNull.current = account === null;
  }, [account]);

  useEffect(() => {
    let active = true;
    let runtime: ManagedZeropsDataRuntime | null = null;
    let opened: AccountRuntime | null = null;
    let binding: ZeropsDataBinding | null = null;
    let disposed = false;
    let reason: "logout" | "account-replaced" = "account-replaced";
    const registry = account === null ? null : AtomRegistry.make();

    if (account === null || registry === null) {
      setValue(CLOSED);
      return () => undefined;
    }

    // Disposal can be reached from three independent races (cleanup ran
    // before the runtime resolved, cleanup ran right after it resolved, or
    // startup itself failed) — guard so the registry and runtime are only
    // ever torn down once. An account runtime that stands closes the data
    // runtime itself; one that never stood leaves only the data runtime.
    const disposeOnce = async () => {
      if (disposed) return;
      disposed = true;
      if (opened !== null) {
        await closeAccount(opened, registry, reason);
        return;
      }
      try {
        if (runtime !== null) await Effect.runPromise(runtime.shutdown(reason));
      } finally {
        registry.dispose();
      }
    };

    const scope: AccountScope = {
      account: {
        apiOrigin: makeZeropsApiOrigin(account.client.baseUrl),
        accountId: ZeropsAccountId.make(account.userId),
      },
      epoch: AccountEpoch.make(epoch.current++),
    };
    const previous = lifecycle.current;
    const creation = previous
      .catch(() => undefined)
      .then(async () => {
        if (!active) return disposeOnce();
        runtime = await runtimeFactory({ account: scope, client: account.client, registry });
        if (!active) return disposeOnce();
        const ports = await accountPorts({
          account: scope,
          client: account.client,
          onUser: account.onUser,
        });
        if (!active) return disposeOnce();
        opened = await Effect.runPromise(
          makeAccountRuntime({ ...ports, data: runtime, atomRegistry: registry }),
        );
        if (!active) return disposeOnce();
        const current: ZeropsDataBinding = { account: scope, runtime, registry };
        binding = current;
        setValue({ binding: current, environments: null, error: null });
        // The post-grant stage stands on the epoch's first grant: rows read its Mate
        // environments from then on.
        void Effect.runPromise(opened.postGrant).then(
          ({ environments }) => {
            if (!active) return;
            setValue((shown) => (shown.binding === current ? { ...shown, environments } : shown));
          },
          // An epoch that closed before its first grant never had a post-grant stage.
          () => undefined,
        );
      })
      .catch(async (cause: unknown) => {
        await disposeOnce();
        if (active) {
          setValue({
            binding: null,
            environments: null,
            error: cause instanceof Error ? cause : new Error("Could not start Zerops data."),
          });
        }
      });
    lifecycle.current = creation;

    return () => {
      active = false;
      reason = nextAccountIsNull.current ? "logout" : "account-replaced";
      setValue((current) => (current.binding === binding ? CLOSED : current));
      // Serialize replacement after the prior runtime has fenced itself. React
      // runs this cleanup before the next account effect starts.
      lifecycle.current = creation.then(() => disposeOnce());
    };
  }, [accountKey, accountPorts, client, runtimeFactory]);

  const context = useMemo(() => value, [value]);
  return <ZeropsDataContext value={context}>{children}</ZeropsDataContext>;
}

export function useZeropsData(): ZeropsDataValue {
  const value = useContext(ZeropsDataContext);
  if (value === null) throw new Error("useZeropsData must be used inside a ZeropsDataProvider.");
  return value;
}
