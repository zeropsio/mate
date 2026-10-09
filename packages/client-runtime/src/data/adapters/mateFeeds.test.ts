import * as Cause from "effect/Cause";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentScopeRequiredError,
  WS_METHODS,
  type ServerConfig,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Option from "effect/Option";
import { EnvironmentSupervisor } from "../../connection/supervisor.ts";
import type { EnvironmentRegistry } from "../../connection/registry.ts";
import type { RpcSession } from "../../rpc/session.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Fiber from "effect/Fiber";
import type { StreamFault } from "../streamMachine.ts";
import {
  mateFeedReadsAtom,
  mateFeedAsyncAtom,
  retainedMateFeedAtom,
  readMateFeed,
} from "../mateFeedReads.ts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { mateFeedScope, type MateFeedKey } from "../families/mateFeeds.ts";
import { mateFeed } from "../projections/mateFeeds.ts";
import { readsOfState, makeAccountStore } from "../store.ts";
import { settle } from "../__fixtures__/zeropsWire.ts";
import {
  makeMateFeeds,
  makeMateFeedWire,
  classifyMateFeedFailure,
  crewFrameMark,
  isNewerCrewFrame,
  type MateFeedEvent,
} from "./mateFeeds.ts";
const auth = { available: true, agents: [] } as const;
const key: MateFeedKey<"mateAgentAuth"> = {
  family: "mateAgentAuth",
  environmentId: "mate",
  input: {},
};
const rig = () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const read = () => mateFeed("mateAgentAuth").derive(readsOfState(store.state()), key);
  return {
    store,
    registry,
    read,
    close: () => {
      store.close();
      registry.dispose();
    },
  };
};
describe("account-owned Mate feeds", () => {
  it.live("reads until the first frame, never an empty value, and shares detail demand", () =>
    Effect.gen(function* () {
      const r = rig();
      let opens = 0;
      const events = yield* SubscriptionRef.make<MateFeedEvent>({ kind: "session" });
      const feeds = makeMateFeeds({
        store: r.store,
        wire: {
          open: () =>
            Stream.unwrap(
              Effect.sync(() => {
                opens++;
                return SubscriptionRef.changes(events);
              }),
            ),
        },
      });
      const release = feeds.hold(key);
      const release2 = feeds.hold(key);
      yield* settle;
      expect(r.read().state).toBe("reading");
      yield* SubscriptionRef.set(events, { kind: "value", value: auth });
      yield* settle;
      expect(r.read()).toMatchObject({
        state: "known",
        value: auth,
        coverage: "complete",
        freshness: { kind: "live" },
      });
      expect(opens).toBe(1);
      release();
      expect(r.read().state).toBe("known");
      release2();
      const remount = feeds.hold(key);
      yield* settle;
      expect(r.read().state).toBe("known");
      remount();
      feeds.close();
      r.close();
    }),
  );
  it.live("a disconnected feed keeps its value as stale", () =>
    Effect.gen(function* () {
      const r = rig();
      const wire = {
        open: () =>
          Stream.concat(
            Stream.make<readonly MateFeedEvent[]>(
              { kind: "session" },
              { kind: "value", value: auth },
            ),
            Stream.fail({ outcome: "transient" as const, message: "offline" }),
          ),
      };
      const feeds = makeMateFeeds({ store: r.store, wire });
      feeds.hold(key);
      yield* settle;
      expect(r.read()).toMatchObject({
        state: "known",
        value: auth,
        freshness: {
          kind: "stale",
          reason: {
            kind: "revalidation-failed",
            failure: { kind: "transport", detail: "offline" },
          },
        },
      });
      feeds.close();
      r.close();
    }),
  );
  it.live("a definitive refusal survives remount and session rotation until explicit retry", () =>
    Effect.gen(function* () {
      const r = rig();
      let opens = 0;
      const feeds = makeMateFeeds({
        store: r.store,
        wire: {
          open: () =>
            Stream.unwrap(
              Effect.sync(() => {
                opens++;
                return Stream.fail({
                  outcome: "definitive-refusal" as const,
                  message: "not allowed",
                });
              }),
            ),
        },
      });
      const release = feeds.hold(key);
      yield* settle;
      release();
      const release2 = feeds.hold(key);
      yield* settle;
      expect(opens).toBe(1);
      expect(r.read()).toMatchObject({ state: "failed", retryAtMs: null });
      feeds.retry(key);
      yield* settle;
      expect(opens).toBe(2);
      release2();
      feeds.close();
      r.close();
    }),
  );
  it.live(
    "an old Mate without the RPC is failed(unsupported) and never retried automatically",
    () =>
      Effect.gen(function* () {
        const r = rig();
        const feeds = makeMateFeeds({
          store: r.store,
          wire: {
            open: () =>
              Stream.fail({
                outcome: "definitive-refusal",
                code: "unsupported",
                message: "agentAuth",
              }),
          },
        });
        feeds.hold(key);
        yield* settle;
        expect(r.read()).toMatchObject({
          state: "failed",
          failure: { kind: "unsupported", capability: "agentAuth" },
          retryAtMs: null,
        });
        feeds.close();
        r.close();
      }),
  );
  it.live("passes an unavailable agent auth feed through as a value, not a failure", () =>
    Effect.gen(function* () {
      const r = rig();
      const unavailable = { available: false, agents: [] };
      const feeds = makeMateFeeds({
        store: r.store,
        wire: {
          open: () =>
            Stream.concat(
              Stream.make<readonly MateFeedEvent[]>(
                { kind: "session" },
                { kind: "value", value: unavailable },
              ),
              Stream.never,
            ),
        },
      });
      feeds.hold(key);
      yield* settle;
      expect(r.read()).toMatchObject({ state: "known", value: unavailable });
      feeds.close();
      r.close();
    }),
  );
  it.live("account closure fences late frames and prevents new demand", () =>
    Effect.gen(function* () {
      const r = rig();
      let opens = 0;
      const feeds = makeMateFeeds({
        store: r.store,
        wire: {
          open: () => {
            opens++;
            return Stream.never;
          },
        },
      });
      feeds.hold(key);
      yield* settle;
      feeds.close();
      const prior = r.store.state();
      feeds.hold(key);
      yield* settle;
      expect(opens).toBe(1);
      expect(r.store.state()).toBe(prior);
      r.close();
    }),
  );
  it.live("refreshing sampled files shares demand and waits for the new owner answer", () =>
    Effect.gen(function* () {
      const r = rig();
      const filesKey = { family: "mateCrewFiles", environmentId: "mate", input: {} } as const;
      let opens = 0;
      const feeds = makeMateFeeds({
        store: r.store,
        wire: {
          open: () => {
            opens++;
            return Stream.make<readonly MateFeedEvent[]>(
              { kind: "session" },
              { kind: "value", value: { files: [{ path: "crew.yaml", content: String(opens) }] } },
            );
          },
        },
      });
      r.registry.set(mateFeedReadsAtom, { data: r.store.data, ...feeds });
      feeds.hold(filesKey);
      yield* settle;
      const refreshed = yield* readMateFeed(r.registry, filesKey);
      expect(refreshed).toEqual({ files: [{ path: "crew.yaml", content: "2" }] });
      expect(opens).toBe(2);
      feeds.close();
      r.close();
    }),
  );
  it.live("a read waiting on a Mate ends when its account closes", () =>
    Effect.gen(function* () {
      const r = rig();
      const feeds = makeMateFeeds({ store: r.store, wire: { open: () => Stream.never } });
      r.registry.set(mateFeedReadsAtom, { data: r.store.data, ...feeds });
      const read = yield* Effect.forkChild(
        Effect.result(
          readMateFeed(r.registry, { family: "mateCrewFiles", environmentId: "mate", input: {} }),
        ),
      );
      yield* settle;
      feeds.close();
      const result = yield* Fiber.join(read);
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { message: "This account has closed." },
      });
      r.close();
    }),
  );
  it.live("access loss withholds retained facts and verified access permits a fresh remount", () =>
    Effect.gen(function* () {
      const r = rig();
      let access = (_fault: StreamFault | null) => {};
      const feeds = makeMateFeeds({
        store: r.store,
        wire: {
          watch: (_environmentId, receive) => {
            access = receive;
            return Effect.never;
          },
          open: () =>
            Stream.concat(
              Stream.make<readonly MateFeedEvent[]>(
                { kind: "session" },
                { kind: "value", value: auth },
              ),
              Stream.never,
            ),
        },
      });
      r.registry.set(mateFeedReadsAtom, { data: r.store.data, ...feeds });
      const retained = retainedMateFeedAtom(key);
      const release = feeds.hold(key);
      yield* settle;
      release();
      access({ outcome: "access-unverified", message: "Verify access again." });
      expect(r.read()).toMatchObject({ state: "failed", failure: { kind: "refused" } });
      expect(r.registry.get(retained).evidence?.fact).toEqual({
        kind: "withheld",
        reason: "unverified",
      });
      expect(r.registry.get(retained)).not.toHaveProperty("evidence.fact.value");
      access(null);
      feeds.hold(key);
      yield* settle;
      expect(r.read()).toMatchObject({ state: "known", value: auth, freshness: { kind: "live" } });
      expect(r.registry.get(retained).evidence?.fact).toMatchObject({
        kind: "known",
        value: { snapshot: auth },
      });
      feeds.close();
      r.close();
    }),
  );
  it.live("an owner read denial withdraws retained content until a fresh authorized answer", () =>
    Effect.gen(function* () {
      const r = rig();
      const denied = yield* SubscriptionRef.make(false);
      const feeds = makeMateFeeds({
        store: r.store,
        wire: {
          open: () =>
            SubscriptionRef.changes(denied).pipe(
              Stream.flatMap((refused) =>
                refused
                  ? Stream.fail<StreamFault>({
                      outcome: "authoritative-denial",
                      message: "Read access was removed.",
                    })
                  : Stream.make<readonly MateFeedEvent[]>(
                      { kind: "session" },
                      { kind: "value", value: auth },
                    ),
              ),
            ),
        },
      });
      const release = feeds.hold(key);
      yield* settle;
      expect(r.read().state).toBe("known");
      yield* SubscriptionRef.set(denied, true);
      yield* settle;
      expect(r.read()).toMatchObject({ state: "failed", failure: { kind: "refused" } });
      release();
      const remount = feeds.hold(key);
      yield* settle;
      expect(r.read().state).toBe("failed");
      yield* SubscriptionRef.set(denied, false);
      feeds.retry(key);
      yield* settle;
      expect(r.read()).toMatchObject({ state: "known", value: auth, freshness: { kind: "live" } });
      remount();
      feeds.close();
      r.close();
    }),
  );
});

