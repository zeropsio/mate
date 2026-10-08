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
import { mateFeedReadsAtom, readMateFeed } from "../mateFeedReads.ts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AtomRegistry } from "effect/reactivity";
import { type MateFeedKey } from "../families/mateFeeds.ts";
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
        freshness: { kind: "stale", reason: { kind: "source-recovering" } },
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
      const release = feeds.hold(key);
      yield* settle;
      release();
      access({ outcome: "access-unverified", message: "Verify access again." });
      expect(r.read()).toMatchObject({ state: "failed", failure: { kind: "refused" } });
      access(null);
      feeds.hold(key);
      yield* settle;
      expect(r.read()).toMatchObject({ state: "known", value: auth, freshness: { kind: "live" } });
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
      yield* SubscriptionRef.set(sessions, Option.none());
      yield* settle;
      expect(read()).toMatchObject({
        state: "known",
        freshness: { kind: "stale" },
        value: { config: { cwd: "/first" } },
      });
      yield* SubscriptionRef.set(sessions, Option.some(session(Deferred.await(second))));
      yield* settle;
      expect(read()).toMatchObject({
        state: "known",
        freshness: { kind: "revalidating" },
        value: { config: { cwd: "/first" } },
      });
      yield* Deferred.succeed(second, config("/second"));
      yield* settle;
      expect(read()).toMatchObject({
        state: "known",
        freshness: { kind: "live" },
        value: { config: { cwd: "/second" } },
      });
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

describe("the crew feed's frames", () => {
  it("takes a frame only when it is newer: its revision's epoch first, then its sequence, V1's seq without one", () => {
    const v1 = (seq: number) => ({ seq });
    const engine = (epoch: number, seq: number, wallSeq = 0) => ({
      seq: wallSeq,
      revision: { epoch, seq },
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
