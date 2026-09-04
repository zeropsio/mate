import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId, WS_METHODS } from "@t3tools/contracts";
import type { ZeropsAgentAuthSnapshot, ZeropsLifecycle } from "@t3tools/contracts";
import { EnvironmentRegistry, EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import { type RpcSession } from "@t3tools/client-runtime/rpc";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import { createZeropsFeedAtoms } from "./feeds";

const ENVIRONMENT_ID = EnvironmentId.make("env-zerops-1");
const THREAD_A = ThreadId.make("thread-a");
const THREAD_B = ThreadId.make("thread-b");

const lifecycleOf = (threadId: ThreadId): ZeropsLifecycle =>
  ({ threadId, recentTools: [] }) as unknown as ZeropsLifecycle;

const agentAuthSnapshot = (
  overrides?: Partial<ZeropsAgentAuthSnapshot>,
): ZeropsAgentAuthSnapshot => ({
  available: true,
  agents: [
    {
      agentId: "claude-code",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      state: "not-authorized",
      providerAuth: "unknown",
    },
  ],
  ...overrides,
});

/**
 * A registry whose session can be replaced, which is exactly what a reconnect
 * looks like from below: `subscribeDynamic` follows `supervisor.session` and
 * switch-maps onto the new one.
 *
 * Both feeds are modelled snapshot-then-changes, like the server's own
 * `subscribeBeforeSnapshot`: a subscriber gets the current state at once and
 * every later one after. A plain PubSub would drop whatever was published
 * before the stream attached, and these tests would be racing the runtime
 * rather than testing it.
 */
const makeHarness = Effect.gen(function* () {
  const calls: string[] = [];
  const lifecycleRef = yield* SubscriptionRef.make(Option.none<ZeropsLifecycle>());
  const agentAuthRef = yield* SubscriptionRef.make(Option.none<ZeropsAgentAuthSnapshot>());

  const makeSession = (): RpcSession => {
    const client = {
      [WS_METHODS.subscribeZeropsLifecycle]: (input: { readonly threadId: string }) => {
        calls.push(`lifecycle:${input.threadId}`);
        return SubscriptionRef.changes(lifecycleRef).pipe(
          Stream.filter(Option.isSome),
          Stream.map((value) => value.value),
          Stream.filter((entry) => entry.threadId === input.threadId),
        );
      },
      [WS_METHODS.subscribeZeropsAgentAuth]: () => {
        calls.push("agentAuth");
        return SubscriptionRef.changes(agentAuthRef).pipe(
          Stream.filter(Option.isSome),
          Stream.map((value) => value.value),
        );
      },
    } as unknown as RpcSession["client"];
    return {
      client,
      initialConfig: Effect.never,
      ready: Effect.void,
      probe: Effect.void,
      closed: Effect.never,
    } as unknown as RpcSession;
  };

  const session = yield* SubscriptionRef.make(Option.some(makeSession()));
  const supervisor = {
    target: { environmentId: ENVIRONMENT_ID },
    session,
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  } as unknown as EnvironmentSupervisor["Service"];

  const layer = Layer.succeed(EnvironmentRegistry, {
    run: <A, E, R>(_id: EnvironmentId, effect: Effect.Effect<A, E, R>) =>
      Effect.provideService(effect, EnvironmentSupervisor, supervisor),
    runStream: <A, E, R>(_id: EnvironmentId, stream: Stream.Stream<A, E, R>) =>
      Stream.provideService(stream, EnvironmentSupervisor, supervisor),
    // Subscription atoms go through followStream, not runStream: it is what
    // keeps a subscription attached across connection state changes.
    followStream: <A, E, R>(_id: EnvironmentId, stream: Stream.Stream<A, E, R>) =>
      Stream.provideService(stream, EnvironmentSupervisor, supervisor),
  } as unknown as EnvironmentRegistry["Service"]);

  const registry = AtomRegistry.make();
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));

  return {
    calls,
    registry,
    feeds: createZeropsFeedAtoms(Atom.runtime(layer)),
    publishLifecycle: (value: ZeropsLifecycle) =>
      SubscriptionRef.set(lifecycleRef, Option.some(value)),
    publishAgentAuth: (value: ZeropsAgentAuthSnapshot) =>
      SubscriptionRef.set(agentAuthRef, Option.some(value)),
    /** The socket dropped and came back: a brand-new client for the same environment. */
    reconnect: SubscriptionRef.set(session, Option.some(makeSession())),
  };
});

/** Waits for a condition rather than a fixed delay, so no test sleeps on a guess. */
const until = <A>(read: () => A, holds: (value: A) => boolean): Effect.Effect<A> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const value = read();
      if (holds(value)) {
        return value;
      }
      yield* Effect.sleep("5 millis");
    }
    return read();
  });

const present = <A>(value: A | undefined): boolean => value !== undefined;

