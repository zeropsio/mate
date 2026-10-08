import { MateHealth } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { hqMateHealthScope } from "../families/mateHealth.ts";
import { hqMateSetup } from "../projections/hqMateSetup.ts";
import { describe, expect, it } from "@effect/vitest";
import type { MateAttention } from "@t3tools/contracts";
import type { HqScopeDelivery, HqStreamMessage } from "@t3tools/shared/hqStream";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/reactivity";

import { hqFixtureWire, type HqFixtureWire } from "../__fixtures__/hqWire.ts";
import { attention } from "../__fixtures__/mateAttention.ts";
import { settle } from "../__fixtures__/zeropsWire.ts";
import { hqAppsScope, placementsScope } from "../families/hqNavigation.ts";
import { hqMateScope } from "../families/hqMate.ts";
import { hqMateAttentionScope, mateAttentionScope } from "../families/mateAttention.ts";
import { linkKeys, type StreamKey } from "../model.ts";
import { factOf, streamOf } from "../reducer.ts";
import { makeAccountStore, publicRead, readsOfState, type AccountStore } from "../store.ts";
import { superviseLink } from "../supervisor.ts";
import { hqNavigation } from "../projections/hqNavigation.ts";
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
  releaseOffer: null,
});
const project = (projectId: string, appId: string | null, mate = true) => ({
  projectId,
  appId,
  name: projectId,
  kind: "mate",
  mate: mate
    ? {
        face: "",
        madeBy: null,
        standupRequestedBy: null,
        closedOff: false,
        setupMarker: null,
        keyWider: false,
      }
    : null,
  person: {
    role: "DEVELOPER",
    mayWrite: true,
    mine: false,
    ownerUserId: null,
    waitsOnViewer: false,
    unseen: null,
  },
  signedInNow: {},
  everSignedIn: {},
});

