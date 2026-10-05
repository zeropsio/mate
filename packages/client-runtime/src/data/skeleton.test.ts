/**
 * The walking skeleton end to end: Zerops and HQ adapters under their supervisors, an open Mate's
 * attention, one store, and menu rows mounted the way a component would read them.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry, type Atom } from "effect/unstable/reactivity";

import type { MateLiveView } from "@t3tools/shared/hqMates";

import { HqError } from "../zerops/hq/client.ts";
import type { HqStructureEvent } from "../zerops/hq/stream.ts";
import { attentionOf, liveMate } from "./__fixtures__/account.ts";
import { fixtureWire, settle, type WireRequest } from "./__fixtures__/zeropsWire.ts";
import { hqNavigationLink, type HqStructureSource } from "./adapters/hq.ts";
import { classifyHttp, zeropsNavigationLink } from "./adapters/zerops.ts";
import { scopeKeys } from "./model.ts";
import { menuRow, menuRowKeys, type MenuRow } from "./projections/navigation.ts";
import { makeAccountStore, type AccountStore } from "./store.ts";
import { STREAM_POLICY } from "./streamMachine.ts";
import { superviseLink, type LinkSupervisor } from "./supervisor.ts";

const ORG = "org";
const SHOP = { orgId: ORG, row: { kind: "app", appId: "shop" } } as const;

const projectRow = (id: string) => ({ id, name: `${id} name`, status: "ACTIVE", _version: 1 });

function zerops(projects: ReadonlyArray<string>, refuse: () => boolean = () => false) {
  return fixtureWire((request: WireRequest) =>
    refuse()
      ? Effect.fail(classifyHttp(403))
      : Effect.succeed(
          request.body?.wsOutputType === "updateStream"
            ? { success: true }
            : { items: request.path === "/project/search" ? projects.map(projectRow) : [] },
        ),
  );
}

function hq() {
  let handlers: Parameters<HqStructureSource["streamStructure"]>[0] | null = null;
  let fail: (error: unknown) => void = () => {};
  const source: HqStructureSource = {
    streamStructure: (next, signal) =>
      new Promise<void>((resolve, reject) => {
        handlers = next;
        fail = reject;
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
  };
  return {
    source,
    emit: (event: HqStructureEvent) =>
      Effect.sync(() => {
        handlers?.onAlive();
        handlers?.onEvent(event);
      }),
    fail: (error: unknown) => Effect.sync(() => fail(error)),
  };
}

const relayed = (latestChatId: string, working: number): MateLiveView =>
  ({
    presence: { online: true, since: "2026-10-05T19:00:00Z", overview: "live" },
    main: null,
    threads: {
      list: [
        ...Array.from({ length: working }, (_, index) => ({
          id: `busy-${index}`,
          title: "",
          kind: "working",
          turnId: null,
          turnState: null,
          completedAt: null,
        })),
        {
          id: latestChatId,
          title: "",
          kind: "idle",
          turnId: null,
          turnState: null,
          completedAt: null,
        },
      ].toReversed(),
      omitted: 0,
    },
  }) as never;

/** HQ's change of a Mate's chats: one more, the counts as they were. */
const newChat = (latestChatId: string) => {
  const { threads } = relayed(latestChatId, 1);
  return threads === undefined ? {} : { threads };
};

const snapshot = (mates: ReadonlyMap<string, MateLiveView>): HqStructureEvent => ({
  kind: "snapshot",
  structure: {
    ungrouped: [],
    apps: [
      {
        id: "shop",
        name: "Shop",
        projects: [
          { projectId: "m1", name: "m1", kind: "mate", mate: { face: "" } },
          { projectId: "s1", name: "s1", kind: "stage", mate: null },
        ],
      },
    ],
  },
  changes: null,
  appReads: null,
  mates,
  people: null,
});

/** The last started supervisors: Zerops', then HQ's. */
const supervisors: LinkSupervisor[] = [];

/** Both sources under their supervisors, as the account runtime will start them. */
const start = (
  store: AccountStore,
  wire: ReturnType<typeof zerops>,
  relay: ReturnType<typeof hq>,
) =>
  Effect.gen(function* () {
    let next = 0;
    const links = [
      zeropsNavigationLink({
        orgId: ORG,
        wire: wire.wire,
        store,
        makeId: () => `sub-${(next += 1)}`,
      }),
      hqNavigationLink({ orgId: ORG, source: relay.source, store }),
    ];
    const fibers: Array<Fiber.Fiber<never>> = [];
    supervisors.length = 0;
    for (const link of links) {
      const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
      supervisors.push(supervisor);
      fibers.push(yield* Effect.forkChild(supervisor.run));
    }
    yield* settle;
    return fibers;
  });