describe("createZeropsFeedAtoms", () => {
  it.live("keeps two threads' lifecycles apart", () =>
    Effect.gen(function* () {
      const rig = yield* makeHarness;
      const first = rig.feeds.lifecycleValue({
        environmentId: ENVIRONMENT_ID,
        input: { threadId: THREAD_A },
      });
      const second = rig.feeds.lifecycleValue({
        environmentId: ENVIRONMENT_ID,
        input: { threadId: THREAD_B },
      });
      rig.registry.mount(first);
      rig.registry.mount(second);

      yield* rig.publishLifecycle(lifecycleOf(THREAD_A));
      const value = yield* until(() => rig.registry.get(first), present);

      expect(value?.threadId).toBe(THREAD_A);
      expect(rig.registry.get(second)).toBeUndefined();
      expect(rig.calls).toContain("lifecycle:thread-a");
      expect(rig.calls).toContain("lifecycle:thread-b");
    }).pipe(Effect.scoped),
  );

  /**
   * `available: false` means "this is not a Zerops environment" — the panel is
   * absent and nothing is wrong. It must reach the UI as a value, never as an
   * error, or a plain T3 environment would grow an error banner.
   *
   * Third feed, same shape as the lifecycle one (one per environment,
   * snapshot-typed): `createEnvironmentRpcSubscriptionAtomFamily` already
   * carries the reconnect/re-subscribe behavior generically, pinned once
   * above via the lifecycle feed — this just checks the agent-auth wiring
   * reaches it.
   */
  it.live("delivers the agent auth snapshot the server publishes", () =>
    Effect.gen(function* () {
      const rig = yield* makeHarness;
      const atom = rig.feeds.agentAuthValue({ environmentId: ENVIRONMENT_ID, input: {} });
      rig.registry.mount(atom);

      yield* rig.publishAgentAuth(agentAuthSnapshot());
      const value = yield* until(() => rig.registry.get(atom), present);

      expect(value?.agents.map((agent) => agent.agentId)).toEqual(["claude-code"]);
      expect(rig.calls).toContain("agentAuth");
    }).pipe(Effect.scoped),
  );

  it.live("passes an unavailable agent auth feed through as a value, not a failure", () =>
    Effect.gen(function* () {
      const rig = yield* makeHarness;
      const atom = rig.feeds.agentAuthValue({ environmentId: ENVIRONMENT_ID, input: {} });
      rig.registry.mount(atom);

      yield* rig.publishAgentAuth(agentAuthSnapshot({ available: false, agents: [] }));
      const value = yield* until(() => rig.registry.get(atom), present);

      expect(value?.available).toBe(false);
    }).pipe(Effect.scoped),
  );

  /**
   * The reconnect-resubscribe behavior pinned for topology up through S2 now
   * has no topology feed to exercise it on; the agent-auth subscription is
   * the same generic machinery (`createEnvironmentRpcSubscriptionAtomFamily`)
   * so this keeps that behavior covered without topology's own atom.
   */
  it.live("re-subscribes after a reconnect and takes the fresh snapshot", () =>
    Effect.gen(function* () {
      const rig = yield* makeHarness;
      const atom = rig.feeds.agentAuthValue({ environmentId: ENVIRONMENT_ID, input: {} });
      rig.registry.mount(atom);

      yield* rig.publishAgentAuth(agentAuthSnapshot());
      yield* until(() => rig.registry.get(atom), present);
      expect(rig.calls.filter((call) => call === "agentAuth")).toHaveLength(1);

      yield* rig.reconnect;
      yield* until(
        () => rig.calls.filter((call) => call === "agentAuth").length,
        (count) => count === 2,
      );
      expect(rig.calls.filter((call) => call === "agentAuth")).toHaveLength(2);

      yield* rig.publishAgentAuth(agentAuthSnapshot({ available: false, agents: [] }));
      const value = yield* until(
        () => rig.registry.get(atom),
        (snap) => snap?.available === false,
      );
      expect(value?.available).toBe(false);
    }).pipe(Effect.scoped),
  );

  /**
   * The daemon connection stays open server-side for as long as any client
   * subscriber is mounted (S8b brief: "disconnects on last unsubscribe") —
   * so this atom must drop its subscription promptly once the panel
   * unmounts, unlike `lifecycle`/`agentAuth`, which are cheap to keep warm
   * at the family's five-minute default.
   */
  it.live("keeps the browser stream's idle TTL short, unlike lifecycle's default", () =>
    Effect.gen(function* () {
      const rig = yield* makeHarness;
      const browserAtom = rig.feeds.browserStream({ environmentId: ENVIRONMENT_ID, input: {} });
      const lifecycleAtom = rig.feeds.lifecycle({
        environmentId: ENVIRONMENT_ID,
        input: { threadId: THREAD_A },
      });

      expect(browserAtom.idleTTL).toBeLessThanOrEqual(10_000);
      expect(lifecycleAtom.idleTTL).toBe(5 * 60_000);
    }).pipe(Effect.scoped),
  );
});
