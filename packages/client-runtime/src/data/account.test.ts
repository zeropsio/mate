import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";

import { hqFixtureWire } from "./__fixtures__/hqWire.ts";
import { fixtureWire } from "./__fixtures__/zeropsWire.ts";
import { observeAccount, startZeropsNavigation } from "./account.ts";
import { hqAppsScope } from "./families/hqNavigation.ts";
import { historyScope, runningScope } from "./families/process.ts";
import { linkKeys, type OperationIntent } from "./model.ts";
import type { RegisteredOperationKind } from "./operations/kind.ts";
import { streamOf } from "./reducer.ts";
import { makeAccountStore } from "./store.ts";

/** The navigation runs on its own runtime: real time passes for it. */
const turns = Effect.sleep(20);

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
      yield* turns;
      expect(streamOf(store.state(), runningScope("org")).phase).toBe("live");

      navigation.stop();
      yield* turns;
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
        yield* turns;
        expect(reads()).toBe(0);

        account.show("org-a");
        yield* turns;
        expect(reads()).toBe(1);
        expect(streamOf(store.state(), historyScope("org-a", "p1")).phase).toBe("live");

        account.show("org-b");
        yield* turns;
        expect(reads()).toBe(2);
        expect(streamOf(store.state(), historyScope("org-a", "p1")).demanded).toBe(false);
        expect(streamOf(store.state(), historyScope("org-b", "p1")).phase).toBe("live");

        release();
        yield* turns;
        expect(streamOf(store.state(), historyScope("org-b", "p1")).demanded).toBe(false);
        account.show(null);
        yield* turns;
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
      yield* turns;
      expect(streamOf(store.state(), historyScope("org", "p1")).phase).toBe("live");
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
      yield* turns;
      expect(listening).toBe(1);

      first.stop();
      yield* turns;
      expect(listening).toBe(0);
      expect(streamOf(store.state(), linkKeys.zerops("org")).demanded).toBe(false);

      const second = observeAccount({
        store: counted,
        wire: fixture.wire,
        repairSession: Effect.void,
      });
      second.show("org");
      yield* turns;
      expect(listening).toBe(1);
      // Stopped and shown again (a remount): it observes again, once.
      second.stop();
      second.show("org");
      yield* turns;
      expect(listening).toBe(1);
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
      yield* turns;
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
      yield* turns;
    }),
  );
});

describe("an account's HQ", () => {
  const emptyZerops = () =>
    fixtureWire((request) =>
      Effect.succeed(request.body?.wsOutputType === "listStream" ? { items: [] } : {}),
    );

  it.live("is observed once its organization is shown and its HQ named, until either goes", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const account = observeAccount({
        store,
        wire: emptyZerops().wire,
        repairSession: Effect.void,
      });
      const hq = hqFixtureWire();
      // Named before its organization is shown: nothing opens until it is.
      account.showHq({ orgId: "org-a", wire: hq.wire });
      yield* turns;
      expect(hq.opens()).toBe(0);

      account.show("org-a");
      yield* turns;
      expect(hq.opens()).toBe(1);
      expect(streamOf(store.state(), hqAppsScope("org-a")).phase).toBe("baselining");

      account.show("org-b");
      yield* turns;
      expect(streamOf(store.state(), linkKeys.hq("org-a")).demanded).toBe(false);
      expect(streamOf(store.state(), hqAppsScope("org-a")).demanded).toBe(false);
      account.stop();
    }),
  );

  it.live("goes on over a new wire for the same organization, its scopes still demanded", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const account = observeAccount({
        store,
        wire: emptyZerops().wire,
        repairSession: Effect.void,
      });
      const first = hqFixtureWire();
      const second = hqFixtureWire();
      account.show("org-a");
      account.showHq({ orgId: "org-a", wire: first.wire });
      yield* turns;
      account.showHq({ orgId: "org-a", wire: second.wire });
      yield* turns;
      expect(streamOf(store.state(), hqAppsScope("org-a")).demanded).toBe(true);
      expect([first.opens(), second.opens()]).toEqual([1, 0]);
      yield* first.endSegment;
      yield* turns;
      expect([first.opens(), second.opens()]).toEqual([1, 1]);
      account.stop();
    }),
  );
});