const navigation = (
  type: HqScopeDelivery["type"],
  revision: number,
  values: HqScopeDelivery["values"],
  removals: HqScopeDelivery["removals"] = [],
  incarnation = "i1",
): HqStreamMessage => ({ type, scope: NAVIGATION, incarnation, revision, values, removals });
const ready = (
  revision: number,
  incarnation = "i1",
): Extract<HqStreamMessage, { type: "scope-ready" }> => ({
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
  for (const { name, core, updateRequired } of [
    { name: "undeclared", core: undefined, updateRequired: true },
    { name: "unreadable", core: { protocol: "bad" }, updateRequired: true },
    { name: "older", core: { protocol: 0, build: "old" }, updateRequired: true },
    { name: "supported", core: { protocol: 1, build: "current" }, updateRequired: false },
    { name: "newer", core: { protocol: 2, build: "new" }, updateRequired: false },
  ])
    it.effect(`reads a ${name} Core declaration without discarding navigation`, () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const { fiber } = yield* run(store, fixture);
        yield* fixture.send(
          navigation("scope-reset", 1, [{ key: "app:shop", value: app("shop", "Shop") }]),
        );
        yield* fixture.send({ ...ready(1), core });
        yield* settle;
        expect(hqNavigation.derive(readsOfState(store.state()), ORG)).toMatchObject({
          updateRequired,
        });
        expect(appName(store, "shop")).toBe("Shop");
        expect(fixture.sent).toHaveLength(1);
        yield* Fiber.interrupt(fiber);
      }),
    );

  it.effect("accepts a Core declaration even when navigation has not changed", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* run(store, fixture);
      yield* fixture.send(ready(1));
      yield* settle;
      expect(hqNavigation.derive(readsOfState(store.state()), ORG).updateRequired).toBe(true);
      yield* fixture.send({ ...ready(1), core: { protocol: 1, build: "current" } });
      yield* settle;
      expect(hqNavigation.derive(readsOfState(store.state()), ORG).updateRequired).toBe(false);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("keeps grouping when an older HQ omits a newer fact and reports the upgrade", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* run(store, fixture);
      const { releaseOffer: _offer, ...olderApp } = app("shop", "Shop", ["ada"]);
      yield* fixture.send(
        navigation("scope-reset", 1, [
          { key: "app:shop", value: olderApp },
          { key: "project:ada", value: project("ada", "shop") },
        ]),
      );
      yield* fixture.send(ready(1));
      yield* settle;
      const view = hqNavigation.derive(readsOfState(store.state()), ORG);
      expect(view.structure?.apps[0]?.projects[0]?.name).toBe("ada");
      expect(view).toMatchObject({ updateRequired: true });
      yield* Fiber.interrupt(fiber);
    }),
  );

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
    "commits setup evidence through navigation and retains it after a corrupt marker or outage",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const { fiber } = yield* live(store, fixture);
        const row = project("ada", "shop");
        yield* fixture.send(
          navigation("scope-values", 4, [
            { key: "project:ada", value: { ...row, mate: { ...row.mate, setupMarker: true } } },
          ]),
        );
        yield* settle;
        const setup = () =>
          hqMateSetup.derive(readsOfState(store.state()), { orgId: ORG, projectId: "ada" });
        expect(setup()).toEqual({ closedOff: false, marker: true });
        yield* fixture.send(
          navigation("scope-values", 5, [
            { key: "project:ada", value: { ...row, mate: { ...row.mate, setupMarker: 17 } } },
          ]),
        );
        yield* settle;
        expect(setup().marker).toBe(true);
        yield* fixture.drop({ outcome: "transient", message: "network" });
        yield* settle;
        expect(setup()).toEqual({ closedOff: "unknown", marker: true });
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

  it.effect("pings on a new segment cannot confirm its retained navigation", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* live(store, fixture);
      yield* fixture.endSegment;
      yield* settle;
      yield* fixture.send({ type: "ping" });
      yield* settle;
      const view = () => hqNavigation.derive(readsOfState(store.state()), ORG);
      expect(view()).toMatchObject({ live: false, reconnecting: true });
      expect(appName(store, "shop")).toBe("Shop");
      yield* TestClock.adjust(20_000);
      yield* settle;
      expect(view().live).toBe(false);
      expect(view().reconnecting).toBe(true);
      expect(streamOf(store.state(), linkKeys.hq(ORG)).fault?.message).toBe(
        "No answer came in time.",
      );
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
      expect(yield* Fiber.join(asked)).toEqual({ moveTo: { shop: ["allowed"] }, refused: {} });
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

  it.effect.each([
    { disposition: "refused", outcome: "definitive-refusal" },
    { disposition: "transient", outcome: "transient" },
  ] as const)(
    "compares two commits when asked, and hands HQ's $disposition answer back as $outcome",
    ({ disposition, outcome }) =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const { fiber, link } = yield* live(store, fixture);
        const head = "b".repeat(40);
        const asked = yield* Effect.forkChild(
          link.compare({ appId: "shop", repo: "api", base: "a".repeat(40), head }),
        );
        yield* settle;
        const request = fixture.sent.at(-1)?.request as { requestId: string };
        expect(request).toMatchObject({
          type: "compare",
          appId: "shop",
          repo: "api",
          base: "a".repeat(40),
          head,
        });
        const answer = { base: "a".repeat(40), head, commits: [], truncated: false, total: 0 };
        yield* fixture.send({
          type: "compare",
          requestId: request.requestId,
          appId: "shop",
          repo: "api",
          result: answer,
        });
        expect(yield* Fiber.join(asked)).toEqual(answer);

        const failed = yield* Effect.forkChild(
          Effect.flip(link.compare({ appId: "shop", repo: "api", head })),
        );
        yield* settle;
        const second = fixture.sent.at(-1)?.request as { requestId: string };
        expect(second).not.toHaveProperty("base");
        yield* fixture.send({
          type: "compare-error",
          requestId: second.requestId,
          appId: "shop",
          repo: "api",
          code: "commit_not_found",
          reason: null,
          disposition,
        });
        expect((yield* Fiber.join(failed)).outcome).toBe(outcome);
        yield* Fiber.interrupt(fiber);
      }),
  );
});

