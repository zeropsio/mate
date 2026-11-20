import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  makeZeropsApiOrigin,
  type ProjectRef,
} from "../data/types.ts";
import {
  makeInvalidationBus,
  type Invalidation,
  type InvalidationBusOptions,
  type InvalidationSignal,
} from "./invalidation.ts";

const project = (projectId: string): ProjectRef => ({
  kind: "project",
  organization: {
    kind: "organization",
    account: {
      apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
      accountId: ZeropsAccountId.make("account"),
    },
    organizationId: ZeropsOrganizationId.make("organization"),
  },
  projectId: ZeropsProjectId.make(projectId),
});

const tags = (projectId: string): Invalidation => ({
  topic: "project",
  project: project(projectId),
});
const container = (projectId: string): Invalidation => ({
  topic: "container",
  target: `${projectId}:zcp`,
});

/** A bus under test: the signals it hears, and everything a subscriber received so far. */
const openBus = (options: Partial<Pick<InvalidationBusOptions, "shown">> = {}) =>
  Effect.gen(function* () {
    const signals = yield* Queue.unbounded<{
      readonly signal: InvalidationSignal;
      readonly processed: Deferred.Deferred<void>;
    }>();
    let previous: Deferred.Deferred<void> | undefined;
    // The next pull happens after the bus has processed the preceding signal.
    const signalStream = Stream.fromEffectRepeat(
      Effect.gen(function* () {
        if (previous !== undefined) yield* Deferred.succeed(previous, undefined);
        const entry = yield* Queue.take(signals);
        previous = entry.processed;
        return entry.signal;
      }),
    );
    const bus = yield* makeInvalidationBus({
      signals: signalStream,
      shown: options.shown ?? (() => false),
    });
    const subscription = yield* bus.subscribe;
    const received: Array<Invalidation> = [];
    const drain = Effect.gen(function* () {
      received.push(...(yield* PubSub.takeUpTo(subscription, Number.POSITIVE_INFINITY)));
      return received;
    });
    const signal = (next: InvalidationSignal) =>
      Effect.gen(function* () {
        const processed = yield* Deferred.make<void>();
        yield* Queue.offer(signals, { signal: next, processed });
        yield* Deferred.await(processed);
      });
    return { bus, drain, signal };
  });

describe("the invalidation union (DESIGN §6.2)", () => {
  it("is closed over its five topics", () => {
    // A topic missing here, or one more than the union has, fails the typecheck.
    const topics: Record<Invalidation["topic"], true> = {
      access: true,
      inventory: true,
      project: true,
      environment: true,
      container: true,
    };
    // @ts-expect-error — not a topic the bus carries
    const unknown: Invalidation["topic"] = "thread";
    expect(Object.keys(topics)).toHaveLength(5);
    expect(Object.keys(topics)).not.toContain(unknown);
  });
});

describe("the invalidation bus (DESIGN §6.2)", () => {
  it.effect("coalesces each key over 250 ms and keeps different keys apart", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { bus, drain } = yield* openBus();
        yield* bus.invalidate(tags("a"));
        yield* TestClock.adjust(100);
        yield* bus.invalidate(tags("a"));
        yield* bus.invalidate(tags("b"));
        yield* bus.invalidate(tags("a"));
        yield* TestClock.adjust(149);
        expect(yield* drain).toEqual([]);
        yield* TestClock.adjust(1);
        expect(yield* drain).toEqual([tags("a")]);
        yield* TestClock.adjust(100);
        expect(yield* drain).toEqual([tags("a"), tags("b")]);
        // The window has closed: the next one for the same key is a new request.
        yield* bus.invalidate(tags("a"));
        yield* TestClock.adjust(250);
        expect(yield* drain).toEqual([tags("a"), tags("b"), tags("a")]);
      }),
    ),
  );

  it.effect("collects a hidden tab's invalidations and flushes them visible-first on wake", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const shown = container("shown");
        const { bus, drain, signal } = yield* openBus({
          shown: (invalidation) => JSON.stringify(invalidation) === JSON.stringify(shown),
        });
        yield* signal({ type: "hidden" });
        yield* TestClock.adjust(60_000);
        yield* bus.invalidate(tags("a"));
        yield* bus.invalidate(container("unshown"));
        yield* bus.invalidate(shown);
        yield* TestClock.adjust(10 * 60_000);
        yield* bus.invalidate(tags("a"));
        yield* TestClock.adjust(10 * 60_000);
        expect(yield* drain).toEqual([]);
        // Visible again, but only the coalesced wake flushes (§6.4).
        yield* signal({ type: "visible" });
        expect(yield* drain).toEqual([]);
        yield* signal({ type: "visible-wake" });
        expect(yield* drain).toEqual([shown, tags("a"), container("unshown")]);
      }),
    ),
  );

  it.effect("delivers while the tab has been hidden for less than a minute", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { bus, drain, signal } = yield* openBus();
        yield* signal({ type: "hidden" });
        yield* TestClock.adjust(59_000);
        yield* bus.invalidate(tags("a"));
        yield* TestClock.adjust(250);
        expect(yield* drain).toEqual([tags("a")]);
        // A short hide raises no visible wake, so nothing may wait for one: coming back starts
        // the next hide's minute from zero.
        yield* signal({ type: "visible" });
        yield* signal({ type: "hidden" });
        yield* TestClock.adjust(59_000);
        yield* bus.invalidate(tags("b"));
        yield* TestClock.adjust(250);
        expect(yield* drain).toEqual([tags("a"), tags("b")]);
      }),
    ),
  );
});
