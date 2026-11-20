import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Scheduler from "effect/Scheduler";
import { AtomRegistry } from "effect/reactivity";
import { linkKeys } from "./model.ts";
import { makeAccountStore } from "./store.ts";
import type { StreamFault } from "./streamMachine.ts";
import { superviseLink } from "./supervisor.ts";

const link = linkKeys.zerops("org");

// Drain the work made runnable by each signal before reading the link, on Effect's test clock.
function controlledScheduler() {
  const dispatcher = new Scheduler.MixedScheduler("sync", () => () => {}).makeDispatcher();
  const scheduler: Scheduler.Scheduler = {
    executionMode: "sync",
    shouldYield: () => false,
    makeDispatcher: () => dispatcher,
  };
  return { scheduler, drain: Effect.sync(() => dispatcher.flush()) };
}

// witness: packages/client-runtime/src/data/supervisor.ts | if (signal !== "resume" || streamOf(store.state(), key).phase === "recovering") → if (signal !== "resume" || streamOf(store.state(), key).phase === "connecting")
it.effect(
  "ST23: A network return starts a real retry at once, without declaring the source live",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const { scheduler, drain } = controlledScheduler();
      const transient: StreamFault = { outcome: "transient", message: "socket closed" };
      let openedGeneration: number | undefined;
      const supervisor = yield* superviseLink({
        key: link,
        scopes: [],
        store,
        attempt: (generation) =>
          Effect.suspend(() => {
            openedGeneration = generation;
            return generation === 1 ? Effect.fail(transient) : Effect.never;
          }),
        repairSession: Effect.void,
      }).pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
      const fiber = yield* Effect.forkChild(supervisor.run).pipe(
        Effect.provideService(Scheduler.Scheduler, scheduler),
      );
      yield* drain;
      expect(store.state().streams.get(link)?.phase).toBe("recovering");
      yield* supervisor.signal("resume");
      yield* drain;
      expect(openedGeneration).toBe(2);
      expect(store.state().streams.get(link)?.phase).toBe("connecting");
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/supervisor.ts | ? repaired.cause.reasons[0].error → ? { ...repaired.cause.reasons[0].error, outcome: "transient" }
it.effect(
  "ST24: A session whose repair itself ends in an ended session is refused without looping",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const { scheduler, drain } = controlledScheduler();
      const ended: StreamFault = { outcome: "recoverable-session", message: "4401" };
      const repair = yield* Deferred.make<void, StreamFault>();
      const supervisor = yield* superviseLink({
        key: link,
        scopes: [],
        store,
        attempt: () => Effect.fail(ended),
        repairSession: Deferred.await(repair),
      }).pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
      const fiber = yield* Effect.forkChild(supervisor.run).pipe(
        Effect.provideService(Scheduler.Scheduler, scheduler),
      );
      yield* drain;
      expect(store.state().streams.get(link)?.phase).toBe("reauthenticating");
      yield* Deferred.fail(repair, ended);
      yield* drain;
      expect(store.state().streams.get(link)?.phase).toBe("refused");
      yield* Fiber.interrupt(fiber);
    }),
);