describe("a Mate's attention, relayed", () => {
  const ATTENTION = { kind: "attention", projectId: "ada" } as const;
  const presence = { online: true, since: "2026-10-06T00:00:00Z", overview: "live" } as const;
  const relayed = (value: unknown, state: "live" | "stored") => ({
    presence,
    overview: null,
    attention: value,
    attentionState: value === null ? "none" : state,
  });
  const relay = (
    type: HqScopeDelivery["type"],
    revision: number,
    value: unknown,
    state: "live" | "stored" = "live",
  ): HqStreamMessage => ({
    type,
    scope: ATTENTION,
    incarnation: "a1",
    revision,
    values: [{ key: "ada", value: relayed(value, state) }],
    removals: [],
  });
  /** What an open Mate said straight, as its own link commits it. */
  const direct = (store: AccountStore, value: MateAttention, method: "baseline" | "push") =>
    store.dispatch({
      kind: "rows",
      scope: mateAttentionScope("ada"),
      generation: streamOf(store.state(), mateAttentionScope("ada")).generation,
      method,
      via: "mate-direct",
      rows: [
        {
          family: "mateAttention",
          id: "ada",
          value,
          revision: {
            kind: "mate-attention",
            environmentId: value.source.environmentId,
            epoch: value.source.epoch,
            incarnation: value.source.incarnation,
            revision: value.source.revision,
            live: true,
          },
        },
      ],
    });
  const held = (store: AccountStore) => factOf(store.state(), "mateAttention", "ada");

  it.effect.each([
    {
      name: "baseline",
      firstEpoch: undefined,
      nextEpoch: undefined,
      firstRevision: 1,
      nextRevision: 2,
      epoch: 0,
      revision: 2,
    },
    {
      name: "uncounted then counted",
      firstEpoch: undefined,
      nextEpoch: 1,
      firstRevision: 9,
      nextRevision: 0,
      epoch: 1,
      revision: 0,
    },
    {
      name: "counted then uncounted",
      firstEpoch: 1,
      nextEpoch: undefined,
      firstRevision: 0,
      nextRevision: 9,
      epoch: 1,
      revision: 0,
    },
  ])(
    "decodes missing epochs into the reducer as zero: $name",
    ({ firstEpoch, nextEpoch, firstRevision, nextRevision, epoch, revision }) =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const { fiber } = yield* live(store, fixture);
        const raw = (epoch: number | undefined, revision: number) => ({
          ...attention("m1", revision),
          source: {
            environmentId: "env",
            incarnation: "m1",
            revision,
            ...(epoch === undefined ? {} : { epoch }),
          },
        });
        yield* fixture.send(relay("scope-reset", 1, raw(firstEpoch, firstRevision)));
        yield* settle;
        expect(held(store)?.revision).toMatchObject({ epoch: firstEpoch ?? 0 });
        yield* fixture.send(relay("scope-values", 2, raw(nextEpoch, nextRevision)));
        yield* settle;
        expect(held(store)).toMatchObject({
          content: { value: { source: { epoch, revision } } },
          revision: { kind: "mate-attention", epoch, revision },
        });
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect("holds the attention HQ relays by the Mate's own revision, beside HQ's record", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* live(store, fixture);
      yield* fixture.send(relay("scope-reset", 1, attention("m1", 4, 1)));
      yield* fixture.send({
        type: "scope-ready",
        scope: ATTENTION,
        incarnation: "a1",
        revision: 1,
      });
      yield* settle;
      expect(held(store)).toMatchObject({
        content: { kind: "value", value: attention("m1", 4, 1) },
        revision: { kind: "mate-attention", incarnation: "m1", revision: 4 },
        via: "hq-stream",
        authority: "mate",
      });
      expect(phase(store, hqMateAttentionScope(ORG, "ada"))).toBe("live");
      expect(publicRead(factOf(store.state(), "hqMate", "ada"))).toMatchObject({ kind: "known" });
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("holds nothing of a Mate from before the attention value", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* live(store, fixture);
      yield* fixture.send(relay("scope-reset", 1, null));
      yield* settle;
      expect(held(store)).toBeUndefined();
      expect(publicRead(factOf(store.state(), "hqMate", "ada"))).toMatchObject({ kind: "known" });
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("never lets a relay older than what the Mate said straight win", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* live(store, fixture);
      direct(store, attention("m1", 7, 2), "baseline");
      yield* fixture.send(relay("scope-reset", 1, attention("m1", 6, 1)));
      yield* settle;
      expect(held(store)).toMatchObject({
        content: { value: attention("m1", 7, 2) },
        via: "mate-direct",
      });
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("takes a newer relay once the Mate is not open: its revision, not its path", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* live(store, fixture);
      yield* fixture.send(relay("scope-reset", 1, attention("m1", 6)));
      yield* settle;
      direct(store, attention("m1", 7, 2), "push");
      yield* fixture.send(relay("scope-values", 2, attention("m1", 8)));
      yield* settle;
      expect(held(store)).toMatchObject({
        content: { value: attention("m1", 8) },
        via: "hq-stream",
      });
      yield* Fiber.interrupt(fiber);
    }),
  );

  type Step =
    | {
        readonly by: "relay";
        readonly type: HqScopeDelivery["type"];
        readonly hq: number;
        readonly value: MateAttention;
        readonly state: "live" | "stored";
      }
    | {
        readonly by: "direct";
        readonly method: "baseline" | "push";
        readonly value: MateAttention;
      };
  const relayStep = (
    type: HqScopeDelivery["type"],
    hq: number,
    value: MateAttention,
    state: "live" | "stored" = "live",
  ): Step => ({ by: "relay", type, hq, value, state });
  const directStep = (method: "baseline" | "push", value: MateAttention): Step => ({
    by: "direct",
    method,
    value,
  });

  /** The run before the restart, and the restarted one: start 1 and start 2. */
  const before = (revision: number, working = 0) => attention("m1", revision, working, 1);
  const after = (revision: number, working = 0) => attention("m2", revision, working, 2);

  it.effect.each([
    {
      name: "the Mate restarts while open, HQ relaying it live",
      steps: [relayStep("scope-reset", 1, before(9)), relayStep("scope-values", 2, after(0, 1))],
      held: after(0, 1),
    },
    {
      name: "the Mate restarts while open, its own link saying it",
      steps: [directStep("baseline", before(9)), directStep("push", after(0, 1))],
      held: after(0, 1),
    },
    {
      name: "a restarted Mate's own word, then what HQ stored of the run before",
      steps: [
        directStep("baseline", after(0, 1)),
        relayStep("scope-reset", 1, before(9), "stored"),
      ],
      held: after(0, 1),
    },
    {
      name: "what HQ stored of the run before, then the restarted Mate's own word",
      steps: [
        relayStep("scope-reset", 1, before(9), "stored"),
        directStep("baseline", after(0, 1)),
      ],
      held: after(0, 1),
    },
    {
      name: "a reload just after a restart: both paths go on after HQ's stored value",
      steps: [
        directStep("baseline", after(0, 1)),
        relayStep("scope-reset", 1, before(9), "stored"),
        directStep("push", after(1, 2)),
        relayStep("scope-values", 2, after(2, 0)),
      ],
      held: after(2, 0),
    },
    {
      name: "what HQ stored of the run before, pushed, never over the later run",
      steps: [
        relayStep("scope-reset", 1, after(3)),
        relayStep("scope-values", 2, before(9), "stored"),
      ],
      held: after(3),
    },
    {
      name: "the run before, relayed live after a partition, never over the later run",
      steps: [relayStep("scope-reset", 1, after(3)), relayStep("scope-values", 2, before(9))],
      held: after(3),
    },
    {
      name: "the run before, said straight late, never over the later run HQ relayed",
      steps: [relayStep("scope-reset", 1, after(3)), directStep("push", before(9))],
      held: after(3),
    },
    {
      name: "what HQ stored of the later run replaces the run before, said straight",
      steps: [
        directStep("baseline", before(9)),
        relayStep("scope-reset", 1, after(0, 1), "stored"),
      ],
      held: after(0, 1),
    },
  ])("orders a Mate's runs by their epoch, on either path: $name", ({ steps, held: expected }) =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* live(store, fixture);
      for (const step of steps) {
        if (step.by === "direct") direct(store, step.value, step.method);
        else yield* fixture.send(relay(step.type, step.hq, step.value, step.state));
        yield* settle;
      }
      expect(held(store)).toMatchObject({ content: { value: expected } });
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

  it.effect("tells HQ what the person saw while its socket was down once one opens again", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber, link } = yield* live(store, fixture);
      const seen = (segment: number) =>
        fixture.sent
          .filter(({ request, segment: at }) => at === segment && request.type === "seen")
          .map(({ request }) => request);
      yield* fixture.drop({ outcome: "transient", message: "HQ's stream broke." });
      yield* settle;
      yield* link.seen("ada", ["r1"]);
      yield* link.seen("ada", ["r2"]);
      yield* link.seen("bea", ["r3"]);
      yield* TestClock.adjust(1_000);
      yield* settle;
      expect(seen(2)).toEqual([
        { type: "seen", projectId: "ada", resultIds: ["r1", "r2"] },
        { type: "seen", projectId: "bea", resultIds: ["r3"] },
      ]);
      yield* link.seen("ada", ["r4"]);
      expect(seen(2).at(-1)).toEqual({ type: "seen", projectId: "ada", resultIds: ["r4"] });
      yield* fixture.drop({ outcome: "transient", message: "HQ's stream broke." });
      yield* TestClock.adjust(2_000);
      yield* settle;
      expect(seen(3)).toEqual([]);
      yield* Fiber.interrupt(fiber);
    }),
  );
});

