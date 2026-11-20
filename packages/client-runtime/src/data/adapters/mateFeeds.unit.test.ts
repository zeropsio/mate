import { EnvironmentScopeRequiredError, WS_METHODS } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AtomRegistry } from "effect/reactivity";
import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { EnvironmentSupervisor } from "../../connection/supervisor.ts";
import type { RpcSession } from "../../rpc/session.ts";
import { settle } from "../__fixtures__/zeropsWire.ts";
import type { MateFeedKey } from "../families/mateFeeds.ts";
import { mateFeed } from "../projections/mateFeeds.ts";
import { readsOfState, makeAccountStore } from "../store.ts";
import type { StreamFault } from "../streamMachine.ts";
import {
  makeMateFeeds,
  makeMateFeedWire,
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

// witness: packages/client-runtime/src/data/adapters/mateFeeds.ts | if (next.epoch !== last.epoch) return next.epoch > last.epoch; → if (next.epoch !== last.epoch) return next.seq > last.seq;
it("AD37: A Mate's feed takes a frame only when it is newer: its revision's epoch first, then its sequence", () => {
  const v1 = (seq: number) => ({ seq });
  const engine = (epoch: number, seq: number, wallSeq = 0, view?: number) => ({
    seq: wallSeq,
    revision: { epoch, seq, ...(view === undefined ? {} : { view }) },
  });
  type Frame = Parameters<typeof crewFrameMark>[0];
  const newer = (last: Frame | null, frame: Frame) =>
    isNewerCrewFrame(last === null ? null : crewFrameMark(last), frame);

  expect(newer(null, v1(5))).toBe(true);
  expect(newer(v1(5), v1(6))).toBe(true);
  expect(newer(v1(5), v1(5))).toBe(false);
  expect(newer(v1(5), v1(4))).toBe(false);
  expect(newer(null, engine(2, 0))).toBe(true);
  expect(newer(engine(2, 7), engine(2, 8))).toBe(true);
  expect(newer(engine(2, 7), engine(2, 7))).toBe(false);
  expect(newer(engine(2, 7), engine(2, 6))).toBe(false);
  expect(newer(engine(2, 7), engine(2, 7, 0, 1))).toBe(true);
  expect(newer(engine(2, 7, 0, 1), engine(2, 7, 0, 1))).toBe(false);
  expect(newer(engine(2, 7, 0, 2), engine(2, 7, 0, 1))).toBe(false);
  expect(newer(engine(2, 7, 0, 3), engine(2, 8))).toBe(true);
  expect(newer(engine(2, 7), engine(3, 0))).toBe(true);
  expect(newer(engine(3, 0), engine(2, 9))).toBe(false);
  expect(newer(engine(2, 7, 900), engine(2, 8, 100))).toBe(true);
});

// witness: packages/client-runtime/src/data/adapters/mateFeeds.ts | retry: (key: MateFeedKey) => held.get(mateFeedScope(key))?.retry() → retry: (key: MateFeedKey) => held.get(mateFeedScope(key))?.refresh()
it.effect(
  "AD38: An owner read denial withdraws retained content until a fresh authorized answer",
  () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      const read = () => mateFeed("mateAgentAuth").derive(readsOfState(store.state()), key);
      const denied = yield* SubscriptionRef.make(false);
      const feeds = makeMateFeeds({
        store,
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
      expect(read().state).toBe("known");
      yield* SubscriptionRef.set(denied, true);
      yield* settle;
      expect(read()).toMatchObject({ state: "failed", failure: { kind: "refused" } });
      release();
      const remount = feeds.hold(key);
      yield* settle;
      expect(read().state).toBe("failed");
      yield* SubscriptionRef.set(denied, false);
      feeds.retry(key);
      yield* settle;
      expect(read()).toMatchObject({ state: "known", value: auth, freshness: { kind: "live" } });
      remount();
      feeds.close();
      store.close();
      registry.dispose();
    }),
);

// witness: packages/client-runtime/src/data/adapters/mateFeeds.ts | return { outcome: "authoritative-denial", message: reason.error.message }; → return { outcome: "transient", message: reason.error.message };
it.effect(
  "AD+4: A session scope refusal withdraws a feed's retained content instead of retrying it as an outage",
  () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      const read = () => mateFeed("mateAgentAuth").derive(readsOfState(store.state()), key);
      const revoked = yield* Deferred.make<void>();
      const session = {
        client: {
          [WS_METHODS.subscribeZeropsAgentAuth]: () =>
            Stream.concat(
              Stream.make(auth),
              Stream.fromEffect(
                Deferred.await(revoked).pipe(
                  Effect.andThen(
                    Effect.fail(
                      new EnvironmentScopeRequiredError({
                        code: "insufficient_scope",
                        requiredScope: "orchestration:read",
                        traceId: "trace",
                      }),
                    ),
                  ),
                ),
              ),
            ),
        },
      } as unknown as RpcSession;
      const supervisor = {
        session: yield* SubscriptionRef.make(Option.some(session)),
      } as unknown as EnvironmentSupervisor["Service"];
      const connections = {
        followStream: <A, E, R>(_environmentId: string, stream: Stream.Stream<A, E, R>) =>
          Stream.provideService(stream, EnvironmentSupervisor, supervisor),
      } as unknown as EnvironmentRegistry["Service"];
      const feeds = makeMateFeeds({
        store,
        wire: { open: makeMateFeedWire(connections).open },
      });
      const release = feeds.hold(key);
      yield* Effect.gen(function* () {
        yield* settle;
        expect(read()).toMatchObject({ state: "known", value: auth });
        yield* Deferred.succeed(revoked, undefined);
        yield* settle;
        expect(read()).toMatchObject({ state: "failed", failure: { kind: "refused" } });
        expect(read()).not.toHaveProperty("value");
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            release();
            feeds.close();
            store.close();
            registry.dispose();
          }),
        ),
      );
    }),
);
