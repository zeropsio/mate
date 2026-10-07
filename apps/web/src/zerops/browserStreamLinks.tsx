/** The account's demanded browser adapters; cards and the panel read their projections. */
import { useAtomValue } from "@effect/atom-react";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import {
  makeMateBrowserFrameWire,
  mateBrowserFrame,
  mateBrowserFrames,
  mateBrowserStream,
  startMateBrowserFrames,
  UNKNOWN_BROWSER_FRAME,
  type AccountStore,
  type MateBrowserFrameRead,
} from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { connectionAtomRuntime } from "../connection/runtime";
import { onAccountLifetimeClose } from "./accountLifetime";
import { useProjection } from "./ZeropsAccountData";

const registryAtom = connectionAtomRuntime.atom(
  Effect.map(EnvironmentRegistry, (registry) => registry),
);
type Hold = (environmentId: EnvironmentId) => () => void;
const BrowserDemandContext = createContext<Hold | null>(null);
const UNKNOWN_FRAME = Atom.make(UNKNOWN_BROWSER_FRAME);
const UNKNOWN_STREAM = Atom.make(undefined);
const UNKNOWN_FRAMES = Atom.make<ReadonlyArray<MateBrowserFrameRead>>([]);
/** Multiple views share one demand; ending its account prevents a late mount from reopening it. */
export function makeBrowserFrameDemand(
  start: (environmentId: EnvironmentId) => { readonly stop: () => void },
) {
  const held = new Map<EnvironmentId, { count: number; stop: () => void }>();
  let closed = false;
  return {
    hold(environmentId: EnvironmentId) {
      if (closed) return () => {};
      let entry = held.get(environmentId);
      if (entry === undefined) {
        entry = { count: 0, ...start(environmentId) };
        held.set(environmentId, entry);
      }
      entry.count++;
      let released = false;
      return () => {
        if (released || closed) return;
        released = true;
        entry.count--;
        if (entry.count === 0) {
          entry.stop();
          held.delete(environmentId);
        }
      };
    },
    close() {
      closed = true;
      for (const entry of held.values()) entry.stop();
      held.clear();
    },
  };
}
export function MateBrowserFrames({
  store,
  children,
}: {
  readonly store: AccountStore;
  readonly children: ReactNode;
}) {
  const registry = Option.getOrUndefined(AsyncResult.value(useAtomValue(registryAtom)));
  const host = useMemo(() => {
    return makeBrowserFrameDemand((environmentId) =>
      registry === undefined
        ? { stop: () => {} }
        : startMateBrowserFrames({
            environmentId,
            store,
            wire: makeMateBrowserFrameWire({ registry, environmentId }),
          }),
    );
  }, [registry, store]);
  useEffect(() => onAccountLifetimeClose(host.close), [host]);
  // View cleanup releases its holds; only the account ends this host permanently.
  return <BrowserDemandContext value={host.hold}>{children}</BrowserDemandContext>;
}
function useBrowserDemand(environmentId: EnvironmentId | null): void {
  const hold = useContext(BrowserDemandContext);
  useEffect(() => {
    if (hold !== null && environmentId !== null) return hold(environmentId);
  }, [environmentId, hold]);
}
export function useMateBrowserStream(environmentId: EnvironmentId | null) {
  useBrowserDemand(environmentId);
  return useProjection(mateBrowserStream, environmentId, UNKNOWN_STREAM);
}
export function useMateBrowserCallFrame(
  environmentId: EnvironmentId | null,
  callId: string | null,
  live: boolean,
  threadId: string | null,
  turnId: string | null,
): MateBrowserFrameRead {
  useBrowserDemand(live ? environmentId : null);
  return useProjection(
    mateBrowserFrame,
    environmentId === null || callId === null || threadId === null || turnId === null
      ? null
      : { environmentId, threadId, turnId, callId },
    UNKNOWN_FRAME,
  );
}

/** The chat's browser strip shares the card's account demand and call identity. */
export function useMateBrowserCallFrames(
  environmentId: EnvironmentId | null,
  threadId: string | null,
  calls: ReadonlyArray<{ readonly callId: string | null; readonly turnId: string | null }>,
  live: boolean,
): ReadonlyArray<MateBrowserFrameRead> {
  useBrowserDemand(live ? environmentId : null);
  return useProjection(
    mateBrowserFrames,
    environmentId === null || threadId === null ? null : { environmentId, threadId, calls },
    UNKNOWN_FRAMES,
  );
}
