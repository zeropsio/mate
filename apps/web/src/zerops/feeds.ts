/**
 * The two remaining server-fed Zerops feeds, as atoms.
 *
 * - **lifecycle** — one per thread: where the agent is, for the strip and the
 *   cards.
 * - **agentAuth** — one per environment: which agent CLIs are signed in, for
 *   the sign-in card (S7 plan D1/D3).
 *
 * Topology moved off this file (S3): the service map is now a client-side
 * projection read directly from the Zerops API (`useProjectTopology.ts`),
 * websocket-signalled by the platform's own push channel rather than a mate
 * server feed. `useZeropsTopology` (`useZeropsFeeds.ts`) is now a thin read
 * of that hook, not of an atom here.
 *
 * Both remaining feeds are read-only and *snapshot*-typed rather than
 * delta-typed: every emission is the whole state. That is what makes a
 * reconnect free — `subscribeDynamic` re-invokes the RPC on the new session
 * and the first emission is a fresh snapshot, so there is no re-`get` to
 * arrange and no accumulator that could drift. `feeds.test.ts` pins it rather
 * than assuming it.
 *
 * The factory takes its runtime so a test can supply a fake
 * `EnvironmentRegistry`; the app's instance is wired in `../state/zerops.ts`.
 * Same shape as `createPreviewEnvironmentAtoms` and its siblings.
 */
import type { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { createEnvironmentRpcSubscriptionAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";
import type {
  EnvironmentId,
  ThreadId,
  ZeropsAgentAuthSnapshot,
  ZeropsLifecycle,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

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
  const lifecycle = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:zerops:lifecycle",
    tag: WS_METHODS.subscribeZeropsLifecycle,
  });

  const agentAuth = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:zerops:agentAuth",
    tag: WS_METHODS.subscribeZeropsAgentAuth,
  });

  /**
   * Consumers below get a plain value rather than an `AsyncResult`, because
   * there is nothing they could do about a pending or failed subscription: an
   * absent feed means "no Zerops here", which a live snapshot says for itself
   * with `available: false`. A spinner or an error banner for a panel that is
   * simply not applicable would be worse than rendering nothing.
   */
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
    lifecycle,
    agentAuth,
    lifecycleValue: (target: ZeropsLifecycleTarget) => lifecycleValue(targetKey(target)),
    agentAuthValue: (target: ZeropsAgentAuthTarget) => agentAuthValue(targetKey(target)),
  };
}
