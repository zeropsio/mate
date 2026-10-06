import { describe, expect, it } from "@effect/vitest";
import type { HqScopeDelivery, HqStreamMessage } from "@t3tools/shared/hqStream";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/unstable/reactivity";

import { hqFixtureWire, type HqFixtureWire } from "../__fixtures__/hqWire.ts";
import { settle } from "../__fixtures__/zeropsWire.ts";
import { hqAppsScope, placementsScope } from "../families/hqNavigation.ts";
import { hqMateScope } from "../families/hqMate.ts";
import { linkKeys, type StreamKey } from "../model.ts";
import { factOf } from "../reducer.ts";
import { makeAccountStore, publicRead, readsOfState, type AccountStore } from "../store.ts";
import { superviseLink } from "../supervisor.ts";
import { classifyHqClose, HQ_SILENCE_MS, hqNavigationLink } from "./hq.ts";

const ORG = "org";
const NAVIGATION = { kind: "navigation" } as const;

const app = (id: string, name: string, projectIds: ReadonlyArray<string> = []) => ({
  id,
  name,
  can: {},
  contents: { empty: projectIds.length === 0, deletingProjectIds: [] },
  projectIds,
  births: [],
  environments: [],
  changes: [],
});
const project = (projectId: string, appId: string | null, mate = true) => ({
  projectId,
  appId,
  name: projectId,
  kind: "mate",
  mate: mate
    ? { face: "", madeBy: null, standupRequestedBy: null, closedOff: false, keyWider: false }
    : null,
  person: {
    role: "DEVELOPER",
    mayWrite: true,
    mine: false,
    ownerUserId: null,
    waitsOnViewer: false,
    unseen: null,
  },
  signers: {},
});

const navigation = (
  type: HqScopeDelivery["type"],
  revision: number,
  values: HqScopeDelivery["values"],
  removals: HqScopeDelivery["removals"] = [],
  incarnation = "i1",
): HqStreamMessage => ({ type, scope: NAVIGATION, incarnation, revision, values, removals });
const ready = (revision: number, incarnation = "i1"): HqStreamMessage => ({
  type: "scope-ready",
  scope: NAVIGATION,
  incarnation,
  revision,
});

const run = (store: AccountStore, fixture: HqFixtureWire) =>
  Effect.gen(function* () {
    const link = hqNavigationLink({ orgId: ORG, wire: fixture.wire, store });
    const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
    const fiber = yield* Effect.forkChild(supervisor.run);
    yield* settle;
    return { fiber, link, supervisor };
  });

const appName = (store: AccountStore, id: string) => {
  const read = publicRead(factOf(store.state(), "hqApp", id));
  return read.kind === "known" ? (read.value as { name: string }).name : read.kind;
};
const phase = (store: AccountStore, key: StreamKey) =>
  readsOfState(store.state()).stream(key).phase;

/** A link live with Shop and its Mate Ada at revision 3 of incarnation i1. */
const live = (store: AccountStore, fixture: HqFixtureWire) =>
  Effect.gen(function* () {
    const running = yield* run(store, fixture);
    yield* fixture.send(
      navigation("scope-reset", 3, [
        { key: "app:shop", value: app("shop", "Shop", ["ada"]) },
        { key: "project:ada", value: project("ada", "shop") },
      ]),
    );
    yield* fixture.send(ready(3));
    yield* settle;
    return running;
  });

const navigationRequests = (fixture: HqFixtureWire, segment: number) =>
  fixture.sent
    .filter(
      ({ request, segment: at }) =>
        at === segment &&
        (request.type === "subscribe" || request.type === "unsubscribe") &&
        request.scopes.some(
          (entry) => ("scope" in entry ? entry.scope : entry).kind === "navigation",
        ),
    )
    .map(({ request }) => request);

