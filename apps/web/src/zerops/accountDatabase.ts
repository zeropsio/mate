/** Hosts database adapters beside the signed-in account's one store, over the Mate connection registry. */
import { useAtomValue } from "@effect/atom-react";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import {
  makeDatabaseReads,
  makeDatabaseWire,
  type AccountStore,
  type DatabaseReads,
} from "@t3tools/client-runtime/data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";
import { connectionAtomRuntime } from "../connection/runtime";
import { onAccountLifetimeClose } from "./accountLifetime";

const registryAtom = connectionAtomRuntime.atom(
  Effect.map(EnvironmentRegistry, (registry) => registry),
);
export function useAccountDatabase(store: AccountStore): DatabaseReads | null {
  const registry = Option.getOrUndefined(AsyncResult.value(useAtomValue(registryAtom)));
  const [held, setHeld] = useState<{
    readonly store: AccountStore;
    readonly registry: EnvironmentRegistry["Service"];
    readonly value: DatabaseReads;
  } | null>(null);
  useEffect(() => {
    if (registry === undefined) return;
    const made = makeDatabaseReads({ store, wire: makeDatabaseWire(registry) });
    setHeld({ store, registry, value: made });
    const endOnClose = onAccountLifetimeClose(made.close);
    return () => {
      endOnClose();
      made.close();
    };
  }, [registry, store]);
  return held?.store === store && held.registry === registry ? held.value : null;
}
