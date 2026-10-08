import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";

import { hqFixtureWire } from "./__fixtures__/hqWire.ts";
import { fixtureWire } from "./__fixtures__/zeropsWire.ts";
import { observeAccount, startZeropsNavigation } from "./account.ts";
import { hqAppsScope } from "./families/hqNavigation.ts";
import { historyScope, runningScope } from "./families/process.ts";
import { linkKeys, type OperationIntent } from "./model.ts";
import type { RegisteredOperationKind } from "./operations/kind.ts";
import { autoUpdatePolicySettings } from "./projections/hqAutoUpdatePolicy.ts";
import { hqVerdict } from "./projections/hqVerdict.ts";
import { streamOf } from "./reducer.ts";
import { makeAccountStore, readsOfState } from "./store.ts";

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

  it.live("renews each held project's own row once, and no other held detail", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire((request) =>
        Effect.succeed(
          request.method === "GET"
            ? {
                status: 200,
                body: request.path.endsWith("/process?limit=100")
                  ? { list: [] }
                  : { id: request.path.split("/").at(-1), name: "p", status: "ACTIVE" },
              }
            : request.body?.wsOutputType === "listStream"
              ? { items: [] }
              : {},
        ),
      );
      const account = observeAccount({ store, wire: fixture.wire, repairSession: Effect.void });
      const reads = (path: string) =>
        fixture.requests.filter((request) => request.path === path).length;
      account.renewHeld();
      account.show("org");
      account.demandDetail({ family: "project", listing: "project", ownerId: "p1" });
      account.demandDetail({ family: "project", listing: "project", ownerId: "p2" });
      account.demandDetail({ family: "process", listing: "history", ownerId: "p1" });
      yield* until(
        () =>
          reads("/project/p1") === 1 &&
          reads("/project/p2") === 1 &&
          reads(HISTORY_PATH) === 1 &&
          streamOf(store.state(), "zerops:org:project:p2").phase === "live" &&
          streamOf(store.state(), "zerops:org:project:p1").phase === "live",
        "the held details to be read",
      );

      account.renewHeld();
      yield* until(
        () => reads("/project/p1") === 2 && reads("/project/p2") === 2,
        "the own rows to be renewed",
      );
      yield* Effect.sleep(20);
      expect([reads("/project/p1"), reads("/project/p2"), reads(HISTORY_PATH)]).toEqual([2, 2, 1]);
      account.show(null);
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
      expect(registry.getNodes().size).toBe(0);
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

describe("an account's HQ", () => {
  /** The HQ link runs on its own runtime: a moment of real time for it to act. */
  const turns = Effect.sleep(20);
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

  it.live("replacing HQ accepts its default policy and fences the previous owner's answers", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const account = observeAccount({
        store,
        wire: emptyZerops().wire,
        repairSession: Effect.void,
      });
      const old = hqFixtureWire();
      const fresh = hqFixtureWire();
      const current = () =>
        autoUpdatePolicySettings.derive(readsOfState(store.state()), {
          orgId: "org-a",
          admin: true,
        });
      const deliver = (
        wire: ReturnType<typeof hqFixtureWire>,
        incarnation: string,
        revision: number,
        enabled: boolean,
      ) =>
        Effect.andThen(
          wire.send({
            type: "scope-reset",
            scope: { kind: "navigation" },
            incarnation,
            revision,
            values: [{ key: "auto-update-policy", value: { orgId: "org-a", enabled, revision } }],
            removals: [],
          }),
          wire.send({ type: "scope-ready", scope: { kind: "navigation" }, incarnation, revision }),
        );
      account.show("org-a");
      account.showHq({ orgId: "org-a", ownerId: "old-project", wire: old.wire });
      yield* turns;
      yield* deliver(old, "old-core", 8, false);
      yield* turns;
      expect(current()).toMatchObject({ enabled: false, editable: true });
      account.showHq({ orgId: "org-a", ownerId: "new-project", wire: fresh.wire });
      expect(current().editable).toBe(false);
      // A queued answer from the owner just removed must not restore an editable old value.
      yield* deliver(old, "old-core", 9, false);
      yield* turns;
      expect([old.opens(), fresh.opens()]).toEqual([1, 1]);
      yield* deliver(fresh, "new-core", 0, true);
      yield* turns;
      expect(current()).toMatchObject({ enabled: true, editable: true, words: "On" });
      yield* deliver(old, "old-core", 10, false);
      yield* turns;
      expect(current()).toMatchObject({ enabled: true, editable: true, words: "On" });
      account.stop();
    }),
  );

  it.live("named again in the same turn it was let go, keeps its one socket", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const account = observeAccount({
        store,
        wire: emptyZerops().wire,
        repairSession: Effect.void,
      });
      const hq = hqFixtureWire();
      account.show("org-a");
      account.showHq({ orgId: "org-a", wire: hq.wire });
      yield* turns;
      // A remount of what names the HQ lets it go and names it again at once.
      account.showHq(null);
      account.showHq({ orgId: "org-a", wire: hq.wire });
      yield* turns;
      expect(hq.opens()).toBe(1);
      expect(streamOf(store.state(), hqAppsScope("org-a")).demanded).toBe(true);
      account.showHq(null);
      yield* turns;
      expect(streamOf(store.state(), linkKeys.hq("org-a")).demanded).toBe(false);
      account.stop();
    }),
  );
  it.live("holds whether the organization has an official HQ as the account says it", () =>
    Effect.sync(() => {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      const account = observeAccount({
        store,
        wire: emptyZerops().wire,
        repairSession: Effect.void,
      });
      const verdict = () => registry.get(store.data.project(hqVerdict, "org-a"));
      // Said before its organization is shown: held once it is.
      account.showHq({ orgId: "org-a", verdict: "none" });
      expect(verdict()).toBe("pending");
      account.show("org-a");
      expect(verdict()).toBe("none");
      account.showHq({ orgId: "org-a", verdict: "pending" });
      expect(verdict()).toBe("pending");
      account.showHq({ orgId: "org-a", wire: hqFixtureWire().wire });
      expect(verdict()).toBe("official");
      account.showHq({ orgId: "org-a", verdict: "unreadable" });
      expect(verdict()).toBe("unreadable");
      account.stop();
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
