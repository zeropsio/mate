import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/unstable/reactivity";

import { fixtureWire, settle, type WireRequest } from "../__fixtures__/zeropsWire.ts";
import { ORGANIZATION_ID as ORG } from "../__fixtures__/zeropsOrg.ts";
import { usageScope } from "../families/usage.ts";
import { usageHistoryScope } from "../families/usageHistory.ts";
import { makeAccountStore } from "../store.ts";
import type { StreamFault } from "../streamMachine.ts";
import { superviseLink } from "../supervisor.ts";
import { factOf } from "../reducer.ts";
import { linkKeys } from "../model.ts";
import { zeropsNavigationLink } from "./zerops.ts";

const PROJECT = "p1";
const CURRENT = "/current-stats/group-by-search";
const usage = usageScope(ORG, PROJECT);
const USAGE = { family: "usage", ownerId: PROJECT } as const;

const container = (containerId: string, used: number) => ({
  serviceStackId: "s1",
  containerId,
  vCpu: { used, limit: 1 },
  ramGBytes: { used: 0.5, limit: 1 },
  diskGBytes: { used: 1, limit: 5 },
});

/** Navigation answers nothing listed; a metric registration answers `items`. */
function answers(items: () => ReadonlyArray<unknown>) {
  return (request: WireRequest): Effect.Effect<unknown, StreamFault> => {
    if (request.path === CURRENT) return Effect.succeed({ items: items() });
    if (request.body?.wsOutputType === "updateStream") return Effect.succeed({ success: true });
    return Effect.succeed({ items: [] });
  };
}

const registrationsOn = (fixture: ReturnType<typeof fixtureWire>, path: string) =>
  fixture.requests.filter((request) => request.path === path);

function counter() {
  let next = 0;
  return () => `sub-${(next += 1)}`;
}

const runLink = (
  store: ReturnType<typeof makeAccountStore>,
  fixture: ReturnType<typeof fixtureWire>,
) =>
  Effect.gen(function* () {
    const link = zeropsNavigationLink({ orgId: ORG, wire: fixture.wire, store, makeId: counter() });
    const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
    const fiber = yield* Effect.forkChild(supervisor.run);
    yield* settle;
    return { fiber, link };
  });

