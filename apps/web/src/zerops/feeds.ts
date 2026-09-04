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
import {
  foldBrowserStreamEvent,
  INITIAL_BROWSER_STREAM_STATE,
} from "@t3tools/client-runtime/zerops/browserStream";
import { WS_METHODS } from "@t3tools/contracts";
import type {
  EnvironmentId,
  ThreadId,
  ZeropsAgentAuthSnapshot,
  ZeropsLifecycle,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

export interface ZeropsLifecycleTarget {
  readonly environmentId: EnvironmentId;
  readonly input: { readonly threadId: ThreadId };
}

export interface ZeropsAgentAuthTarget {
  readonly environmentId: EnvironmentId;
  readonly input: Record<string, never>;
}

export interface ZeropsBrowserStreamTarget {
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
   * `subscribeZeropsBrowserStream` interleaves state transitions and frames
   * on one stream; `transform` folds it (`foldBrowserStreamEvent`) into the
   * accumulated snapshot every consumer reads, so a reconnect's fresh
   * `no-browser`/`connecting` re-seed never has to be special-cased by a
   * caller. Unlike `lifecycle`/`agentAuth`, the RAW subscription result
   * (kept as an `AsyncResult`, not collapsed to a plain value) is exposed
   * below — a server without this method (0.2.5 and older) fails the
   * subscription outright, and the panel needs to tell that apart from a
   * successful "no-browser" state.
   */
  const browserStream = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:zerops:browserStream",
    tag: WS_METHODS.subscribeZeropsBrowserStream,
    transform: (stream) =>
      stream.pipe(
        Stream.mapAccum(
          () => INITIAL_BROWSER_STREAM_STATE,
          (state, event) => {
            const next = foldBrowserStreamEvent(state, event);
            return [next, [next]] as const;
          },
        ),
      ),
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
    browserStream,
    lifecycleValue: (target: ZeropsLifecycleTarget) => lifecycleValue(targetKey(target)),
    agentAuthValue: (target: ZeropsAgentAuthTarget) => agentAuthValue(targetKey(target)),
  };
}
