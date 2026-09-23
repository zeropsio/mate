/**
 * The two remaining server-fed Zerops feeds, as atoms.
 *
 * - **lifecycle** — one per thread: where the agent is, for the strip and the
 *   cards.
 * - **agentAuth** — one per environment: which agent CLIs are signed in, for
 *   the sign-in card (S7 plan D1/D3).
 *
 * Both reach a consumer as `Known` (DESIGN §2.C C12–C13): `reading` until the
 * first frame, `stale` with the value kept while the Mate is disconnected,
 * and `failed(unsupported)` on an old Mate without the RPC. Each session asks
 * once and nothing retries within it; a new session's ask to an old Mate
 * keeps that failure rather than reading again (`foldMateFeed`).
 *
 * Topology moved off this file (S3): the service map is now a client-side
 * projection read directly from the Zerops API (`useProjectTopology.ts`),
 * websocket-signalled by the platform's own push channel rather than a mate
 * server feed. `useZeropsTopology` (`useZeropsFeeds.ts`) is now a thin read
 * of that hook, not of an atom here.
 *
 * Both feeds are read-only and *snapshot*-typed rather than delta-typed:
 * every emission is the whole state. That is what makes a reconnect free —
 * the RPC is asked again on the new session and its first emission is a
 * fresh snapshot, so there is no re-`get` to arrange and no accumulator that
 * could drift. `feeds.test.ts` pins it rather than assuming it.
 *
 * The factory takes its runtime so a test can supply a fake
 * `EnvironmentRegistry`; the app's instance is wired in `../state/zerops.ts`.
 * Same shape as `createPreviewEnvironmentAtoms` and its siblings.
 */
import {
  EnvironmentSupervisor,
  type EnvironmentRegistry,
} from "@t3tools/client-runtime/connection";
import { subscribe } from "@t3tools/client-runtime/rpc";
import {
  createEnvironmentRpcSubscriptionAtomFamily,
  followStreamInEnvironment,
} from "@t3tools/client-runtime/state/runtime";
import {
  foldBrowserStreamEvent,
  INITIAL_BROWSER_STREAM_STATE,
} from "@t3tools/client-runtime/zerops/browserStream";
import {
  foldDataConsoleSessionEvent,
  INITIAL_DATA_CONSOLE_STATE,
} from "@t3tools/client-runtime/zerops/dataConsole";
import {
  foldMateFeed,
  mateFeed,
  mateFeedKnown,
  type FailureReason,
  type Known,
  type MateFeedEvent,
} from "@t3tools/client-runtime/zerops/knowledge";
import { EnvironmentAuthorizationError, WS_METHODS } from "@t3tools/contracts";
import type {
  EnvironmentId,
  ThreadId,
  ZeropsAgentAuthSnapshot,
  ZeropsLifecycle,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
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

export interface ZeropsDataConsoleTarget {
  readonly environmentId: EnvironmentId;
  readonly input: Record<string, never>;
}

const targetKey = (target: {
  readonly environmentId: EnvironmentId;
  readonly input: unknown;
}): string => JSON.stringify([target.environmentId, target.input]);

/** What an older server answers for a method it does not have (effect `RpcServer`). */
const UNKNOWN_REQUEST_TAG = "Unknown request tag";

const isEnvironmentAuthorizationError = Schema.is(EnvironmentAuthorizationError);

const defectMessage = (defect: unknown): string =>
  typeof defect === "string" ? defect : defect instanceof Error ? defect.message : String(defect);

/**
 * Why an ask failed. A lost transport never gets here: `subscribe` waits for
 * the next session instead, and the session going away is the disconnect.
 */
function feedFailure(capability: string, cause: Cause.Cause<unknown>): FailureReason {
  for (const reason of cause.reasons) {
    if (Cause.isDieReason(reason) && defectMessage(reason.defect).startsWith(UNKNOWN_REQUEST_TAG)) {
      return { kind: "unsupported", capability };
    }
    if (Cause.isFailReason(reason) && isEnvironmentAuthorizationError(reason.error)) {
      return { kind: "refused", code: reason.error._tag, words: reason.error.message };
    }
  }
  return { kind: "transport", detail: defectMessage(Cause.squash(cause)) };
}

/**
 * One feed's knowledge per target. The session decides what the feed can
 * know: none is a disconnect; each session asks once, and that session's
 * frames or its failure follow the ask. The fold outlives every session, so
 * a value survives the disconnect that makes it stale.
 */
function createKnownFeedFamily<R, E, Input, A>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  options: {
    readonly label: string;
    readonly capability: string;
    readonly subscribe: (input: Input) => Stream.Stream<A, unknown, EnvironmentSupervisor>;
  },
) {
  const at = (event: (atMs: number) => MateFeedEvent<A>) =>
    Effect.map(Clock.currentTimeMillis, event);

  const ask = (input: Input): Stream.Stream<MateFeedEvent<A>, never, EnvironmentSupervisor> =>
    Stream.concat(
      Stream.fromEffect(at((atMs) => ({ kind: "asked", atMs }))),
      options.subscribe(input).pipe(
        Stream.mapEffect((value) => at((atMs) => ({ kind: "frame", value, atMs }))),
        Stream.catchCause((cause) =>
          Stream.fromEffect(
            at((atMs) => ({
              kind: "failed",
              failure: feedFailure(options.capability, cause),
              atMs,
            })),
          ),
        ),
      ),
    );

  const events = (environmentId: EnvironmentId, input: Input) =>
    followStreamInEnvironment(
      environmentId,
      Stream.unwrap(
        Effect.map(EnvironmentSupervisor, (supervisor) =>
          SubscriptionRef.changes(supervisor.session).pipe(
            Stream.switchMap(
              Option.match({
                onNone: () => Stream.fromEffect(at((atMs) => ({ kind: "disconnected", atMs }))),
                onSome: () => ask(input),
              }),
            ),
          ),
        ),
      ),
    ).pipe(Stream.scan(mateFeed<A>(), foldMateFeed));

  const folded = Atom.family((key: string) => {
    const [environmentId, input] = JSON.parse(key) as [EnvironmentId, Input];
    return runtime
      .atom(events(environmentId, input))
      .pipe(Atom.setIdleTTL(5 * 60_000), Atom.withLabel(`${options.label}:${key}`));
  });

  const known = Atom.family((key: string) =>
    Atom.make((get): Known<A> =>
      mateFeedKnown(Option.getOrElse(AsyncResult.value(get(folded(key))), () => mateFeed<A>())),
    ).pipe(Atom.withLabel(`${options.label}:known:${key}`)),
  );

  return (target: { readonly environmentId: EnvironmentId; readonly input: Input }) =>
    known(targetKey(target));
}

