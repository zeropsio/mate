import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";

import { fixtureWire } from "./__fixtures__/zeropsWire.ts";
import { observeAccount, startZeropsNavigation } from "./account.ts";
import { historyScope, runningScope } from "./families/process.ts";
import { linkKeys, type OperationIntent } from "./model.ts";
import type { RegisteredOperationKind } from "./operations/kind.ts";
import { streamOf } from "./reducer.ts";
import { makeAccountStore } from "./store.ts";

/** The navigation runs on its own runtime: real time passes for it, so a test waits on the state it expects, not on a delay. */
const until = (condition: () => boolean, what: string) =>
  Effect.gen(function* () {
    for (let waited = 0; !condition(); waited += 2) {
      if (waited > 5_000) return yield* Effect.die(new Error(`timed out waiting for ${what}`));
      yield* Effect.sleep(2);
    }
  });

describe("startZeropsNavigation", () => {
  it.live("observes the organization's running work until stopped, then lets its demand go", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire((request) =>
        Effect.succeed(request.body?.wsOutputType === "listStream" ? { items: [] } : {}),
      );
      const navigation = startZeropsNavigation({
        orgId: "org",
        store,
        wire: fixture.wire,
        repairSession: Effect.void,
      });
      yield* until(
        () => streamOf(store.state(), runningScope("org")).phase === "live",
        "the running scope to go live",
      );

      navigation.stop();
      yield* until(
        () =>
          !streamOf(store.state(), linkKeys.zerops("org")).demanded &&
          !streamOf(store.state(), runningScope("org")).demanded,
        "the demand to be let go",
      );
      expect(streamOf(store.state(), linkKeys.zerops("org")).demanded).toBe(false);
      expect(streamOf(store.state(), runningScope("org")).demanded).toBe(false);
    }),
  );
});

describe("observeAccount", () => {
  const HISTORY_PATH = "/project/p1/process?limit=100";
  it.live(
    "reads a detail held before an organization is shown once it is, and again on a switch",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = fixtureWire((request) =>
          Effect.succeed(
            request.method === "GET"
              ? { status: 200, body: { list: [] } }
              : request.body?.wsOutputType === "listStream"
                ? { items: [] }
                : {},
          ),
        );
        const account = observeAccount({ store, wire: fixture.wire, repairSession: Effect.void });
        const release = account.demandDetail({
          family: "process",
          listing: "history",
          ownerId: "p1",
        });
        const reads = () =>
          fixture.requests.filter((request) => request.path === HISTORY_PATH).length;
        expect(reads()).toBe(0);

        account.show("org-a");
        yield* until(
          () =>
            reads() >= 1 && streamOf(store.state(), historyScope("org-a", "p1")).phase === "live",
          "org-a's history to be read",
        );
        expect(reads()).toBe(1);
        expect(streamOf(store.state(), historyScope("org-a", "p1")).phase).toBe("live");

        account.show("org-b");
        yield* until(
          () =>
            reads() >= 2 &&
            !streamOf(store.state(), historyScope("org-a", "p1")).demanded &&
            streamOf(store.state(), historyScope("org-b", "p1")).phase === "live",
          "org-b's history to be read",
        );
        expect(reads()).toBe(2);
        expect(streamOf(store.state(), historyScope("org-a", "p1")).demanded).toBe(false);
        expect(streamOf(store.state(), historyScope("org-b", "p1")).phase).toBe("live");

        release();
        yield* until(
          () => !streamOf(store.state(), historyScope("org-b", "p1")).demanded,
          "org-b's detail to be released",
        );
        account.show(null);
        yield* until(
          () => !streamOf(store.state(), linkKeys.zerops("org-b")).demanded,
          "org-b's link to be let go",
        );
        expect(streamOf(store.state(), linkKeys.zerops("org-b")).demanded).toBe(false);
      }),
  );

  it.live("holds an open operation's detail as a standing demand, without any screen", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire((request) =>
        Effect.succeed(
          request.method === "GET"
            ? { status: 200, body: { list: [] } }
            : request.body?.wsOutputType === "listStream"
              ? { items: [] }
              : {},
        ),
      );
      const restart = {
        kind: "restart-service",
        executor: "zerops",
        reflected: () => false,
        observedIn: () => ({ family: "process", listing: "history", ownerId: "p1" }),
      } as RegisteredOperationKind;
      const account = observeAccount({
        store,
        wire: fixture.wire,
        repairSession: Effect.void,
        kinds: [restart],
      });
      account.show("org");
      const intent = { kind: "restart-service" } as unknown as OperationIntent;
      store.dispatch({ kind: "operation-recorded", requestId: "request-1", intent });
      store.dispatch({
        kind: "operation-receipt",
        receipt: {
          requestId: "request-1",
          operationId: "proc-1",
          executor: "zerops",
          affected: [],
          handles: ["proc-1"],
          acceptance: { kind: "accepted" },
          outcome: { kind: "pending" },
        },
      });
      yield* until(
        () => streamOf(store.state(), historyScope("org", "p1")).phase === "live",
        "the open operation's history to go live",
      );
      account.show(null);
    }),
  );
});

