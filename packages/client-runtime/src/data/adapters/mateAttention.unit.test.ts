import { expect, it } from "@effect/vitest";
import { EnvironmentAuthorizationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/reactivity";

import { attention } from "../__fixtures__/mateAttention.ts";
import { settle } from "../__fixtures__/zeropsWire.ts";
import { mateAttentionScope } from "../families/mateAttention.ts";
import { linkKeys, type StreamKey } from "../model.ts";
import { factOf } from "../reducer.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { superviseLink } from "../supervisor.ts";
import { mateAttentionLink, type MateAttentionEvent } from "./mateAttention.ts";

const PROJECT = "ada";

type Said = MateAttentionEvent | { readonly kind: "die"; readonly defect: string };

/** A Mate's session the test drives: each `open` is one session whose events the test sends. */
function fixtureMate() {
  let events: Queue.Queue<Said, EnvironmentAuthorizationError> | null = null;
  return {
    send: (event: Said) =>
      Effect.suspend(() =>
        events === null ? Effect.die("No session is open.") : Queue.offer(events, event),
      ),
    fail: (error: EnvironmentAuthorizationError) =>
      Effect.suspend(() => (events === null ? Effect.void : Queue.fail(events, error))),
    wire: {
      open: Stream.unwrap(
        Effect.gen(function* () {
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

const openMate = Effect.gen(function* () {
  const registry = yield* Effect.acquireRelease(
    Effect.sync(() => AtomRegistry.make()),
    (registry) => Effect.sync(() => registry.dispose()),
  );
  const store = yield* Effect.acquireRelease(
    Effect.sync(() => makeAccountStore(registry)),
    (store) => Effect.sync(() => store.close()),
  );
  const mate = fixtureMate();
  const link = mateAttentionLink({ projectId: PROJECT, wire: mate.wire, store });
  const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
  yield* Effect.forkScoped(supervisor.run);
  yield* settle;
  return {
    send: mate.send,
    fail: mate.fail,
    held: () => factOf(store.state(), "mateAttention", PROJECT),
    phase: (key: StreamKey) => readsOfState(store.state()).stream(key).phase,
  };
});

// witness: packages/client-runtime/src/data/adapters/mateAttention.ts | ...value.source, live: true → ...value.source, incarnation: value.source.environmentId, live: true
it.effect(
  "AD43: An open Mate's first attention value is held as its baseline, and its attention goes live",
  () =>
    Effect.gen(function* () {
      const mate = yield* openMate;
      yield* mate.send({ kind: "session" });
      yield* mate.send({ kind: "value", value: attention("i1", 3, 1) });
      yield* settle;
      expect(mate.held()).toMatchObject({
        content: { kind: "value", value: attention("i1", 3, 1) },
        revision: { kind: "mate-attention", incarnation: "i1" },
        via: "mate-direct",
        method: "baseline",
      });
      expect(mate.phase(linkKeys.mate(PROJECT))).toBe("live");
      expect(mate.phase(mateAttentionScope(PROJECT))).toBe("live");
    }),
);

// witness: packages/client-runtime/src/data/adapters/mateAttention.ts | ...value.source, live: true → ...value.source, revision: value.source.epoch, live: true
it.effect(
  "AD44: A Mate's later attention value is taken by its revision in the session, never an older one",
  () =>
    Effect.gen(function* () {
      const mate = yield* openMate;
      yield* mate.send({ kind: "session" });
      yield* mate.send({ kind: "value", value: attention("i1", 3) });
      yield* mate.send({ kind: "value", value: attention("i1", 5, 2) });
      yield* mate.send({ kind: "value", value: attention("i1", 4, 1) });
      yield* settle;
      expect(mate.held()).toMatchObject({
        content: { value: attention("i1", 5, 2) },
        method: "push",
      });
    }),
);

// witness: packages/client-runtime/src/data/adapters/mateAttention.ts | ...value.source, live: true → ...value.source, epoch: value.source.revision, live: true
it.effect(
  "AD45: A Mate's next session starts its attention again: its first value is the baseline, whatever revision it carries",
  () =>
    Effect.gen(function* () {
      const mate = yield* openMate;
      yield* mate.send({ kind: "session" });
      yield* mate.send({ kind: "value", value: attention("i1", 9) });
      // The Mate restarted: its next epoch, a new incarnation, its revision from 0.
      yield* mate.send({ kind: "session" });
      yield* mate.send({ kind: "value", value: attention("i2", 0, 1, 2) });
      yield* settle;
      expect(mate.held()).toMatchObject({
        content: { value: attention("i2", 0, 1, 2) },
        method: "baseline",
      });
      expect(mate.phase(mateAttentionScope(PROJECT))).toBe("live");
    }),
);

// witness: packages/client-runtime/src/data/adapters/mateSource.ts | return yield* Effect.fail(SESSION_LOST); → return;
it.effect(
  "AD50: When a Mate's socket goes, its attention keeps the value it holds and is no longer live",
  () =>
    Effect.gen(function* () {
      const mate = yield* openMate;
      yield* mate.send({ kind: "session" });
      yield* mate.send({ kind: "value", value: attention("i1", 3, 1) });
      yield* mate.send({ kind: "session-lost" });
      yield* settle;
      expect(mate.held()).toMatchObject({ content: { value: attention("i1", 3, 1) } });
      expect(mate.phase(mateAttentionScope(PROJECT))).not.toBe("live");
    }),
);

// witness: packages/client-runtime/src/data/adapters/mateSource.ts | defectText(reason.defect).startsWith(UNKNOWN_REQUEST_TAG) → defectText(reason.defect).endsWith(UNKNOWN_REQUEST_TAG)
it.effect(
  "AD51: A Mate from before the attention value is named unsupported and never retried as an outage",
  () =>
    Effect.gen(function* () {
      const mate = yield* openMate;
      yield* mate.send({ kind: "die", defect: "Unknown request tag subscribeZeropsAttention" });
      yield* settle;
      yield* TestClock.adjust("10 minutes");
      yield* settle;
      expect(mate.phase(linkKeys.mate(PROJECT))).toBe("unsupported");
      expect(mate.phase(mateAttentionScope(PROJECT))).toBe("unsupported");
    }),
);

// witness: packages/client-runtime/src/data/adapters/mateSource.ts | if (Cause.isFailReason(reason) && isAuthorizationError(reason.error)) → if (Cause.isFailReason(reason) && !isAuthorizationError(reason.error))
it.effect(
  "AD52: A Mate's refusal of its attention ends the read as refused, and time alone never asks again",
  () =>
    Effect.gen(function* () {
      const mate = yield* openMate;
      yield* mate.fail(
        new EnvironmentAuthorizationError({
          message: "Not yours.",
          requiredScope: "orchestration:read",
        }),
      );
      yield* settle;
      yield* TestClock.adjust("10 minutes");
      yield* settle;
      expect(mate.phase(linkKeys.mate(PROJECT))).toBe("refused");
    }),
);