/** A component's read: mounted, re-read whenever it says it changed. */
function render<Value>(registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<Value>) {
  const seen: Value[] = [];
  registry.subscribe(atom, () => seen.push(registry.get(atom)), { immediate: true });
  return { latest: () => seen.at(-1)!, count: () => seen.length };
}

describe("the walking skeleton", () => {
  it.effect("keeps the menu row usable while HQ is down and Zerops and an open Mate run", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      const wire = zerops(["m1", "s1"]);
      const relay = hq();
      const fibers = yield* start(store, wire, relay);
      liveMate("m1", attentionOf({ working: 1, latestChatId: "c1" }), 4).forEach(store.dispatch);
      yield* relay.emit(snapshot(new Map([["m1", relayed("c0", 0)]])));

      const shop = render(registry, store.data.project(menuRow, SHOP));
      const keys = render(registry, store.data.project(menuRowKeys, ORG));
      expect(keys.latest()).toEqual([{ kind: "app", appId: "shop" }]);
      expect(shop.latest().status).toEqual({ display: "live", lagging: [] });

      yield* relay.fail(new HqError({ kind: "unavailable", code: "network", message: "down" }));
      yield* settle;
      // Work starts on the stage while HQ is away: Zerops alone lights it.
      yield* wire.push(wire.subscription("/process/search", "updateStream"), {
        update: [{ id: "deploy", projectId: "s1", status: "RUNNING", _version: 1 }],
      });
      yield* settle;

      const row: MenuRow = shop.latest();
      expect(row.title).toEqual({ kind: "ready", value: "Shop", fresh: false });
      expect(row.running).toEqual({ kind: "ready", value: true, fresh: true });
      expect(
        row.projects.map((project) => [project.projectId, project.name, project.attention]),
      ).toEqual([
        [
          "m1",
          { kind: "ready", value: "m1 name", fresh: true },
          { kind: "ready", value: attentionOf({ working: 1, latestChatId: "c1" }), fresh: true },
        ],
        ["s1", { kind: "ready", value: "s1 name", fresh: true }, null],
      ]);
      expect(row.status).toEqual({
        display: "catching-up",
        lagging: [{ input: scopeKeys.navigation(ORG), phase: "stale" }],
      });
      expect(store.state().streams.get(scopeKeys.hqLink(ORG))?.phase).toBe("recovering");
      for (const fiber of fibers) yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("shows a new chat with unchanged counts, and a late relay never undoes it", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      const relay = hq();
      const fibers = yield* start(store, zerops(["m1", "s1"]), relay);
      yield* relay.emit(snapshot(new Map([["m1", relayed("c1", 1)]])));
      const shop = render(registry, store.data.project(menuRow, SHOP));
      const attention = () => shop.latest().projects[0]?.attention;

      // Unopened: a new chat through HQ moves the row though the counts stay.
      yield* relay.emit({ kind: "mate", projectId: "m1", value: newChat("c2") });
      expect(attention()).toMatchObject({ value: { working: 1, latestChatId: "c2" } });

      // Opened: the Mate's own value, then its next one; HQ's relay of an older one comes late.
      liveMate("m1", attentionOf({ working: 1, latestChatId: "c2" }), 7).forEach(store.dispatch);
      store.dispatch({
        kind: "rows",
        scope: scopeKeys.attention("m1"),
        generation: 1,
        method: "push",
        via: "mate-direct",
        rows: [
          {
            family: "attention",
            id: "m1",
            value: attentionOf({ working: 1, latestChatId: "c3" }),
            revision: { kind: "mate-attention", incarnation: "inc-1", revision: 8 },
          },
        ],
      });
      expect(attention()).toMatchObject({ value: { working: 1, latestChatId: "c3" }, fresh: true });
      const renders = shop.count();

      yield* relay.emit({ kind: "mate", projectId: "m1", value: newChat("c2") });
      expect(attention()).toMatchObject({ value: { latestChatId: "c3" } });
      expect(shop.count()).toBe(renders);
      for (const fiber of fibers) yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect(
    "shows the row refused, never catching up, when Zerops refuses the re-registration",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const store = makeAccountStore(registry);
        let refuse = false;
        const wire = zerops(["m1", "s1"], () => refuse);
        const relay = hq();
        const fibers = yield* start(store, wire, relay);
        yield* relay.emit(snapshot(new Map()));
        const shop = render(registry, store.data.project(menuRow, SHOP));
        expect(shop.latest().status.display).toBe("live");

        refuse = true;
        yield* wire.drop({ outcome: "transient", message: "socket closed" });
        yield* settle;
        const link = store.state().streams.get(scopeKeys.zeropsLink(ORG));
        yield* TestClock.adjust(link?.next.kind === "retry" ? link.next.at : 0);
        yield* settle;

        expect(store.state().streams.get(scopeKeys.zeropsLink(ORG))?.phase).toBe("refused");
        expect(store.state().streams.get(scopeKeys.projects(ORG))?.phase).toBe("refused");
        expect(shop.latest().status.display).toBe("refused");
        expect(shop.latest().projects[0]?.name).toMatchObject({ kind: "ready", value: "m1 name" });

        // Time and the link's own attempts revive nothing; the person's try-now revives it all.
        yield* TestClock.adjust("1 hour");
        expect(store.state().streams.get(scopeKeys.projects(ORG))?.phase).toBe("refused");
        refuse = false;
        yield* supervisors[0]!.signal("manual-retry");
        yield* settle;
        expect(store.state().streams.get(scopeKeys.projects(ORG))?.phase).toBe("live");
        expect(store.state().streams.get(scopeKeys.running(ORG))?.phase).toBe("live");
        expect(shop.latest().status.display).toBe("live");
        for (const fiber of fibers) yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect("leaves an unplaced project partial, not catching up, when HQ refuses the reader", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      const relay = hq();
      const fibers = yield* start(store, zerops(["p9"]), relay);
      yield* relay.fail(
        new HqError({ kind: "refused", code: "forbidden", message: "Not a member of HQ." }),
      );
      yield* settle;
      const row = render(
        registry,
        store.data.project(menuRow, { orgId: ORG, row: { kind: "project", projectId: "p9" } }),
      );
      expect(store.state().streams.get(scopeKeys.navigation(ORG))?.phase).toBe("refused");
      expect(row.latest().title).toEqual({ kind: "ready", value: "p9 name", fresh: true });
      expect(row.latest().status.display).toBe("partial");
      for (const fiber of fibers) yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect(
    "ends an attempt whose HQ socket only pings once the scope's baseline deadline passes",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        let opened = 0;
        const pinging: HqStructureSource = {
          streamStructure: (handlers, signal) =>
            new Promise<void>((resolve) => {
              opened += 1;
              handlers.onAlive();
              signal.addEventListener("abort", () => resolve(), { once: true });
            }),
        };
        const supervisor = yield* superviseLink({
          ...hqNavigationLink({ orgId: ORG, source: pinging, store }),
          store,
          repairSession: Effect.void,
        });
        const fiber = yield* Effect.forkChild(supervisor.run);
        yield* settle;
        expect(store.state().streams.get(scopeKeys.navigation(ORG))?.phase).toBe("baselining");
        yield* TestClock.adjust(STREAM_POLICY.baselineTimeoutMs);
        yield* settle;
        expect(store.state().streams.get(scopeKeys.hqLink(ORG))?.phase).toBe("recovering");
        expect(store.state().streams.get(scopeKeys.navigation(ORG))?.phase).toBe("stale");
        const link = store.state().streams.get(scopeKeys.hqLink(ORG));
        yield* TestClock.adjust(
          link?.next.kind === "retry" ? link.next.at - STREAM_POLICY.baselineTimeoutMs : 0,
        );
        yield* settle;
        expect(opened).toBe(2);
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect(
    "ends an attempt whose Zerops registration hangs once its baseline deadline passes",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const wire = fixtureWire((request) =>
          request.path === "/process/search" && request.body?.wsOutputType === "listStream"
            ? Effect.never
            : Effect.succeed(
                request.body?.wsOutputType === "updateStream" ? { success: true } : { items: [] },
              ),
        );
        const supervisor = yield* superviseLink({
          ...zeropsNavigationLink({ orgId: ORG, wire: wire.wire, store, makeId: () => "sub" }),
          store,
          repairSession: Effect.void,
        });
        const fiber = yield* Effect.forkChild(supervisor.run);
        yield* settle;
        expect(store.state().streams.get(scopeKeys.running(ORG))?.phase).toBe("baselining");

        yield* TestClock.adjust(STREAM_POLICY.baselineTimeoutMs);
        yield* settle;
        expect(store.state().streams.get(scopeKeys.zeropsLink(ORG))?.phase).toBe("recovering");
        expect(store.state().streams.get(scopeKeys.running(ORG))?.phase).toBe("stale");
        yield* Fiber.interrupt(fiber);
      }),
  );
});
