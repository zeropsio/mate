import * as Effect from "effect/Effect";
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

import {
  makeAccountRuntime,
  type AccountEnvironments,
  type AccountRuntime,
} from "@t3tools/client-runtime/zerops/account/runtime";
import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  type AccountScope,
} from "@t3tools/client-runtime/zerops/data";
import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";

import { mobileAccountPorts, type MobileAccountPorts } from "./environment-ports";
import {
  makeAccountStore,
  makeZeropsWire,
  observeAccount,
  repairZeropsSession,
  type AccountObservation,
  type AccountStore,
} from "@t3tools/client-runtime/data";

import { ZeropsAccountData } from "./ZeropsAccountData";

export interface MobileZeropsDataAccount {
  readonly client: ZeropsApiClient;
  /** This is the verified Zerops principal ID, never an access token. */
  readonly userId: string;
}

export interface ZeropsDataBinding {
  readonly account: AccountScope;
  readonly registry: AtomRegistry.AtomRegistry;
  /**
   * The account's data layer over the same registry: its store's reads and its observation,
   * closed with the account before the registry goes.
   */
  readonly accountData: {
    readonly data: AccountStore["data"];
    readonly observation: AccountObservation;
  };
}

export interface ZeropsDataValue {
  readonly binding: ZeropsDataBinding | null;
  /**
   * The verified account's Mate environments; null while starting and after it closes.
   */
  readonly environments: AccountEnvironments | null;
  readonly error: Error | null;
}

/** What the account runtime reaches the platform and the device through, besides its data. */
type AccountPortsFactory = (input: {
  readonly client: ZeropsApiClient;
  readonly registry: AtomRegistry.AtomRegistry;
}) => Promise<MobileAccountPorts>;

const ZeropsDataContext = createContext<ZeropsDataValue | null>(null);

/** The account closes its Mate adapter before the account registry goes. */
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

/** Owns one store and one Mate adapter per verified account; an inactive account opens nothing. */
export function ZeropsAccountEnvironmentProvider({
  account,
  activeOrganizationId = null,
  children,
  accountPorts = mobileAccountPorts,
}: {
  readonly account: MobileZeropsDataAccount | null;
  readonly activeOrganizationId?: string | null;
  readonly children: ReactNode;
  /** Test seam; product callers reach the device and the platform through the native ports. */
  readonly accountPorts?: AccountPortsFactory;
}) {
  const [value, setValue] = useState<ZeropsDataValue>(CLOSED);
  const owner = useRef<AccountRuntime | null>(null);
  const activeOrg = useRef(activeOrganizationId);
  useEffect(() => {
    activeOrg.current = activeOrganizationId;
  }, [activeOrganizationId]);
  useEffect(() => {
    value.environments?.setActiveOrganization(activeOrganizationId);
  }, [value.environments, activeOrganizationId]);
  const lifecycle = useRef(Promise.resolve());
  const epoch = useRef(0);
  const userId = account?.userId ?? null;
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
    let opened: AccountRuntime | null = null;
    let binding: ZeropsDataBinding | null = null;
    let disposed = false;
    let reason: "logout" | "account-replaced" = "account-replaced";
    const registry = client === null || userId === null ? null : AtomRegistry.make();
    const store = registry === null ? null : makeAccountStore(registry);
    const observation =
      store === null || client === null
        ? null
        : observeAccount({
            store,
            wire: makeZeropsWire({ client }),
            repairSession: repairZeropsSession(client),
          });

    if (client === null || userId === null || registry === null) {
      setValue(CLOSED);
      return () => undefined;
    }

    // Disposal can be reached from three independent races (cleanup ran
    // before the runtime resolved, cleanup ran right after it resolved, or
    // startup itself failed) — guard so the registry and runtime are only
    // ever torn down once. Observation closes before the Mate adapter and registry.
    const disposeOnce = async () => {
      if (disposed) return;
      disposed = true;
      // The account's data ends first: what its screens still release publishes nothing.
      observation?.close();
      if (opened !== null) {
        if (owner.current === opened) owner.current = null;
        await closeAccount(opened, registry, reason);
        return;
      }
      registry.dispose();
    };

    const scope: AccountScope = {
      account: {
        apiOrigin: makeZeropsApiOrigin(client.baseUrl),
        accountId: ZeropsAccountId.make(userId),
      },
      epoch: AccountEpoch.make(epoch.current++),
    };
    const previous = lifecycle.current;
    const creation = previous
      .catch(() => undefined)
      .then(async () => {
        if (!active) return disposeOnce();
        const ports = await accountPorts({
          client,
          registry,
        });
        if (!active) return disposeOnce();
        opened = await Effect.runPromise(
          makeAccountRuntime({ ...ports, account: scope, atomRegistry: registry, store: store! }),
        );
        if (!active) return disposeOnce();
        owner.current = opened;
        const current: ZeropsDataBinding = {
          account: scope,
          registry,
          accountData: { data: store!.data, observation: observation! },
        };
        binding = current;
        setValue({ binding: current, environments: null, error: null });
        opened.environments.setActiveOrganization(activeOrg.current);
        setValue({ binding: current, environments: opened.environments, error: null });
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
  }, [userId, accountPorts, client]);

  const context = useMemo(() => value, [value]);
  return (
    <ZeropsDataContext value={context}>
      <ZeropsAccountData binding={value.binding} activeOrganizationId={activeOrganizationId}>
        {children}
      </ZeropsAccountData>
    </ZeropsDataContext>
  );
}

export function useZeropsData(): ZeropsDataValue {
  const value = useContext(ZeropsDataContext);
  if (value === null)
    throw new Error("useZeropsData must be used inside a ZeropsAccountEnvironmentProvider.");
  return value;
}