describe("an HQ session", () => {
  it.effect("repeated session endings keep retrying and recover as soon as HQ answers", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* run(store, fixture);
      // The owner requires source evidence, never a retry count, to decide a permanent refusal.
      for (let ended = 0; ended < 3; ended++) {
        yield* fixture.drop(classifyHqClose(4401));
        yield* settle;
        const next = streamOf(store.state(), linkKeys.hq(ORG)).next;
        expect(next.kind).toBe("retry");
        if (next.kind === "retry")
          yield* TestClock.adjust(next.at - (yield* Clock.currentTimeMillis));
        yield* settle;
      }
      yield* fixture.send(
        navigation(
          "scope-reset",
          1,
          [{ key: "app:shop", value: app("shop", "Returned") }],
          [],
          "redeployed",
        ),
      );
      yield* fixture.send({ ...ready(1, "redeployed"), core: { build: "new-core", protocol: 2 } });
      yield* settle;
      expect(hqNavigation.derive(readsOfState(store.state()), ORG)).toMatchObject({
        live: true,
        refusal: null,
        coreBuild: "new-core",
        structure: { apps: [{ name: "Returned" }] },
      });
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
      expect(fixture.sent.find(({ segment }) => segment === 2)?.request).toEqual({
        type: "retry",
      });
      yield* Fiber.interrupt(fiber);
    }),
  );
});