describe("observeAccount — its end", () => {
  it.live("lets go of its store when stopped, so a replacement is the store's only observer", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      let listening = 0;
      const counted = {
        ...store,
        subscribe: (listener: () => void) => {
          listening += 1;
          const stop = store.subscribe(listener);
          return () => {
            listening -= 1;
            stop();
          };
        },
      };
      const fixture = fixtureWire(() => Effect.succeed({ items: [] }));
      const first = observeAccount({
        store: counted,
        wire: fixture.wire,
        repairSession: Effect.void,
      });
      first.show("org");
      yield* until(() => listening === 1, "the first account to listen");
      expect(listening).toBe(1);

      first.stop();
      yield* until(
        () => listening === 0 && !streamOf(store.state(), linkKeys.zerops("org")).demanded,
        "the first account to let go",
      );
      expect(listening).toBe(0);
      expect(streamOf(store.state(), linkKeys.zerops("org")).demanded).toBe(false);

      const second = observeAccount({
        store: counted,
        wire: fixture.wire,
        repairSession: Effect.void,
      });
      second.show("org");
      yield* until(() => listening === 1, "the second account to listen");
      // Stopped and shown again (a remount): it observes again, once.
      second.stop();
      second.show("org");
      yield* until(() => listening === 1, "the remounted account to listen");
      second.stop();
    }),
  );
});

describe("observeAccount — closed with its account", () => {
  it.live("publishes nothing once closed, so the account's registry may go right after", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      const fixture = fixtureWire((request) =>
        Effect.succeed(
          request.method === "GET"
            ? { status: 200, body: { list: [] } }
            : request.body?.wsOutputType === "listStream"
              ? { items: [] }
              : {},
        ),
      );
      const account = observeAccount({ store, wire: fixture.wire, repairSession: Effect.void });
      const release = account.demandDetail({
        family: "process",
        listing: "history",
        ownerId: "p1",
      });
      account.show("org");
      yield* until(
        () => streamOf(store.state(), linkKeys.zerops("org")).demanded,
        "the link to be demanded",
      );
      registry.mount(store.data.stream(linkKeys.zerops("org")));

      account.close();
      // The account's registry goes at once; what the closed observation still does is silent:
      // a screen's release, a new hold, an interrupted link's last event.
      registry.dispose();
      release();
      account.demandDetail({ family: "process", listing: "history", ownerId: "p2" })();
      expect(() =>
        store.dispatch({
          kind: "stream",
          key: linkKeys.zerops("org"),
          now: 0,
          event: { kind: "demand", demanded: false },
        }),
      ).not.toThrow();
    }),
  );
});

describe("readDetail", () => {
  const AGENTS = { family: "serviceAgents", ownerId: "s1" } as const;
  const observe = (status: number | "lost") => {
    const store = makeAccountStore(AtomRegistry.make());
    // A service's agents are read by a search of their keys.
    const fixture = fixtureWire((request) =>
      request.path === "/user-data/search"
        ? status === 200
          ? Effect.succeed({ items: [] })
          : Effect.fail(
              status === "lost"
                ? ({ outcome: "transient", message: "HTTP 503" } as const)
                : ({ outcome: "authoritative-denial", message: "HTTP 403" } as const),
            )
        : Effect.succeed(request.body?.wsOutputType === "listStream" ? { items: [] } : {}),
    );
    return {
      store,
      fixture,
      account: observeAccount({ store, wire: fixture.wire, repairSession: Effect.void }),
    };
  };

  it.live.each([
    { status: 200, read: true, phase: "paused" },
    // A refusal is terminal for its input: letting it go leaves it refused, never read again.
    { status: 403, read: false, phase: "refused" },
    { status: "lost", read: false, phase: "paused" },
  ] as const)(
    "settles a read answered $status as read: $read, then lets it go",
    ({ status, read, phase }) =>
      Effect.gen(function* () {
        const { store, account } = observe(status);
        account.show("org");
        const answer = yield* Effect.promise(() => account.readDetail(AGENTS));
        expect(answer).toBe(read);
        yield* until(
          () => streamOf(store.state(), "zerops:org:agents:s1").phase === phase,
          `the read let go, ${phase}`,
        );
        account.stop();
      }),
  );

  it.live.each([
    { link: "down", outcome: "transient" },
    { link: "refused", outcome: "definitive-refusal" },
  ] as const)(
    "answers no read at once while the link is $link, never waits for it",
    ({ outcome }) =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const account = observeAccount({
          store,
          wire: { open: Effect.fail({ outcome, message: outcome }) },
          repairSession: Effect.void,
        });
        account.show("org");
        yield* until(
          () => streamOf(store.state(), linkKeys.zerops("org")).phase !== "connecting",
          "the link's first attempt to fail",
        );
        expect(yield* Effect.promise(() => account.readDetail(AGENTS))).toBe(false);
        account.stop();
      }),
  );

  it.live("answers no read with no organization shown, and reads nothing", () =>
    Effect.gen(function* () {
      const { fixture, account } = observe(200);
      expect(yield* Effect.promise(() => account.readDetail(AGENTS))).toBe(false);
      expect(fixture.requests).toEqual([]);
    }),
  );
});