it.live(
  "configuration starts unknown, retains its prior answer during rotation, and becomes current only from the new owner",
  () =>
    Effect.gen(function* () {
      const r = rig();
      const first = yield* Deferred.make<ServerConfig>();
      const second = yield* Deferred.make<ServerConfig>();
      const session = (initialConfig: Effect.Effect<ServerConfig>): RpcSession =>
        ({
          initialConfig,
          client: { [WS_METHODS.subscribeServerConfig]: () => Stream.never },
        }) as unknown as RpcSession;
      const sessions = yield* SubscriptionRef.make(Option.none<RpcSession>());
      const supervisor = { session: sessions } as unknown as EnvironmentSupervisor["Service"];
      const registry = {
        followStream: <A, E, R>(_environmentId: string, stream: Stream.Stream<A, E, R>) =>
          Stream.provideService(stream, EnvironmentSupervisor, supervisor),
        stateChanges: () => Stream.never,
      } as unknown as EnvironmentRegistry["Service"];
      const feeds = makeMateFeeds({ store: r.store, wire: makeMateFeedWire(registry) });
      const configKey: MateFeedKey<"mateServerConfig"> = {
        family: "mateServerConfig",
        environmentId: "mate",
        input: {},
      };
      const read = () =>
        mateFeed("mateServerConfig").derive(readsOfState(r.store.state()), configKey);
      const config = (cwd: string) =>
        ({
          settings: DEFAULT_SERVER_SETTINGS,
          environment: { serverVersion: "0.0.1", capabilities: {} },
          cwd,
        }) as ServerConfig;
      r.registry.set(mateFeedReadsAtom, { ...feeds, data: r.store.data });
      const binding = mateFeedAsyncAtom(configKey);
      const releaseBinding = r.registry.subscribe(binding, () => {}, { immediate: true });
      const release = feeds.hold(configKey);
      yield* settle;
      expect(read().state).not.toBe("known");
      yield* SubscriptionRef.set(sessions, Option.some(session(Deferred.await(first))));
      yield* settle;
      expect(read().state).toBe("reading");
      yield* Deferred.succeed(first, config("/first"));
      yield* settle;
      expect(read()).toMatchObject({
        state: "known",
        coverage: "complete",
        freshness: { kind: "live" },
        value: { config: { cwd: "/first" } },
      });
      expect(r.registry.get(binding)).toMatchObject({ _tag: "Success", waiting: false });
      yield* SubscriptionRef.set(sessions, Option.none());
      yield* settle;
      expect(read()).toMatchObject({
        state: "known",
        freshness: { kind: "stale" },
        value: { config: { cwd: "/first" } },
      });
      expect(r.registry.get(binding)).toMatchObject({
        _tag: "Success",
        waiting: true,
        read: { freshness: { kind: "stale" }, evidence: { stream: { fault: null } } },
      });
      yield* SubscriptionRef.set(sessions, Option.some(session(Deferred.await(second))));
      yield* settle;
      expect(read()).toMatchObject({
        state: "known",
        freshness: { kind: "revalidating" },
        value: { config: { cwd: "/first" } },
      });
      expect(r.registry.get(binding)).toMatchObject({
        _tag: "Success",
        waiting: true,
        value: { config: { cwd: "/first" } },
      });
      yield* Deferred.succeed(second, config("/second"));
      yield* settle;
      expect(read()).toMatchObject({
        state: "known",
        freshness: { kind: "live" },
        value: { config: { cwd: "/second" } },
      });
      expect(r.registry.get(binding)).toMatchObject({
        _tag: "Success",
        waiting: false,
        value: { config: { cwd: "/second" } },
      });
      releaseBinding();
      release();
      feeds.close();
      r.close();
    }),
);

