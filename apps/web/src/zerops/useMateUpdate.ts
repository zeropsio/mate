/** Surfaces read update receipts and availability from their account's store. */
import { useAtomValue } from "@effect/atom-react";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import {
  makeMateUpdates,
  makeMateUpdateWire,
  mateUpdate,
  mateUpdateStates,
  type AccountStore,
  type MateUpdateHost,
} from "@t3tools/client-runtime/data";
import type {
  EnvironmentId,
  ExecutionEnvironmentDescriptor,
  ExecutionEnvironmentUpdate,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useContext, useEffect, useMemo } from "react";
import { connectionAtomRuntime } from "../connection/runtime";
import { randomUUID } from "../lib/utils";
import { captureAccountLifetime, onAccountLifetimeClose } from "./accountLifetime";
import { AccountStoreContext } from "./ZeropsAccountData";
import { useEnvironmentContainer } from "./zeropsContainers";
import { currentAccountEnvironments } from "./accountEnvironments";
import type { MateUpdateState } from "./mateUpdate";

export type MateServer = Pick<ExecutionEnvironmentDescriptor, "serverVersion" | "bootId">;
export interface MateUpdate {
  readonly state: MateUpdateState;
  readonly checked: ExecutionEnvironmentUpdate | null | undefined;
  readonly notice?: string | undefined;
  readonly update: (to: string) => void;
  readonly check: () => Promise<ExecutionEnvironmentUpdate | null | undefined>;
}
const registryAtom = connectionAtomRuntime.atom(
  Effect.map(EnvironmentRegistry, (registry) => registry),
);
const hosts = new WeakMap<AccountStore, MateUpdateHost>();
const UNKNOWN = Atom.make({
  state: { phase: "idle" as const },
  checked: undefined,
  notice: undefined,
});
const NO_STATES = Atom.make(
  new Map<
    string,
    {
      readonly environmentId: string;
      readonly containerKey: string | null;
      readonly state: MateUpdateState;
    }
  >(),
);
export function useMateUpdate(environmentId: EnvironmentId, server: MateServer | null): MateUpdate {
  const store = useContext(AccountStoreContext);
  const registry = Option.getOrUndefined(AsyncResult.value(useAtomValue(registryAtom)));
  const container = useEnvironmentContainer(environmentId);
  const host = useMemo(() => {
    if (store === null || registry === undefined) return null;
    let held = hosts.get(store);
    if (held === undefined) {
      held = makeMateUpdates({
        store,
        wire: makeMateUpdateWire(registry),
        isCurrent: captureAccountLifetime(),
        makeId: randomUUID,
        demand: (id) => currentAccountEnvironments()?.hold(id) ?? (() => {}),
      });
      hosts.set(store, held);
      const close = held.close;
      onAccountLifetimeClose(() => {
        close();
        hosts.delete(store);
      });
    }
    return held;
  }, [store, registry]);
  const read = useAtomValue(
    store === null ? UNKNOWN : store.data.project(mateUpdate, environmentId),
  );
  const version = server?.serverVersion;
  const boot = server?.bootId;
  useEffect(() => {
    host?.observe(
      environmentId,
      version === undefined ? null : { serverVersion: version, bootId: boot },
    );
  }, [host, environmentId, version, boot]);
  return {
    ...read,
    update: (to) => {
      if (host !== null && server !== null)
        void host.update(environmentId, server, to, container.key);
    },
    check: () => host?.check(environmentId) ?? Promise.resolve(undefined),
  };
}
export function useMateUpdateStates(): {
  readonly of: (mate: {
    readonly environmentId?: EnvironmentId | undefined;
    readonly key: string;
  }) => MateUpdateState | undefined;
} {
  const store = useContext(AccountStoreContext);
  const states = useAtomValue(
    store === null ? NO_STATES : store.data.project(mateUpdateStates, null),
  );
  return useMemo(
    () => ({
      of: ({
        environmentId,
        key,
      }: {
        readonly environmentId?: EnvironmentId | undefined;
        readonly key: string;
      }) => {
        if (environmentId !== undefined) {
          const held = states.get(environmentId);
          if (held !== undefined) return held.state;
        }
        for (const entry of states.values()) if (entry.containerKey === key) return entry.state;
        return undefined;
      },
    }),
    [states],
  );
}