describe("hqNavigationLink", () => {
  it.effect("subscribes the navigation on open and is live once HQ's catchup ends", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* run(store, fixture);
      expect(fixture.sent.map(({ request }) => request)).toEqual([
        { type: "subscribe", scopes: [{ scope: NAVIGATION, knownKeys: [] }] },
      ]);
      expect(phase(store, hqAppsScope(ORG))).toBe("baselining");

      yield* fixture.send(
        navigation("scope-reset", 3, [
          { key: "app:shop", value: app("shop", "Shop", ["ada"]) },
          { key: "project:ada", value: project("ada", "shop") },
        ]),
      );
      yield* fixture.send(ready(3));
      yield* settle;
      expect(appName(store, "shop")).toBe("Shop");
      expect(phase(store, hqAppsScope(ORG))).toBe("live");
      expect(phase(store, placementsScope(ORG))).toBe("live");
      expect(readsOfState(store.state()).coverage(hqAppsScope(ORG))).toBe("complete");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect(
    "resumes the next segment from its cursor and the keys it holds, keeping its rows",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const { fiber } = yield* live(store, fixture);
        yield* fixture.endSegment;
        yield* settle;
        expect(fixture.opens()).toBe(2);
        expect(navigationRequests(fixture, 2)).toEqual([
          {
            type: "subscribe",
            scopes: [
              {
                scope: NAVIGATION,
                cursor: { incarnation: "i1", revision: 3 },
                knownKeys: ["app:shop", "project:ada"],
              },
              // The Mate HQ places is observed with the navigation, across segments too.
              { scope: { kind: "attention", projectId: "ada" }, knownKeys: [] },
            ],
          },
        ]);
        // An unchanged scope answers only that it is ready: nothing moves, nothing waits.
        yield* fixture.send(ready(3));
        yield* settle;
        expect(appName(store, "shop")).toBe("Shop");
        expect(phase(store, hqAppsScope(ORG))).toBe("live");
        expect(phase(store, linkKeys.hq(ORG))).toBe("live");
        yield* fixture.send(
          navigation("scope-values", 4, [
            { key: "app:shop", value: app("shop", "Shop 2", ["ada"]) },
          ]),
        );
        yield* settle;
        expect(appName(store, "shop")).toBe("Shop 2");
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect("never commits a delta that does not follow its cursor: the scope is asked whole", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* live(store, fixture);
      yield* fixture.send(
        navigation("scope-values", 5, [{ key: "app:shop", value: app("shop", "Gap", ["ada"]) }]),
      );
      yield* settle;
      expect(appName(store, "shop")).toBe("Shop");
      expect(navigationRequests(fixture, 1).slice(-2)).toEqual([
        { type: "unsubscribe", scopes: [NAVIGATION] },
        {
          type: "subscribe",
          scopes: [{ scope: NAVIGATION, knownKeys: ["app:shop", "project:ada"] }],
        },
      ]);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("a scope HQ refuses stays refused, its facts kept, until the person tries again", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber, supervisor } = yield* live(store, fixture);
      yield* fixture.send({
        type: "scope-error",
        scope: NAVIGATION,
        code: "zerops_refused",
        reason: "Zerops refused HQ.",
        disposition: "refused",
      });
      yield* settle;
      expect(phase(store, hqAppsScope(ORG))).toBe("refused");
      expect(store.state().streams.get(hqAppsScope(ORG))?.fault?.code).toBe("zerops_refused");
      expect(appName(store, "shop")).toBe("Shop");
      // A segment's end does not ask a refused scope again.
      yield* fixture.endSegment;
      yield* settle;
      expect(navigationRequests(fixture, 2)).toEqual([]);
      yield* supervisor.signal("manual-retry");
      yield* settle;
      expect(navigationRequests(fixture, 2)).toEqual([
        {
          type: "subscribe",
          scopes: [
            {
              scope: NAVIGATION,
              cursor: { incarnation: "i1", revision: 3 },
              knownKeys: ["app:shop", "project:ada"],
            },
          ],
        },
      ]);
      expect(fixture.sent.filter(({ request }) => request.type === "retry")).toEqual([
        { segment: 2, request: { type: "retry", scopes: [NAVIGATION] } },
      ]);
      expect(phase(store, hqAppsScope(ORG))).toBe("baselining");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("observes each placed Mate's attention, and lets it go once HQ places it no more", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* live(store, fixture);
      const attention = { kind: "attention", projectId: "ada" } as const;
      expect(fixture.sent.at(-1)?.request).toEqual({
        type: "subscribe",
        scopes: [{ scope: attention, knownKeys: [] }],
      });
      const value = {
        presence: { online: true, since: "2026-10-06T00:00:00Z", overview: "live" },
        overview: null,
        attention: null,
        attentionState: "none",
      };
      yield* fixture.send({
        type: "scope-reset",
        scope: attention,
        incarnation: "a1",
        revision: 1,
        values: [{ key: "ada", value }],
        removals: [],
      });
      yield* fixture.send({
        type: "scope-ready",
        scope: attention,
        incarnation: "a1",
        revision: 1,
      });
      yield* settle;
      expect(publicRead(factOf(store.state(), "hqMate", "ada"))).toMatchObject({
        kind: "known",
        value,
      });
      expect(phase(store, hqMateScope(ORG, "ada"))).toBe("live");
      yield* fixture.send(
        navigation("scope-values", 4, [], [{ key: "project:ada", reason: "deleted" }]),
      );
      yield* settle;
      yield* settle;
      expect(fixture.sent.at(-1)?.request).toEqual({ type: "unsubscribe", scopes: [attention] });
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("asks where a Mate may move when asked, on the open socket", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber, link } = yield* live(store, fixture);
      const asked = yield* Effect.forkChild(link.moveOffers("ada"));
      yield* settle;
      const request = fixture.sent.at(-1)?.request;
      expect(request).toMatchObject({ type: "move-offers", projectId: "ada" });
      yield* fixture.send({
        type: "move-offers",
        requestId: (request as { requestId: string }).requestId,
        projectId: "ada",
        moveTo: { shop: ["allowed"] },
      });
      expect(yield* Fiber.join(asked)).toEqual({ shop: ["allowed"] });
      yield* Fiber.interrupt(fiber);
    }),
  );
});

describe("asking HQ on the open socket", () => {
  it.effect("asks whom a Mate may be handed over to, and hands HQ's refusal back", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber, link } = yield* live(store, fixture);
      const asked = yield* Effect.forkChild(link.handoverCandidates("ada"));
      yield* settle;
      const request = fixture.sent.at(-1)?.request as { type: string; requestId: string };
      expect(request).toMatchObject({ type: "handover-candidates", projectId: "ada" });
      const candidate = { userId: "u1", name: "Jan", clientUserId: "cu1", avatarUrl: null };
      yield* fixture.send({
        type: "handover-candidates",
        requestId: request.requestId,
        projectId: "ada",
        candidates: [candidate],
      });
      expect(yield* Fiber.join(asked)).toEqual([candidate]);
      const refused = yield* Effect.forkChild(Effect.flip(link.handoverCandidates("ada")));
      yield* settle;
      const second = fixture.sent.at(-1)?.request as { requestId: string };
      yield* fixture.send({
        type: "handover-candidates-error",
        requestId: second.requestId,
        projectId: "ada",
        code: "forbidden",
        reason: null,
        disposition: "refused",
      });
      expect((yield* Fiber.join(refused)).outcome).toBe("definitive-refusal");
      yield* Fiber.interrupt(fiber);
    }),
  );
});

