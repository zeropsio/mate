import { describe, expect, it } from "@effect/vitest";
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
import { makeHarnessBrowser } from "../testing/browserTabs.ts";
import {
  connectCrossTabInvalidations,
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
const repo = (name: string): Invalidation => ({
  topic: "forge-repo",
  origin: "https://git.example.test",
  owner: "team",
  repo: name,
});

/**
 * The browser delivers a channel message as a later task: a task queued after the post runs after
 * that delivery.
 */
const nextTask = Effect.promise(
  () =>
    // @effect-diagnostics-next-line globalTimers:off -- a real task boundary, behind the harness's delivery.
    new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0)),
);

/** Lets the fibers a delivered message woke run up to their next timer. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 5; turn += 1) yield* Effect.yieldNow;
});

/** The login the receiving tab has open. */
const OPEN_LOGIN = { userId: "user-1", loginGeneration: "generation-2" };

/** A bus under test: the signals it hears, and everything a subscriber received so far. */
const openBus = (options: Partial<Pick<InvalidationBusOptions, "shown">> = {}) =>
  Effect.gen(function* () {
    const signals = yield* Queue.unbounded<InvalidationSignal>();
    const bus = yield* makeInvalidationBus({
      signals: Stream.fromQueue(signals),
      shown: options.shown ?? (() => false),
    });
    const subscription = yield* bus.subscribe;
    const received: Array<Invalidation> = [];
    const drain = Effect.gen(function* () {
      yield* Effect.yieldNow;
      received.push(...(yield* PubSub.takeUpTo(subscription, Number.POSITIVE_INFINITY)));
      return received;
    });
    const signal = (next: InvalidationSignal) =>
      Queue.offer(signals, next).pipe(Effect.andThen(Effect.yieldNow));
    return { bus, drain, signal };
  });

describe("the invalidation union (DESIGN §6.2)", () => {
  it("is closed over the ten topics of §6.2", () => {
    // A topic missing here, or one more than the union has, fails the typecheck.
    const topics: Record<Invalidation["topic"], true> = {
      access: true,
      inventory: true,
      project: true,
      environment: true,
      container: true,
      deployment: true,
      "gitea-session": true,
      "forge-org": true,
      "forge-repo": true,
      "forge-pr": true,
    };
    // @ts-expect-error — not a topic the bus carries
    const unknown: Invalidation["topic"] = "thread";
    expect(Object.keys(topics)).toHaveLength(10);
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
        const shown = repo("shown");
        const { bus, drain, signal } = yield* openBus({
          shown: (invalidation) => JSON.stringify(invalidation) === JSON.stringify(shown),
        });
        yield* signal({ type: "hidden" });
        yield* TestClock.adjust(60_000);
        yield* bus.invalidate(tags("a"));
        yield* bus.invalidate(repo("unshown"));
        yield* bus.invalidate(shown);
        yield* TestClock.adjust(10 * 60_000);
        yield* bus.invalidate(tags("a"));
        yield* TestClock.adjust(10 * 60_000);
        expect(yield* drain).toEqual([]);
        // Visible again, but only the coalesced wake flushes (§6.4).
        yield* signal({ type: "visible" });
        expect(yield* drain).toEqual([]);
        yield* signal({ type: "visible-wake" });
        expect(yield* drain).toEqual([shown, tags("a"), repo("unshown")]);
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

describe("cross-tab invalidations (DESIGN §6.7)", () => {
  it.effect.each<{
    readonly name: string;
    readonly message: unknown;
    readonly delivered: boolean;
  }>([
    {
      name: "a message from the same login is delivered",
      message: { ...OPEN_LOGIN, invalidation: tags("a") },
      delivered: true,
    },
    {
      name: "a message from another account is dropped",
      message: { ...OPEN_LOGIN, userId: "user-2", invalidation: tags("a") },
      delivered: false,
    },
    {
      name: "a message from an older login generation is dropped",
      message: { ...OPEN_LOGIN, loginGeneration: "generation-1", invalidation: tags("a") },
      delivered: false,
    },
    {
      name: "a message outside the closed union is dropped",
      message: { ...OPEN_LOGIN, invalidation: { topic: "thread", thread: "t-1" } },
      delivered: false,
    },
  ])("$name", ({ message, delivered }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const browser = makeHarnessBrowser();
        const [sender, receiver] = [browser.openTab(), browser.openTab()];
        const { bus, drain } = yield* openBus();
        yield* connectCrossTabInvalidations({
          bus,
          openChannel: () => new receiver.BroadcastChannel("mate:account"),
          owner: () => OPEN_LOGIN,
        });
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel stays within its origin
        new sender.BroadcastChannel("mate:account").postMessage(message);
        yield* nextTask;
        yield* settle;
        yield* TestClock.adjust(250);
        expect(yield* drain).toEqual(delivered ? [tags("a")] : []);
      }),
    ),
  );

  it.effect("broadcast invalidates here and in the other tabs of the same login", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const browser = makeHarnessBrowser();
        const openTab = (login: { readonly userId: string; readonly loginGeneration: string }) =>
          Effect.gen(function* () {
            const tab = browser.openTab();
            const opened = yield* openBus();
            const crossTab = yield* connectCrossTabInvalidations({
              bus: opened.bus,
              openChannel: () => new tab.BroadcastChannel("mate:account"),
              owner: () => login,
            });
            return { ...opened, crossTab };
          });
        const writer = yield* openTab(OPEN_LOGIN);
        const sibling = yield* openTab(OPEN_LOGIN);
        const stranger = yield* openTab({ ...OPEN_LOGIN, loginGeneration: "generation-3" });
        yield* writer.crossTab.broadcast(tags("a"));
        yield* nextTask;
        yield* settle;
        yield* TestClock.adjust(250);
        expect(yield* writer.drain).toEqual([tags("a")]);
        expect(yield* sibling.drain).toEqual([tags("a")]);
        expect(yield* stranger.drain).toEqual([]);
      }),
    ),
  );
});
