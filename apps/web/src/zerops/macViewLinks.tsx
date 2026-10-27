/** The account's demanded Mac views; the Mac tab reads their projection. */
import { useAtomValue } from "@effect/atom-react";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import {
  makeMateMacViewWire,
  mateMacView,
  startMateMacView,
  type AccountStore,
} from "@t3tools/client-runtime/data";
import type { ZeropsMacViewState } from "@t3tools/client-runtime/zerops/macView";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { connectionAtomRuntime } from "../connection/runtime";
import { onAccountLifetimeClose } from "./accountLifetime";
import { useProjection } from "./accountData";
import { makeBrowserFrameDemand } from "./browserStreamLinks";

const registryAtom = connectionAtomRuntime.atom(
  Effect.map(EnvironmentRegistry, (registry) => registry),
);
type Hold = (environmentId: EnvironmentId) => () => void;
const MacViewDemandContext = createContext<Hold | null>(null);
const UNKNOWN_VIEW = Atom.make(undefined);

/** One demand per Mate however many views show it; ending the account ends them all. */
export function MateMacViews({
  store,
  children,
}: {
  readonly store: AccountStore;
  readonly children: ReactNode;
}) {
  const registry = Option.getOrUndefined(AsyncResult.value(useAtomValue(registryAtom)));
  const host = useMemo(
    () =>
      makeBrowserFrameDemand((environmentId) =>
        registry === undefined
          ? { stop: () => {} }
          : startMateMacView({
              environmentId,
              store,
              wire: makeMateMacViewWire({ registry, environmentId }),
            }),
      ),
    [registry, store],
  );
  useEffect(() => onAccountLifetimeClose(host.close), [host]);
  return <MacViewDemandContext value={host.hold}>{children}</MacViewDemandContext>;
}

/**
 * The Mac tab's view of a Mate's paired Mac: `undefined` before it answers, `"unavailable"` where
 * this Mate cannot show one, else its state and, while live, the window.
 */
export function useMateMacView(
  environmentId: EnvironmentId | null,
): ZeropsMacViewState | "unavailable" | undefined {
  const hold = useContext(MacViewDemandContext);
  useEffect(() => {
    if (hold !== null && environmentId !== null) return hold(environmentId);
  }, [environmentId, hold]);
  return useProjection(mateMacView, environmentId, UNKNOWN_VIEW);
}