it("a session HTTP scope refusal withdraws protected content rather than retrying as an outage", () => {
  const fault = classifyMateFeedFailure(
    Cause.fail(
      new EnvironmentScopeRequiredError({
        code: "insufficient_scope",
        requiredScope: "orchestration:read",
        traceId: "trace",
      }),
    ),
  );
  expect(fault.outcome).toBe("authoritative-denial");
});

it.live(
  "an owner credential refusal waits for connection verification and a fresh answer before restoring content",
  () =>
    Effect.gen(function* () {
      const r = rig();
      let opens = 0;
      let access: (fault: StreamFault | null) => void = () => {};
      const fresh = yield* Deferred.make<typeof auth>();
      const feeds = makeMateFeeds({
        store: r.store,
        wire: {
          watch: (_id, receive) =>
            Effect.sync(() => {
              access = receive;
            }),
          open: () => {
            opens++;
            return opens === 1
              ? Stream.concat(
                  Stream.make<readonly MateFeedEvent[]>(
                    { kind: "session" },
                    { kind: "value", value: auth },
                  ),
                  Stream.fail<StreamFault>({
                    outcome: "access-unverified",
                    message: "Session expired.",
                  }),
                )
              : Stream.concat(
                  Stream.make({ kind: "session" } as const),
                  Stream.fromEffect(Deferred.await(fresh)).pipe(
                    Stream.map((value) => ({ kind: "value" as const, value })),
                    Stream.concat(Stream.never),
                  ),
                );
          },
        },
      });
      const release = feeds.hold(key);
      yield* settle;
      expect(r.read()).toMatchObject({ state: "failed", failure: { kind: "refused" } });
      expect(opens).toBe(1);
      access(null);
      yield* settle;
      expect(opens).toBe(2);
      expect(r.read().state).toBe("failed");
      yield* Deferred.succeed(fresh, auth);
      yield* settle;
      expect(r.read()).toMatchObject({ state: "known", value: auth, freshness: { kind: "live" } });
      release();
      feeds.close();
      r.close();
    }),
);