describe("an HQ outage", () => {
  it.effect("a socket that says nothing, not even a ping, is given up and asked again", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* live(store, fixture);
      // HQ pings every 20 s: a minute of silence is a socket that no longer carries anything.
      yield* TestClock.adjust(HQ_SILENCE_MS - 1);
      expect(fixture.opens()).toBe(1);
      yield* fixture.send({ type: "ping" });
      yield* TestClock.adjust(HQ_SILENCE_MS - 1);
      expect(fixture.opens()).toBe(1);
      yield* TestClock.adjust(1);
      yield* settle;
      expect(phase(store, linkKeys.hq(ORG))).toBe("recovering");
      expect(appName(store, "shop")).toBe("Shop");
      yield* TestClock.adjust(1_000);
      yield* settle;
      expect(fixture.opens()).toBe(2);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("keeps every fact while down, then resumes each scope from its cursor", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* live(store, fixture);
      yield* fixture.drop({ outcome: "transient", message: "HQ's stream broke." });
      yield* settle;
      expect(phase(store, linkKeys.hq(ORG))).toBe("recovering");
      expect(phase(store, hqAppsScope(ORG))).toBe("stale");
      expect(appName(store, "shop")).toBe("Shop");
      yield* TestClock.adjust(1_000);
      yield* settle;
      expect(fixture.opens()).toBe(2);
      expect(navigationRequests(fixture, 2)).toEqual([
        {
          type: "subscribe",
          scopes: [
            {
              scope: NAVIGATION,
              cursor: { incarnation: "i1", revision: 3 },
              knownKeys: ["app:shop", "project:ada"],
            },
            { scope: { kind: "attention", projectId: "ada" }, knownKeys: [] },
          ],
        },
      ]);
      yield* fixture.send(ready(3));
      yield* settle;
      expect(phase(store, hqAppsScope(ORG))).toBe("live");
      yield* Fiber.interrupt(fiber);
    }),
  );
});

describe("an HQ session", () => {
  it.effect(
    "is renewed once; a renewed socket ended for its session before it said anything refuses",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const { fiber } = yield* run(store, fixture);
        const sessionEnded = { outcome: "recoverable-session", message: "4401" } as const;
        yield* fixture.drop(sessionEnded);
        yield* settle;
        expect(fixture.opens()).toBe(2);
        yield* fixture.drop(sessionEnded);
        yield* settle;
        expect(phase(store, linkKeys.hq(ORG))).toBe("refused");
        expect(fixture.opens()).toBe(2);
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect("HQ refusing the whole socket (4403) is asked again only with the person's retry", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber, supervisor } = yield* live(store, fixture);
      yield* fixture.drop({ outcome: "definitive-refusal", message: "4403" });
      yield* settle;
      yield* TestClock.adjust(120_000);
      yield* settle;
      expect(phase(store, linkKeys.hq(ORG))).toBe("refused");
      expect(fixture.opens()).toBe(1);
      expect(appName(store, "shop")).toBe("Shop");
      yield* supervisor.signal("manual-retry");
      yield* settle;
      expect(fixture.opens()).toBe(2);
      expect(fixture.sent.filter(({ segment }) => segment === 2)[0]?.request).toEqual({
        type: "retry",
      });
      yield* Fiber.interrupt(fiber);
    }),
  );
});

describe("classifyHqClose", () => {
  it.each([
    { code: 4403, outcome: "definitive-refusal" },
    { code: 4401, outcome: "recoverable-session" },
    { code: 1011, outcome: "transient" },
    { code: 1006, outcome: "transient" },
  ])("$code is $outcome", ({ code, outcome }) => {
    expect(classifyHqClose(code).outcome).toBe(outcome);
  });
});
