import { describe, expect, it } from "@effect/vitest";
import { EnvironmentAuthorizationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/reactivity";

import { attention } from "../__fixtures__/mateAttention.ts";
import { settle } from "../__fixtures__/zeropsWire.ts";
import { mateAttentionScope } from "../families/mateAttention.ts";
import { linkKeys, type StreamKey } from "../model.ts";
import { factOf } from "../reducer.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { superviseLink } from "../supervisor.ts";
import { mateAttentionLink, type MateAttentionEvent } from "./mateAttention.ts";

const PROJECT = "ada";

type Said = MateAttentionEvent | { readonly kind: "die"; readonly defect: string };

/** A Mate's session the test drives: each `open` is one session whose events the test sends. */
function fixtureMate() {
  let events: Queue.Queue<Said, EnvironmentAuthorizationError> | null = null;
  let opens = 0;
  return {
    opens: () => opens,
    send: (event: Said) =>
      Effect.suspend(() =>
        events === null ? Effect.die("No session is open.") : Queue.offer(events, event),
      ),
    fail: (error: EnvironmentAuthorizationError) =>
      Effect.suspend(() => (events === null ? Effect.void : Queue.fail(events, error))),
    wire: {
      open: Stream.unwrap(
        Effect.gen(function* () {
          opens += 1;
          const queue = yield* Queue.unbounded<Said, EnvironmentAuthorizationError>();
          events = queue;
          return Stream.fromQueue(queue).pipe(
            Stream.mapEffect((said) =>
              said.kind === "die" ? Effect.die(said.defect) : Effect.succeed(said),
            ),
          );
        }),
      ),
    },
  };
}

const run = (store: AccountStore, mate: ReturnType<typeof fixtureMate>) =>
  Effect.gen(function* () {
    const link = mateAttentionLink({ projectId: PROJECT, wire: mate.wire, store });
    const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
    const fiber = yield* Effect.forkChild(supervisor.run);
    yield* settle;
    return { fiber, supervisor };
  });

const phase = (store: AccountStore, key: StreamKey) =>
  readsOfState(store.state()).stream(key).phase;
const held = (store: AccountStore) => factOf(store.state(), "mateAttention", PROJECT);

describe("mateAttentionLink", () => {
  it.effect("commits an open Mate's first attention as its baseline, and goes live", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const mate = fixtureMate();
      const { fiber } = yield* run(store, mate);
      yield* mate.send({ kind: "session" });
      yield* mate.send({ kind: "value", value: attention("i1", 3, 1) });
      yield* settle;
      expect(held(store)).toMatchObject({
        content: { kind: "value", value: attention("i1", 3, 1) },
        revision: { kind: "mate-attention", incarnation: "i1", revision: 3 },
        via: "mate-direct",
        method: "baseline",
      });
      expect(phase(store, linkKeys.mate(PROJECT))).toBe("live");
      expect(phase(store, mateAttentionScope(PROJECT))).toBe("live");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("takes a later value of the session by its revision, never an older one", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const mate = fixtureMate();
      const { fiber } = yield* run(store, mate);
      yield* mate.send({ kind: "session" });
      yield* mate.send({ kind: "value", value: attention("i1", 3) });
      yield* mate.send({ kind: "value", value: attention("i1", 5, 2) });
      yield* mate.send({ kind: "value", value: attention("i1", 4, 1) });
      yield* settle;
      expect(held(store)).toMatchObject({
        content: { value: attention("i1", 5, 2) },
        method: "push",
      });
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("starts again on the Mate's next session, whose first value is its baseline", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const mate = fixtureMate();
      const { fiber } = yield* run(store, mate);
      yield* mate.send({ kind: "session" });
      yield* mate.send({ kind: "value", value: attention("i1", 9) });
      // The Mate restarted: its next epoch, a new incarnation, its revision from 0.
      yield* mate.send({ kind: "session" });
      yield* mate.send({ kind: "value", value: attention("i2", 0, 1, 2) });
      yield* settle;
      expect(held(store)).toMatchObject({
        content: { value: attention("i2", 0, 1, 2) },
        method: "baseline",
      });
      expect(phase(store, mateAttentionScope(PROJECT))).toBe("live");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("keeps what it holds when the socket goes, and is no longer live", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const mate = fixtureMate();
      const { fiber } = yield* run(store, mate);
      yield* mate.send({ kind: "session" });
      yield* mate.send({ kind: "value", value: attention("i1", 3) });
      yield* mate.send({ kind: "session-lost" });
      yield* settle;
      expect(held(store)).toMatchObject({ content: { value: attention("i1", 3) } });
      expect(phase(store, linkKeys.mate(PROJECT))).toBe("recovering");
      expect(phase(store, mateAttentionScope(PROJECT))).not.toBe("live");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("names a Mate from before the attention value unsupported, and asks it no more", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const mate = fixtureMate();
      const { fiber } = yield* run(store, mate);
      yield* mate.send({ kind: "die", defect: "Unknown request tag subscribeZeropsAttention" });
      yield* settle;
      yield* TestClock.adjust("10 minutes");
      yield* settle;
      expect(phase(store, linkKeys.mate(PROJECT))).toBe("unsupported");
      expect(phase(store, mateAttentionScope(PROJECT))).toBe("unsupported");
      expect(mate.opens()).toBe(1);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("ends at the Mate's refusal, and asks again only at the person's retry", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const mate = fixtureMate();
      const { fiber, supervisor } = yield* run(store, mate);
      yield* mate.fail(
        new EnvironmentAuthorizationError({
          message: "Not yours.",
          requiredScope: "orchestration:read",
        }),
      );
      yield* settle;
      yield* TestClock.adjust("10 minutes");
      yield* settle;
      expect(phase(store, linkKeys.mate(PROJECT))).toBe("refused");
      expect(mate.opens()).toBe(1);
      yield* supervisor.signal("manual-retry");
      yield* settle;
      expect(mate.opens()).toBe(2);
      yield* Fiber.interrupt(fiber);
    }),
  );
});
