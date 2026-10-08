/** Runs P4 source adapters against the signed-in account's one store. */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import {
  makeVcsReads,
  makeVcsWire,
  makeWorkspaceReads,
  makeWorkspaceWire,
  makeFileWrites,
  fileWriteWire,
  makeWorkspaceActions,
  makeWorkspaceMutationWire,
  type AccountStore,
} from "@t3tools/client-runtime/data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useContext, useEffect } from "react";
import { randomUUID } from "../lib/utils";
import { connectionAtomRuntime } from "../connection/runtime";
import { workspaceHostAtom } from "../state/workspace";
import { onAccountLifetimeClose } from "./accountLifetime";
const registryAtom = connectionAtomRuntime.atom(
  Effect.map(EnvironmentRegistry, (registry) => registry),
);
export function useAccountWorkspace(store: AccountStore) {
  const atoms = useContext(RegistryContext);
  const connection = Option.getOrUndefined(AsyncResult.value(useAtomValue(registryAtom)));
  useEffect(() => {
    if (connection === undefined) return;
    const reads = makeWorkspaceReads(store, makeWorkspaceWire(connection));
    let active = true;
    const vcs = makeVcsReads(store, makeVcsWire(connection));
    const host = {
      vcs,
      data: store.data,
      reads,
      act: makeWorkspaceActions({
        store,
        wire: makeWorkspaceMutationWire(connection),
        mcpAnswer: reads.mcpAnswer,
        invalidateRefs: reads.invalidateRefs,
        current: () => active,
        makeId: randomUUID,
      }),
      writeFile: makeFileWrites({
        store,
        reads,
        write: fileWriteWire(connection),
        current: () => active,
        makeId: randomUUID,
      }),
    };
    atoms.set(workspaceHostAtom, host);
    const close = () => {
      active = false;
      reads.close();
      vcs.close();
      if (atoms.get(workspaceHostAtom) === host) atoms.set(workspaceHostAtom, null);
    };
    const unlisten = onAccountLifetimeClose(close);
    return () => {
      unlisten();
      close();
    };
  }, [atoms, connection, store]);
}