describe("a demanded query detail", () => {
  it.effect("registers a project's current use only once a screen demands it", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire(answers(() => [container("c1", 0.4)]));
      const { fiber, link } = yield* runLink(store, fixture);
      expect(registrationsOn(fixture, CURRENT)).toHaveLength(0);

      link.demandDetail(USAGE);
      yield* settle;
      const [registration] = registrationsOn(fixture, CURRENT);
      expect(registration?.body).toMatchObject({
        search: [
          { name: "clientId", operator: "eq", value: ORG },
          { name: "projectId", operator: "eq", value: PROJECT },
        ],
        groupBy: "containerId",
        receiverId: "receiver-1",
      });
      expect(store.state().streams.get(usage)?.phase).toBe("live");
      expect(store.state().memberships.get(usage)?.members.get("c1")).toBe("member");
      expect(factOf(store.state(), "usage", "c1")?.content).toMatchObject({
        value: { serviceId: "s1", vCpu: { used: 0.4, limit: 1 } },
      });
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect(
    "a frame listing the containers again replaces the use; one missing from it leaves",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = fixtureWire(answers(() => [container("c1", 0.4), container("c2", 0.1)]));
        const { fiber, link } = yield* runLink(store, fixture);
        link.demandDetail(USAGE);
        yield* settle;

        yield* fixture.push(subscriptionOf(fixture, CURRENT), {
          items: [container("c1", 0.9)],
          limit: 100,
          offset: 0,
        });
        yield* settle;
        const members = store.state().memberships.get(usage)?.members;
        expect(members?.get("c1")).toBe("member");
        expect(members?.get("c2")).toBe("removed");
        expect(factOf(store.state(), "usage", "c1")?.content).toMatchObject({
          value: { vCpu: { used: 0.9, limit: 1 } },
        });
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect("a released query is let go: its frames are dropped, a new hold registers again", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire(answers(() => [container("c1", 0.4)]));
      const { fiber, link } = yield* runLink(store, fixture);
      const release = link.demandDetail(USAGE);
      yield* settle;
      const released = subscriptionOf(fixture, CURRENT);

      release();
      yield* settle;
      expect(store.state().streams.get(usage)).toMatchObject({ phase: "paused", demanded: false });
      yield* fixture.push(released, { items: [container("c1", 0.9)] });
      yield* settle;
      expect(factOf(store.state(), "usage", "c1")?.content).toMatchObject({
        value: { vCpu: { used: 0.4 } },
      });

      link.demandDetail(USAGE);
      yield* settle;
      expect(registrationsOn(fixture, CURRENT)).toHaveLength(2);
      expect(store.state().streams.get(usage)?.phase).toBe("live");
      yield* fixture.push(released, { items: [] });
      yield* settle;
      expect(store.state().memberships.get(usage)?.members.get("c1")).toBe("member");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("a history frame corrects its bucket and adds the hour that began", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire((request) =>
        request.path === HISTORY
          ? Effect.succeed({ items: [bucket("10", 0.2), bucket("11", 0.3)] })
          : answers(() => [])(request),
      );
      const { fiber, link } = yield* runLink(store, fixture);
      link.demandDetail({ family: "usageHistory", ownerId: PROJECT });
      yield* settle;
      expect(registrationsOn(fixture, HISTORY)[0]?.body).toMatchObject({
        groupBy: "serviceStackId",
        timeGroupBy: "1h",
        limit: 24,
        receiverId: "receiver-1",
      });

      yield* fixture.push(subscriptionOf(fixture, HISTORY), {
        update: [bucket("11", 0.6), bucket("12", 0.1)],
      });
      yield* settle;
      const scope = usageHistoryScope(ORG, PROJECT);
      expect([...(store.state().memberships.get(scope)?.members ?? [])]).toEqual([
        ["s1|10|10:59", "member"],
        ["s1|11|11:59", "member"],
        ["s1|12|12:59", "member"],
      ]);
      expect(factOf(store.state(), "usageHistory", "s1|11|11:59")?.content).toMatchObject({
        value: { vCpuUsed: 0.6 },
      });
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect.each([
    { fault: { outcome: "authoritative-denial", message: "HTTP 403" }, phase: "refused" },
    { fault: { outcome: "definitive-refusal", message: "HTTP 400" }, phase: "refused" },
    { fault: { outcome: "transient", message: "HTTP 503" }, phase: "recovering" },
  ] as const)(
    "a query answered $fault.message is that scope's alone; navigation stays live",
    ({ fault, phase }) =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = fixtureWire((request) =>
          request.path === CURRENT ? Effect.fail(fault) : answers(() => [])(request),
        );
        const { fiber, link } = yield* runLink(store, fixture);
        link.demandDetail(USAGE);
        yield* settle;
        expect(store.state().streams.get(usage)).toMatchObject({ phase, fault });
        expect(store.state().streams.get(linkKeys.zerops(ORG))?.phase).toBe("live");
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect(
    "goes stale with its link, keeps what it read, and registers again when it returns",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = fixtureWire(answers(() => [container("c1", 0.4)]));
        const { fiber, link } = yield* runLink(store, fixture);
        link.demandDetail(USAGE);
        yield* settle;

        yield* fixture.drop({ outcome: "transient", message: "socket closed" });
        yield* settle;
        expect(store.state().streams.get(usage)?.phase).toBe("stale");
        expect(store.state().memberships.get(usage)?.members.get("c1")).toBe("member");

        const down = store.state().streams.get(linkKeys.zerops(ORG));
        yield* TestClock.adjust(down?.next.kind === "retry" ? down.next.at : 0);
        yield* settle;
        expect(
          registrationsOn(fixture, CURRENT).map((request) => request.body?.receiverId),
        ).toEqual(["receiver-1", "receiver-2"]);
        expect(store.state().streams.get(usage)?.phase).toBe("live");
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect("frames that race the answer wait for it, then replay over it", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const answered = yield* Deferred.make<void>();
      const fixture = fixtureWire((request) =>
        request.path === CURRENT
          ? Effect.as(Deferred.await(answered), { items: [container("c1", 0.4)] })
          : answers(() => [])(request),
      );
      const { fiber, link } = yield* runLink(store, fixture);
      link.demandDetail(USAGE);
      yield* settle;
      yield* fixture.push(subscriptionOf(fixture, CURRENT), { items: [container("c2", 0.7)] });
      yield* settle;
      expect(store.state().streams.get(usage)?.phase).toBe("baselining");

      yield* Deferred.succeed(answered, undefined);
      yield* settle;
      const members = store.state().memberships.get(usage)?.members;
      expect(members?.get("c2")).toBe("member");
      expect(members?.get("c1")).toBe("removed");
      expect(store.state().streams.get(usage)?.phase).toBe("live");
      yield* Fiber.interrupt(fiber);
    }),
  );
});

const HISTORY = "/stats-history/group-by-search";
const bucket = (hour: string, used: number) => ({
  serviceStackId: "s1",
  from: hour,
  till: `${hour}:59`,
  vCpuUsed: used,
  vCpuLimit: 1,
});

const subscriptionOf = (fixture: ReturnType<typeof fixtureWire>, path: string) =>
  String(registrationsOn(fixture, path).at(-1)?.body?.subscriptionName);
