import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Scheduler from "effect/Scheduler";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/reactivity";

import { makeAccountStore } from "./store.ts";
import { STREAM_POLICY, type StreamFault } from "./streamMachine.ts";
import { superviseLink } from "./supervisor.ts";
import { historyScope, runningScope } from "./families/process.ts";
import { linkKeys } from "./model.ts";

const LINK = linkKeys.zerops("org");
const SCOPE = runningScope("org");

const transient: StreamFault = { outcome: "transient", message: "socket closed" };

/** Drain runnable supervisor work before observing its state or moving the clock. */
function controlledScheduler() {
  const dispatcher = new Scheduler.MixedScheduler("sync", () => () => {}).makeDispatcher();
  const scheduler: Scheduler.Scheduler = {
    executionMode: "sync",
    shouldYield: () => false,
    makeDispatcher: () => dispatcher,
  };
  return { scheduler, drain: Effect.sync(() => dispatcher.flush()) };
}

describe("superviseLink", () => {
  it.effect(
    "network return starts a real retry immediately, without declaring the source live",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const { scheduler, drain } = controlledScheduler();
        let attempts = 0;
        const supervisor = yield* superviseLink({
          key: LINK,
          scopes: [],
          store,
          attempt: () =>
            Effect.suspend(() => {
              attempts++;
              return attempts === 1 ? Effect.fail(transient) : Effect.never;
            }),
          repairSession: Effect.void,
        }).pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
        const fiber = yield* Effect.forkChild(supervisor.run).pipe(
          Effect.provideService(Scheduler.Scheduler, scheduler),
        );
        yield* drain;
        expect(store.state().streams.get(LINK)?.phase).toBe("recovering");
        yield* supervisor.signal("resume");
        yield* drain;
        expect(attempts).toBe(2);
        expect(store.state().streams.get(LINK)?.phase).toBe("connecting");
        yield* Fiber.interrupt(fiber);
      }),
  );
  it.effect(
    "retries a transient failure when the machine says, and leaves its scopes stale meanwhile",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const { scheduler, drain } = controlledScheduler();
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
        }).pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
        store.dispatch({
          kind: "stream",
          key: SCOPE,
          now: 0,
          event: { kind: "demand", demanded: true },
        });
        const fiber = yield* Effect.forkChild(supervisor.run).pipe(
          Effect.provideService(Scheduler.Scheduler, scheduler),
        );
        yield* drain;

        const recovering = store.state().streams.get(LINK);
        expect(recovering?.phase).toBe("recovering");
        expect(store.state().streams.get(SCOPE)?.phase).toBe("stale");
        expect(attempts).toEqual([1]);

        yield* TestClock.adjust(recovering?.next.kind === "retry" ? recovering.next.at : 0);
        yield* drain;
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
        const { scheduler, drain } = controlledScheduler();
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
        }).pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
        const fiber = yield* Effect.forkChild(supervisor.run).pipe(
          Effect.provideService(Scheduler.Scheduler, scheduler),
        );
        yield* drain;
        expect({ attempts, repairs }).toEqual({ attempts: 2, repairs: 1 });
        expect(store.state().streams.get(LINK)?.phase).toBe("refused");

        yield* TestClock.adjust("1 hour");
        yield* drain;
        expect(attempts).toBe(2);

        yield* supervisor.signal("manual-retry");
        yield* drain;
        expect({ attempts, repairs }).toEqual({ attempts: 4, repairs: 2 });
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect("ends an attempt whose handshake never comes at its named deadline", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const { scheduler, drain } = controlledScheduler();
      const supervisor = yield* superviseLink({
        key: LINK,
        scopes: [],
        store,
        attempt: () => Effect.never,
        repairSession: Effect.void,
      }).pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
      const fiber = yield* Effect.forkChild(supervisor.run).pipe(
        Effect.provideService(Scheduler.Scheduler, scheduler),
      );
      yield* drain;
      expect(store.state().streams.get(LINK)?.phase).toBe("connecting");

      yield* TestClock.adjust(STREAM_POLICY.handshakeTimeoutMs);
      yield* drain;
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
        const { scheduler, drain } = controlledScheduler();
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
        }).pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
        const fiber = yield* Effect.forkChild(supervisor.run).pipe(
          Effect.provideService(Scheduler.Scheduler, scheduler),
        );
        yield* drain;
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
        const { scheduler, drain } = controlledScheduler();
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
        }).pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
        const fiber = yield* Effect.forkChild(supervisor.run).pipe(
          Effect.provideService(Scheduler.Scheduler, scheduler),
        );
        yield* drain;
        expect(store.state().streams.get(detail)?.phase).toBe("connecting");
        yield* TestClock.adjust(STREAM_POLICY.handshakeTimeoutMs);
        yield* drain;
        expect(store.state().streams.get(detail)?.phase).toBe("recovering");
        expect(store.state().streams.get(LINK)?.phase).toBe("live");
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect("A detail deadline wakes at its instant or a store change; no 10 s scan", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const { scheduler, drain } = controlledScheduler();
      const detail = historyScope("org", "p1");
      const demanded: Array<typeof detail> = [];
      let looks = 0;
      const supervisor = yield* superviseLink({
        key: LINK,
        scopes: [],
        details: () => {
          looks += 1;
          return demanded;
        },
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
            return yield* Effect.never;
          }),
        repairSession: Effect.void,
      }).pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
      const fiber = yield* Effect.forkChild(supervisor.run).pipe(
        Effect.provideService(Scheduler.Scheduler, scheduler),
      );
      yield* drain;
      // Nothing waits: an hour passes without one look at the details.
      const idle = looks;
      yield* TestClock.adjust(3_600_000);
      yield* drain;
      expect(looks).toBe(idle);
      // A detail demanded now whose answer may take two seconds passes that deadline at its instant.
      demanded.push(detail);
      const at = 3_600_000;
      store.dispatch({
        kind: "stream",
        key: detail,
        now: at,
        event: { kind: "demand", demanded: true },
      });
      store.dispatch({ kind: "stream", key: detail, now: at, event: { kind: "attempt" } });
      store.dispatch({
        kind: "stream",
        key: detail,
        now: at,
        event: { kind: "handshake", baselineWithinMs: 2_000 },
      });
      yield* drain;
      yield* TestClock.adjust(1_999);
      yield* drain;
      expect(store.state().streams.get(detail)?.phase).toBe("baselining");
      yield* TestClock.adjust(1);
      yield* drain;
      expect(store.state().streams.get(detail)?.phase).toBe("recovering");
      expect(store.state().streams.get(LINK)?.phase).toBe("live");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect(
    "lets its demand go at its release, and its late end takes none from the link after",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const { scheduler, drain } = controlledScheduler();
        const link = () =>
          superviseLink({
            key: LINK,
            scopes: [SCOPE],
            store,
            attempt: () => Effect.never,
            repairSession: Effect.void,
          }).pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
        const first = yield* link();
        const running = yield* Effect.forkChild(first.run).pipe(
          Effect.provideService(Scheduler.Scheduler, scheduler),
        );
        yield* drain;
        yield* first.release;
        yield* drain;
        expect(store.state().streams.get(SCOPE)?.demanded).toBe(false);
        const second = yield* link();
        const next = yield* Effect.forkChild(second.run).pipe(
          Effect.provideService(Scheduler.Scheduler, scheduler),
        );
        yield* drain;
        yield* Fiber.interrupt(running);
        expect(store.state().streams.get(LINK)?.demanded).toBe(true);
        expect(store.state().streams.get(SCOPE)?.demanded).toBe(true);
        yield* Fiber.interrupt(next);
      }),
  );
});