it.live(
  "a refused subscription keeps the last answer visible with a failure and an enabled retry",
  () =>
    Effect.gen(function* () {
      const r = rig();
      const refused = yield* Deferred.make<never, StreamFault>();
      let opens = 0;
      const feeds = makeMateFeeds({
        store: r.store,
        wire: {
          open: () =>
            Stream.concat(
              Stream.make<readonly MateFeedEvent[]>(
                { kind: "session" },
                { kind: "value", value: auth },
              ),
              ++opens === 1 ? Stream.fromEffect(Deferred.await(refused)) : Stream.never,
            ),
        },
      });
      r.registry.set(mateFeedReadsAtom, { ...feeds, data: r.store.data });
      const reading = mateFeedAsyncAtom(key);
      const release = r.registry.subscribe(reading, () => {}, { immediate: true });
      try {
        yield* settle;
        expect(r.registry.get(reading)._tag).toBe("Success");
        yield* Deferred.fail(refused, {
          outcome: "definitive-refusal",
          message: "Telemetry subscription refused.",
        });
        yield* settle;
        const result = r.registry.get(reading);
        expect(result._tag).toBe("Failure");
        expect(result.waiting).toBe(false);
        expect(Option.getOrNull(AsyncResult.value(result))).toEqual(auth);
        if (result._tag === "Failure")
          expect(Cause.squash(result.cause)).toMatchObject({
            message: "Telemetry subscription refused.",
          });
        r.registry.refresh(reading);
        yield* settle;
        expect(opens).toBe(2);
        expect(r.registry.get(reading)).toMatchObject({
          _tag: "Success",
          waiting: false,
          value: auth,
        });
      } finally {
        release();
        feeds.close();
        r.close();
      }
    }),
);

