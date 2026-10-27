import { useAtomValue } from "@effect/atom-react";
import type { AccountStore } from "@t3tools/client-runtime/data";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, type AtomRegistry } from "effect/reactivity";
import { useEffect, type ReactNode } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { uuidv4 } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { mountMateEngineHost } from "./mateEngineHost";

const connectionAtom = connectionAtomRuntime.atom(Effect.service(EnvironmentRegistry));

/** Mounts the account's engine conversations while the account is open. */
export function MateEngineHost({
  store,
  registry,
  children,
}: {
  readonly store: AccountStore;
  readonly registry: AtomRegistry.AtomRegistry;
  readonly children: ReactNode;
}) {
  const connection = Option.getOrNull(AsyncResult.value(useAtomValue(connectionAtom)));
  useEffect(
    () =>
      connection === null
        ? undefined
        : mountMateEngineHost({
            app: appAtomRegistry,
            atoms: registry,
            store,
            connection,
            makeId: uuidv4,
          }),
    [connection, registry, store],
  );
  return children;
}
