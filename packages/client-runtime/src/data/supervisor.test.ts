import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/unstable/reactivity";

import { makeAccountStore } from "./store.ts";
import { STREAM_POLICY, type StreamFault } from "./streamMachine.ts";
import { superviseLink } from "./supervisor.ts";
import { historyScope, runningScope } from "./families/process.ts";
import { linkKeys } from "./model.ts";

const LINK = linkKeys.zerops("org");
const SCOPE = runningScope("org");

const transient: StreamFault = { outcome: "transient", message: "socket closed" };

describe("superviseLink", () => {
  it.effect(
    "retries a transient failure when the machine says, and leaves its scopes stale meanwhile",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const attempts: number[] = [];
        const supervisor = yield* superviseLink({
          key: LINK,
          scopes: [SCOPE],
          store,
          attempt: (generation) =>
            Effect.gen(function* () {
              attempts.push(generation);
              store.dispatch({ kind: "stream", key: LINK, now: 0, event: { kind: "handshake" } });
              store.dispatch({
                kind: "stream",
                key: LINK,
                now: 0,
                event: { kind: "baseline-committed" },
              });
              if (generation === 1) return yield* Effect.fail(transient);
              return yield* Effect.never;
            }),
          repairSession: Effect.void,
        });
        store.dispatch({
          kind: "stream",
          key: SCOPE,
          now: 0,
          event: { kind: "demand", demanded: true },
        });
        const fiber = yield* Effect.forkChild(supervisor.run);
        yield* Effect.yieldNow;

        const recovering = store.state().streams.get(LINK);
        expect(recovering?.phase).toBe("recovering");
        expect(store.state().streams.get(SCOPE)?.phase).toBe("stale");
        expect(attempts).toEqual([1]);

        yield* TestClock.adjust(recovering?.next.kind === "retry" ? recovering.next.at : 0);
        expect(attempts).toEqual([1, 2]);
        expect(store.state().streams.get(LINK)?.phase).toBe("live");
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect(
    "repairs a session once and leaves a second expiry refused until the person tries again",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        let attempts = 0;
        let repairs = 0;
        const supervisor = yield* superviseLink({
          key: LINK,
          scopes: [],
          store,
          attempt: () =>
            Effect.suspend(() => {
              attempts += 1;
              return Effect.fail<StreamFault>({ outcome: "recoverable-session", message: "4401" });
            }),
          repairSession: Effect.sync(() => {
            repairs += 1;
          }),
        });
        const fiber = yield* Effect.forkChild(supervisor.run);
        yield* Effect.yieldNow;
        expect({ attempts, repairs }).toEqual({ attempts: 2, repairs: 1 });
        expect(store.state().streams.get(LINK)?.phase).toBe("refused");

        yield* TestClock.adjust("1 hour");
        expect(attempts).toBe(2);

        yield* supervisor.signal("manual-retry");
        yield* Effect.yieldNow;
        expect({ attempts, repairs }).toEqual({ attempts: 4, repairs: 2 });
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect("ends an attempt whose handshake never comes at its named deadline", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const supervisor = yield* superviseLink({
        key: LINK,
        scopes: [],
        store,
        attempt: () => Effect.never,
        repairSession: Effect.void,
      });
      const fiber = yield* Effect.forkChild(supervisor.run);
      yield* Effect.yieldNow;
      expect(store.state().streams.get(LINK)?.phase).toBe("connecting");

      yield* TestClock.adjust(STREAM_POLICY.handshakeTimeoutMs);
      expect(store.state().streams.get(LINK)).toMatchObject({
        phase: "recovering",
        fault: { outcome: "transient" },
      });
      yield* Fiber.interrupt(fiber);
      expect(store.state().streams.get(LINK)?.phase).toBe("paused");
    }),
  );

  it.effect(
    "refuses, without looping, a session whose repair itself ends in an ended session",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        let repairs = 0;
        const ended: StreamFault = { outcome: "recoverable-session", message: "4401" };
        const supervisor = yield* superviseLink({
          key: LINK,
          scopes: [],
          store,
          attempt: () => Effect.fail(ended),
          repairSession: Effect.suspend(() => {
            repairs += 1;
            return Effect.fail(ended);
          }),
        });
        const fiber = yield* Effect.forkChild(supervisor.run);
        for (let turn = 0; turn < 50; turn += 1) yield* Effect.yieldNow;
        expect(repairs).toBe(1);
        expect(store.state().streams.get(LINK)?.phase).toBe("refused");
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect(
    "lets a detail whose read never answers retry alone at its deadline, the link stays",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const detail = historyScope("org", "p1");
        const supervisor = yield* superviseLink({
          key: LINK,
          scopes: [],
          details: () => [detail],
          store,
          attempt: () =>
            Effect.gen(function* () {
              store.dispatch({ kind: "stream", key: LINK, now: 0, event: { kind: "handshake" } });
              store.dispatch({
                kind: "stream",
                key: LINK,
                now: 0,
                event: { kind: "baseline-committed" },
              });
              store.dispatch({
                kind: "stream",
                key: detail,
                now: 0,
                event: { kind: "demand", demanded: true },
              });
              store.dispatch({ kind: "stream", key: detail, now: 0, event: { kind: "attempt" } });
              return yield* Effect.never;
            }),
          repairSession: Effect.void,
        });
        const fiber = yield* Effect.forkChild(supervisor.run);
        yield* Effect.yieldNow;
        expect(store.state().streams.get(detail)?.phase).toBe("connecting");
        yield* TestClock.adjust(STREAM_POLICY.handshakeTimeoutMs);
        expect(store.state().streams.get(detail)?.phase).toBe("recovering");
        expect(store.state().streams.get(LINK)?.phase).toBe("live");
        yield* Fiber.interrupt(fiber);
      }),
  );
});