describe("classifyHqClose", () => {
  it.each([
    { code: 4403, outcome: "definitive-refusal" },
    { code: 4401, outcome: "transient" },
    { code: 1011, outcome: "transient" },
    { code: 1006, outcome: "transient" },
  ])("$code is $outcome", ({ code, outcome }) => {
    expect(classifyHqClose(code).outcome).toBe(outcome);
  });
});

describe("HQ lifecycle receipt delivery", () => {
  it.effect.each(["whole", "damaged", "another account", "outage"] as const)(
    "restores only the original owner's readable request: %s",
    (entry) =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const running = yield* run(store, fixture);
        const record = {
          requestId: "prepare",
          intent: {
            kind: "prepare-mate-deletion",
            orgId: entry === "another account" ? "other" : ORG,
            hqProjectId: "hq",
            projectId: "ada",
          },
          result: { keyTokenId: "exact-key", completion: "exact-seal" },
        };
        yield* fixture.send(
          navigation("scope-reset", 1, [
            {
              key: "lifecycle:prepare",
              value: entry === "damaged" ? { requestId: "prepare" } : record,
            },
          ]),
        );
        yield* fixture.send(ready(1));
        yield* settle;
        if (entry === "outage") {
          yield* fixture.drop({ outcome: "transient", message: "HQ down" });
          yield* settle;
        }
        expect(store.state().operations.get("prepare")?.receipt?.acceptance).toEqual(
          entry === "damaged" || entry === "another account"
            ? undefined
            : { kind: "accepted", result: record.result },
        );
        yield* Fiber.interrupt(running.fiber);
      }),
  );
});

it.effect("relays health without an overview or attention and keeps it when HQ goes away", () =>
  Effect.gen(function* () {
    const health = yield* Schema.decodeUnknownEffect(MateHealth)({
      source: { environmentId: "env", epoch: 1, incarnation: "run", revision: 4 },
      sampledAt: "2026-10-07T12:00:00Z",
      evidence: {
        status: "strained",
        severity: "critical",
        resources: ["memory"],
        memory: null,
        cpu: null,
        io: null,
        disk: null,
        unavailable: [],
      },
    });
    const store = makeAccountStore(AtomRegistry.make());
    const fixture = hqFixtureWire();
    const { fiber } = yield* live(store, fixture);
    const scope = { kind: "attention", projectId: "ada" } as const;
    yield* fixture.send({
      type: "scope-reset",
      scope,
      incarnation: "hq1",
      revision: 1,
      values: [
        {
          key: "ada",
          value: {
            presence: { online: true, since: health.sampledAt, overview: "none" },
            overview: null,
            attention: null,
            attentionState: "none",
            health,
            healthState: "live",
          },
        },
      ],
      removals: [],
    });
    yield* fixture.send({ type: "scope-ready", scope, incarnation: "hq1", revision: 1 });
    yield* settle;
    expect(publicRead(factOf(store.state(), "mateHealth", "ada"))).toMatchObject({
      kind: "known",
      value: health,
    });
    expect(phase(store, hqMateHealthScope(ORG, "ada"))).toBe("live");
    yield* Fiber.interrupt(fiber);
    expect(publicRead(factOf(store.state(), "mateHealth", "ada"))).toMatchObject({
      kind: "known",
      value: health,
    });
  }),
);
