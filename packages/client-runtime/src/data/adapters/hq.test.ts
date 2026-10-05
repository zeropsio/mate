import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { AtomRegistry } from "effect/unstable/reactivity";

import type { MateLiveView } from "@t3tools/shared/hqMates";

import { settle } from "../__fixtures__/zeropsWire.ts";
import { HqError, type HqStructure } from "../../zerops/hq/client.ts";
import type { HqStructureEvent } from "../../zerops/hq/stream.ts";
import { scopeKeys } from "../model.ts";
import { makeAccountStore, type AccountStore } from "../store.ts";
import { superviseLink } from "../supervisor.ts";
import { hqNavigationLink, type HqStructureSource } from "./hq.ts";

const ORG = "org";
const NAVIGATION = scopeKeys.navigation(ORG);

/** Today's HQ stream, driven by the test: one call per socket, ended by the test. */
function fixtureHq() {
  const calls: Array<{
    readonly handlers: Parameters<HqStructureSource["streamStructure"]>[0];
    readonly fail: (error: unknown) => void;
  }> = [];
  const source: HqStructureSource = {
    streamStructure: (handlers, signal) =>
      new Promise<void>((resolve, reject) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
        calls.push({ handlers, fail: reject });
      }),
  };
  const current = () => {
    const call = calls.at(-1);
    if (call === undefined) throw new Error("HQ's stream is not open.");
    return call;
  };
  return {
    source,
    calls,
    emit: (event: HqStructureEvent) =>
      Effect.sync(() => {
        current().handlers.onAlive();
        current().handlers.onEvent(event);
      }),
    fail: (error: unknown) => Effect.sync(() => current().fail(error)),
  };
}

const mate = (projectId: string) => ({
  projectId,
  name: projectId,
  kind: "mate",
  mate: { face: "" },
});

const structure = (apps: HqStructure["apps"]): HqStructure => ({ ungrouped: [], apps });

const snapshot = (
  apps: HqStructure["apps"],
  mates: ReadonlyMap<string, MateLiveView> | null = null,
): HqStructureEvent => ({
  kind: "snapshot",
  structure: structure(apps),
  changes: null,
  appReads: null,
  mates,
  people: null,
});

const run = (store: AccountStore, hq: ReturnType<typeof fixtureHq>, repairs: { count: number }) =>
  Effect.gen(function* () {
    const link = hqNavigationLink({ orgId: ORG, source: hq.source, store });
    const supervisor = yield* superviseLink({
      ...link,
      store,
      repairSession: Effect.sync(() => {
        repairs.count += 1;
      }),
    });
    const fiber = yield* Effect.forkChild(supervisor.run);
    yield* settle;
    return fiber;
  });

