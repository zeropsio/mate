/**
 * The three Zerops server feeds, as atoms.
 *
 * - **topology** — one per environment (a z3 environment is one Zerops
 *   project): what exists, for the service map.
 * - **lifecycle** — one per thread: where the agent is, for the strip and the
 *   cards.
 * - **agentAuth** — one per environment: which agent CLIs are signed in, for
 *   the sign-in card (S7 plan D1/D3).
 *
 * All three are read-only, and all three are *snapshot*-typed rather than
 * delta-typed: every emission is the whole state. That is what makes a
 * reconnect free — `subscribeDynamic` re-invokes the RPC on the new session
 * and the first emission is a fresh snapshot, so there is no re-`get` to
 * arrange and no accumulator that could drift. `feeds.test.ts` pins it rather
 * than assuming it.
 *
 * `agentLoginStart`/`agentLoginCancel` (S7 follow-up F8) are the one
 * exception: the two writes this file carries, driving a server-side login
 * session whose resulting `login` state rides the `agentAuth` snapshot
 * above rather than a reply of their own — see `useAgentLogin.ts`.
 *
 * The factory takes its runtime so a test can supply a fake
 * `EnvironmentRegistry`; the app's instance is wired in `../state/zerops.ts`.
 * Same shape as `createPreviewEnvironmentAtoms` and its siblings.
 */
import type { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";
import type {
  EnvironmentId,
  ThreadId,
  ZeropsAgentAuthSnapshot,
  ZeropsLifecycle,
  ZeropsTopologySnapshot,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

export interface ZeropsTopologyTarget {
  readonly environmentId: EnvironmentId;
  readonly input: Record<string, never>;
}

export interface ZeropsLifecycleTarget {
  readonly environmentId: EnvironmentId;
  readonly input: { readonly threadId: ThreadId };
}

export interface ZeropsAgentAuthTarget {
  readonly environmentId: EnvironmentId;
  readonly input: Record<string, never>;
}

const targetKey = (target: {
  readonly environmentId: EnvironmentId;
  readonly input: unknown;
}): string => JSON.stringify([target.environmentId, target.input]);

export function createZeropsFeedAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  const topology = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:zerops:topology",
    tag: WS_METHODS.subscribeZeropsTopology,
  });

  const lifecycle = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:zerops:lifecycle",
    tag: WS_METHODS.subscribeZeropsLifecycle,
  });

  const agentAuth = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:zerops:agentAuth",
    tag: WS_METHODS.subscribeZeropsAgentAuth,
  });

  /**
   * The two agent-login commands (S7 follow-up F8) — the ONLY writes in this
   * otherwise read-only file. The resulting `login` state rides the
   * `agentAuth` subscription above, not a reply from these; a caller awaits
   * only to know the RPC itself was accepted.
   */
  const agentLoginStart = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:zerops:agentLogin:start",
    tag: WS_METHODS.zeropsAgentLoginStart,
  });

  const agentLoginCancel = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:zerops:agentLogin:cancel",
    tag: WS_METHODS.zeropsAgentLoginCancel,
  });

  /**
   * Consumers below get a plain value rather than an `AsyncResult`, because
   * there is nothing they could do about a pending or failed subscription: an
   * absent feed means "no Zerops here", which a live snapshot says for itself
   * with `available: false`. A spinner or an error banner for a panel that is
   * simply not applicable would be worse than rendering nothing.
   */
  const topologyValue = Atom.family((key: string) => {
    const [environmentId, input] = JSON.parse(key) as [EnvironmentId, Record<string, never>];
    return Atom.make((get): ZeropsTopologySnapshot | undefined =>
      Option.getOrUndefined(AsyncResult.value(get(topology({ environmentId, input })))),
    ).pipe(Atom.withLabel(`zerops:topology-value:${key}`));
  });

  const lifecycleValue = Atom.family((key: string) => {
    const [environmentId, input] = JSON.parse(key) as [
      EnvironmentId,
      { readonly threadId: ThreadId },
    ];
    return Atom.make((get): ZeropsLifecycle | undefined =>
      Option.getOrUndefined(AsyncResult.value(get(lifecycle({ environmentId, input })))),
    ).pipe(Atom.withLabel(`zerops:lifecycle-value:${key}`));
  });

  const agentAuthValue = Atom.family((key: string) => {
    const [environmentId, input] = JSON.parse(key) as [EnvironmentId, Record<string, never>];
    return Atom.make((get): ZeropsAgentAuthSnapshot | undefined =>
      Option.getOrUndefined(AsyncResult.value(get(agentAuth({ environmentId, input })))),
    ).pipe(Atom.withLabel(`zerops:agentAuth-value:${key}`));
  });

  return {
    topology,
    lifecycle,
    agentAuth,
    agentLoginStart,
    agentLoginCancel,
    topologyValue: (target: ZeropsTopologyTarget) => topologyValue(targetKey(target)),
    lifecycleValue: (target: ZeropsLifecycleTarget) => lifecycleValue(targetKey(target)),
    agentAuthValue: (target: ZeropsAgentAuthTarget) => agentAuthValue(targetKey(target)),
  };
}

export type ZeropsFeedAtoms = ReturnType<typeof createZeropsFeedAtoms>;