it("refresh retries the account in its own registry after another registry reads or an account handover", () => {
  const a = rig();
  const b = rig();
  const calls: Array<string> = [];
  const host = (r: ReturnType<typeof rig>, name: string) => ({
    data: r.store.data,
    hold: () => () => {},
    revalidate: () => {},
    onClose: () => () => {},
    retry: () => {
      calls.push(name);
    },
  });
  a.registry.set(mateFeedReadsAtom, host(a, "account A"));
  b.registry.set(mateFeedReadsAtom, host(b, "account B"));
  const atom = mateFeedAsyncAtom(key);
  const releaseA = a.registry.subscribe(atom, () => {}, { immediate: true });
  const releaseB = b.registry.subscribe(atom, () => {}, { immediate: true });
  try {
    expect(calls).toEqual([]);
    a.registry.refresh(atom);
    expect(calls).toEqual(["account A"]);
    a.registry.set(mateFeedReadsAtom, host(a, "new account A"));
    expect(calls).toEqual(["account A"]);
    b.registry.refresh(atom);
    a.registry.refresh(atom);
    expect(calls).toEqual(["account A", "account B", "new account A"]);
  } finally {
    releaseA();
    releaseB();
    a.close();
    b.close();
  }
});

it.live(
  "retained evidence awaiting its source without a fault does not invent a read failure",
  () =>
    Effect.gen(function* () {
      const r = rig();
      const feeds = makeMateFeeds({
        store: r.store,
        wire: {
          open: () =>
            Stream.concat(
              Stream.make({ kind: "session" as const }, { kind: "value" as const, value: auth }),
              Stream.never,
            ),
        },
      });
      r.registry.set(mateFeedReadsAtom, { data: r.store.data, ...feeds });
      const atom = mateFeedAsyncAtom(key);
      const unmount = r.registry.mount(atom);
      yield* settle;
      r.store.dispatch({
        kind: "stream",
        key: mateFeedScope(key),
        now: 0,
        event: { kind: "parent-lost" },
      });
      expect(r.registry.get(atom)).toMatchObject({
        _tag: "Success",
        value: auth,
        waiting: true,
        read: { freshness: { kind: "stale" }, evidence: { stream: { fault: null } } },
      });
      unmount();
      feeds.close();
      r.close();
    }),
);

describe("the crew feed's frames", () => {
  it("takes a frame only when it is newer: its revision's epoch first, then its sequence, V1's seq without one", () => {
    const v1 = (seq: number) => ({ seq });
    const engine = (epoch: number, seq: number, wallSeq = 0, view?: number) => ({
      seq: wallSeq,
      revision: { epoch, seq, ...(view === undefined ? {} : { view }) },
    });
    const table = [
      ["the first V1 frame", null, v1(5), true],
      ["a later V1 frame", v1(5), v1(6), true],
      ["the same V1 frame again", v1(5), v1(5), false],
      ["an older V1 frame", v1(5), v1(4), false],
      ["the first engine frame", null, engine(2, 0), true],
      ["the next engine step", engine(2, 7), engine(2, 8), true],
      ["the same engine step again", engine(2, 7), engine(2, 7), false],
      ["an older engine step", engine(2, 7), engine(2, 6), false],
      // A dev service came up or went: the crew's step stands, what its frame shows moved.
      ["the same engine step, its view moved", engine(2, 7), engine(2, 7, 0, 1), true],
      ["the same engine step and view again", engine(2, 7, 0, 1), engine(2, 7, 0, 1), false],
      ["an older view of the same step", engine(2, 7, 0, 2), engine(2, 7, 0, 1), false],
      ["the next step after a moved view", engine(2, 7, 0, 3), engine(2, 8), true],
      ["a newer epoch, its sequence started again", engine(2, 7), engine(3, 0), true],
      ["an older epoch, its sequence ahead", engine(3, 0), engine(2, 9), false],
      [
        "an engine frame whose wall-clock seq went back",
        engine(2, 7, 900),
        engine(2, 8, 100),
        true,
      ],
    ] as const;
    for (const [name, last, frame, newer] of table) {
      expect([name, isNewerCrewFrame(last === null ? null : crewFrameMark(last), frame)]).toEqual([
        name,
        newer,
      ]);
    }
  });
});