describe("hqNavigationLink", () => {
  it.effect("takes the snapshot as the navigation baseline and a change as placements", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const hq = fixtureHq();
      const fiber = yield* run(store, hq, { count: 0 });
      expect(store.state().streams.get(NAVIGATION)?.phase).toBe("baselining");

      yield* hq.emit(
        snapshot([
          {
            id: "shop",
            name: "Shop",
            projects: [mate("m1"), { ...mate("s1"), kind: "stage", mate: null }],
          },
        ]),
      );
      expect(store.state().streams.get(NAVIGATION)?.phase).toBe("live");
      expect(store.state().apps.get("shop")).toEqual(new Set(["m1", "s1"]));
      expect(store.state().placement.get("s1")?.content).toEqual({
        kind: "value",
        value: { kind: "app", appId: "shop", appName: "Shop", role: "stage" },
      });

      yield* hq.emit({
        kind: "change",
        appId: "shop",
        app: { id: "shop", name: "Shop", projects: [mate("m1")] },
      });
      expect(store.state().apps.get("shop")).toEqual(new Set(["m1"]));
      expect(store.state().placement.get("s1")?.content.kind).toBe("value");

      yield* hq.emit({ kind: "change", appId: "shop", app: null });
      expect(store.state().apps.get("shop")).toEqual(new Set());
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("repairs an ended session once instead of refusing for good, keeping placements", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const hq = fixtureHq();
      const repairs = { count: 0 };
      const fiber = yield* run(store, hq, repairs);
      yield* hq.emit(snapshot([{ id: "shop", name: "Shop", projects: [mate("m1")] }]));

      yield* hq.fail(
        new HqError({
          kind: "refused",
          code: "session_required",
          status: 401,
          message: "HQ's session ended. Try again to enter its door.",
        }),
      );
      yield* settle;
      expect(repairs.count).toBe(1);
      expect(hq.calls).toHaveLength(2);
      expect(store.state().streams.get(NAVIGATION)?.phase).toBe("baselining");
      expect(store.state().apps.get("shop")).toEqual(new Set(["m1"]));
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect(
    "relays a Mate's attention with its producer leg, merges changes, withholds on loss",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const hq = fixtureHq();
        const fiber = yield* run(store, hq, { count: 0 });
        yield* hq.emit(
          snapshot(
            [{ id: "shop", name: "Shop", projects: [mate("m1")] }],
            new Map([["m1", view({ online: true, threads: [thread("c1", "working")] })]]),
          ),
        );
        expect(store.state().attention.get("m1")).toMatchObject({
          content: { value: { working: 1, waiting: 0, latestChatId: "c1" } },
          producer: "up",
        });

        // A new chat with the counts unchanged still moves the value.
        yield* hq.emit({
          kind: "mate",
          projectId: "m1",
          value: { threads: { list: [thread("c2", "idle"), thread("c1", "working")], omitted: 0 } },
        });
        expect(store.state().attention.get("m1")).toMatchObject({
          content: { value: { working: 1, latestChatId: "c2" } },
          revision: { sequence: 3 },
        });

        yield* hq.emit({
          kind: "mate",
          projectId: "m1",
          value: { presence: { online: false, since: "2026-10-05T20:00:00Z", overview: "stored" } },
        });
        expect(store.state().attention.get("m1")?.producer).toBe("down");

        yield* hq.emit({ kind: "mate", projectId: "m1", value: null });
        expect(store.state().attention.get("m1")).toMatchObject({
          content: { kind: "purged" },
          access: "denied",
        });
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect("keeps a project that moved between applications, whichever change comes first", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const hq = fixtureHq();
      const fiber = yield* run(store, hq, { count: 0 });
      yield* hq.emit(
        snapshot([
          { id: "shop", name: "Shop", projects: [mate("m1"), mate("m2")] },
          { id: "blog", name: "Blog", projects: [] },
        ]),
      );

      // The new home's change first, then the old home's without it.
      yield* hq.emit({
        kind: "change",
        appId: "blog",
        app: { id: "blog", name: "Blog", projects: [mate("m1")] },
      });
      yield* hq.emit({
        kind: "change",
        appId: "shop",
        app: { id: "shop", name: "Shop", projects: [mate("m2")] },
      });
      expect(store.state().memberships.get(NAVIGATION)?.members.get("m1")).toBe("member");
      expect(store.state().apps.get("blog")).toEqual(new Set(["m1"]));
      expect(store.state().apps.get("shop")).toEqual(new Set(["m2"]));

      // Out of every application into none, the ungrouped list first.
      yield* hq.emit({ kind: "ungrouped", mates: [{ ...mate("m2"), mate: { face: "" } }] });
      yield* hq.emit({
        kind: "change",
        appId: "shop",
        app: { id: "shop", name: "Shop", projects: [] },
      });
      expect(store.state().memberships.get(NAVIGATION)?.members.get("m2")).toBe("member");
      expect(store.state().placement.get("m2")?.content).toMatchObject({
        value: { kind: "outside" },
      });
      yield* Fiber.interrupt(fiber);
    }),
  );
});

function thread(id: string, kind: "working" | "idle" | "approval") {
  return { id, title: id, kind, turnId: null, turnState: null, completedAt: null } as never;
}

function view(input: { readonly online: boolean; readonly threads: ReadonlyArray<never> }) {
  return {
    presence: { online: input.online, since: "2026-10-05T19:00:00Z", overview: "live" },
    threads: { list: input.threads, omitted: 0 },
  } as MateLiveView;
}