export function createZeropsFeedAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  const lifecycle = createKnownFeedFamily(runtime, {
    label: "environment-data:zerops:lifecycle",
    capability: WS_METHODS.subscribeZeropsLifecycle,
    subscribe: (
      input: ZeropsLifecycleTarget["input"],
    ): Stream.Stream<ZeropsLifecycle, unknown, EnvironmentSupervisor> =>
      subscribe(WS_METHODS.subscribeZeropsLifecycle, input),
  });

  const agentAuth = createKnownFeedFamily(runtime, {
    label: "environment-data:zerops:agentAuth",
    capability: WS_METHODS.subscribeZeropsAgentAuth,
    subscribe: (
      input: ZeropsAgentAuthTarget["input"],
    ): Stream.Stream<ZeropsAgentAuthSnapshot, unknown, EnvironmentSupervisor> =>
      subscribe(WS_METHODS.subscribeZeropsAgentAuth, input),
  });

  /**
   * `subscribeZeropsBrowserStream` interleaves state transitions and frames
   * on one stream; `transform` folds it (`foldBrowserStreamEvent`) into the
   * accumulated snapshot every consumer reads, so a reconnect's fresh
   * `no-browser`/`connecting` re-seed never has to be special-cased by a
   * caller. The raw subscription result (an `AsyncResult`) is exposed — a
   * server without this method (0.2.5 and older) fails the subscription
   * outright, and the panel needs to tell that apart from a successful
   * "no-browser" state.
   *
   * `idleTtlMs` is a few seconds, not the family default of five minutes:
   * the server keeps the daemon connection open for as long as ANY
   * subscriber is attached, so leaving this atom mounted at the default TTL
   * would hold that connection open for minutes after the viewer has
   * navigated away from the panel.
   */
  const browserStream = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:zerops:browserStream",
    tag: WS_METHODS.subscribeZeropsBrowserStream,
    idleTtlMs: 5_000,
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
   * `subscribeZeropsDataConsole` (spec-dataconsole.md §4.3): the console
   * child process's own lifecycle, folded the same way as `browserStream`
   * (`foldDataConsoleSessionEvent`) so a reconnect's fresh `idle`/`starting`
   * re-seed is never special-cased by a caller. `idleTtlMs` matches
   * `browserStream` for the same reason — the server only keeps the console
   * process warm while a subscriber is attached, so the family default
   * (five minutes) would hold it open long after the panel closed.
   */
  const dataConsole = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:zerops:dataConsole",
    tag: WS_METHODS.subscribeZeropsDataConsole,
    idleTtlMs: 5_000,
    transform: (stream) =>
      stream.pipe(
        Stream.mapAccum(
          () => INITIAL_DATA_CONSOLE_STATE,
          (state, event) => {
            const next = foldDataConsoleSessionEvent(state, event);
            return [next, [next]] as const;
          },
        ),
      ),
  });

  return { lifecycle, agentAuth, browserStream, dataConsole };
}
