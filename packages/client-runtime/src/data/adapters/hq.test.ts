import { AGENT_USAGE_REPORT_PROTOCOL, MateHealth, type UsageReportQuery } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { hqMateHealthScope } from "../families/mateHealth.ts";
import { hqMateSetup } from "../projections/hqMateSetup.ts";
import { describe, expect, it } from "@effect/vitest";
import type { MateAttention } from "@t3tools/contracts";
import {
  HQ_ATTENTION_HEALTH_KEY,
  type HqScopeDelivery,
  type HqStreamMessage,
} from "@t3tools/shared/hqStream";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/reactivity";

import { graceOver } from "../__fixtures__/account.ts";
import {
  hqFixtureWire,
  gitEnvironment,
  gitRemote,
  gitPreflight,
  gitAdoption,
  type HqFixtureWire,
} from "../__fixtures__/hqWire.ts";
import { hqAppDetailScope } from "../families/hqAppDetail.ts";
import { hqAppGitTargets } from "../projections/hqNavigation.ts";
import { hqAppDetail } from "../projections/hqAppDetail.ts";
import { attention } from "../__fixtures__/mateAttention.ts";
import { settle } from "../__fixtures__/zeropsWire.ts";
import { hqAppsScope, placementsScope } from "../families/hqNavigation.ts";
import { hqMateScope } from "../families/hqMate.ts";
import { agentUsageOwner } from "../families/agentUsage.ts";
import { hqMateAttentionScope, mateAttentionScope } from "../families/mateAttention.ts";
import { linkKeys, type StreamKey } from "../model.ts";
import { factOf, streamOf } from "../reducer.ts";
import { makeAccountStore, publicRead, readsOfState, type AccountStore } from "../store.ts";
import { superviseLink } from "../supervisor.ts";
import { hqNavigation } from "../projections/hqNavigation.ts";
import { projectApplications } from "../projections/projectFlow.ts";
import { hqMateOverview, hqMateRefusal } from "../projections/hqMates.ts";
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
  it.effect(
    "admits delayed Git receipts without changing Zerops output or inventing project demand",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const { fiber, link } = yield* live(store, fixture);
        expect(
          hqNavigation.derive(readsOfState(store.state()), ORG).deliveryEnvironments.shop,
        ).toEqual([]);
        yield* fixture.send(
          navigation("scope-values", 4, [
            {
              key: "app:shop",
              value: { ...app("shop", "Shop", ["ada"]), environments: [gitEnvironment] },
            },
          ]),
        );
        yield* settle;
        const view = hqNavigation.derive(readsOfState(store.state()), ORG);
        expect(view.deliveryEnvironments.shop).toEqual([gitEnvironment]);
        expect(view.structure?.apps[0]?.environments).toEqual([]);
        expect(readsOfState(store.state()).coverage(hqAppsScope(ORG))).toBe("complete");
        expect(
          fixture.sent
            .flatMap(({ request }) =>
              request.type === "subscribe" ? request.scopes.map(({ scope }) => scope) : [],
            )
            .filter((scope) => scope.kind === "attention"),
        ).toEqual([{ kind: "attention", projectId: "ada", health: "apart" }]);
        const newer = {
          ...gitEnvironment,
          jobs: [
            {
              ...gitEnvironment.jobs[0],
              id: "push-v3",
              sha: "c".repeat(40),
              state: "queued",
              ref: "v3.0.0",
              evidence: null,
              endedAt: null,
            },
            ...gitEnvironment.jobs,
          ],
        };
        yield* fixture.send(
          navigation("scope-values", 5, [
            { key: "app:shop", value: { ...app("shop", "Shop", ["ada"]), environments: [newer] } },
          ]),
        );
        yield* settle;
        expect(
          hqNavigation.derive(readsOfState(store.state()), ORG).deliveryEnvironments.shop,
        ).toEqual([newer]);
        yield* fixture.send(
          navigation("scope-reset", 2, [
            { key: "app:shop", value: { ...app("shop", "Old"), environments: [] } },
          ]),
        );
        yield* settle;
        expect(
          hqNavigation.derive(readsOfState(store.state()), ORG).deliveryEnvironments.shop,
        ).toEqual([newer]);
        link.stop();
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect.each(["transient", "refused"] as const)(
    "keeps Git evidence through transient loss and purges authoritative denial: %s",
    (disposition) =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const { fiber, link } = yield* live(store, fixture);
        const release = link.demandDetail({ family: "hqAppDetail", ownerId: "shop" });
        yield* settle;
        const scope = { kind: "app-detail", appId: "shop" } as const;
        yield* fixture.send({
          type: "scope-reset",
          scope,
          incarnation: "detail",
          revision: 2,
          values: [
            {
              key: "probe:web",
              value: { ok: true, remote: { ...gitRemote, token: "PROTECTED_TOKEN_MARKER" } },
            },
            { key: "preflight:web", value: gitPreflight },
            { key: "adoption:web", value: gitAdoption },
          ],
          removals: [],
        });
        yield* fixture.send({ type: "scope-ready", scope, incarnation: "detail", revision: 2 });
        yield* settle;
        const read = () =>
          hqAppGitTargets.derive(readsOfState(store.state()), { orgId: ORG, appId: "shop" });
        expect(read().records).toEqual({
          "probe:web": { kind: "probe", repo: "web", value: { ok: true, remote: gitRemote } },
          "preflight:web": { kind: "preflight", repo: "web", value: gitPreflight },
          "adoption:web": { kind: "adoption", repo: "web", value: gitAdoption },
        });
        expect(read().complete).toBe(true);
        expect(JSON.stringify([...store.state().facts])).not.toContain("PROTECTED_TOKEN_MARKER");
        const rotated = { ...gitRemote, keptAt: "2026-10-13T10:05:00Z" };
        yield* fixture.send({
          type: "scope-values",
          scope,
          incarnation: "detail",
          revision: 3,
          values: [
            {
              key: "repos",
              value: [
                {
                  name: "web",
                  remote: rotated,
                  mainHead: gitPreflight.sha,
                  updatedAt: rotated.keptAt,
                },
              ],
            },
          ],
          removals: [],
        });
        yield* settle;
        yield* fixture.send({
          type: "scope-reset",
          scope,
          incarnation: "detail",
          revision: 1,
          values: [{ key: "probe:web", value: { ok: false, reason: "Obsolete credential" } }],
          removals: [],
        });
        yield* settle;
        expect(read().records["probe:web"]).toEqual({
          kind: "probe",
          repo: "web",
          value: { ok: true, remote: gitRemote },
        });
        expect(
          hqAppDetail.derive(readsOfState(store.state()), { orgId: ORG, appId: "shop" }).repos,
        ).toEqual([
          { name: "web", remote: rotated, mainHead: gitPreflight.sha, updatedAt: rotated.keptAt },
        ]);
        yield* fixture.send({
          type: "scope-error",
          scope,
          code: "forbidden",
          reason: "Membership denied",
          disposition,
        });
        yield* settle;
        if (disposition === "transient") {
          expect(read().records["preflight:web"]).toEqual({
            kind: "preflight",
            repo: "web",
            value: gitPreflight,
          });
          expect(factOf(store.state(), "hqAppDetail", "shop/probe:web")?.content.kind).toBe(
            "value",
          );
        } else {
          expect(read().records).toEqual({});
          expect(factOf(store.state(), "hqAppDetail", "shop/probe:web")?.content.kind).toBe(
            "purged",
          );
          expect(streamOf(store.state(), hqAppDetailScope(ORG, "shop")).demanded).toBe(false);
          expect(fixture.sent.map(({ request }) => request)).toContainEqual({
            type: "unsubscribe",
            scopes: [scope],
          });
          yield* fixture.send({
            type: "scope-reset",
            scope,
            incarnation: "detail",
            revision: 4,
            values: [{ key: "preflight:web", value: gitPreflight }],
            removals: [],
          });
          yield* settle;
          expect(read().records).toEqual({});
          link.retryDetail({ family: "hqAppDetail", ownerId: "shop" });
          yield* settle;
          expect(streamOf(store.state(), hqAppDetailScope(ORG, "shop")).demanded).toBe(true);
          yield* fixture.send({
            type: "scope-reset",
            scope,
            incarnation: "detail",
            revision: 4,
            values: [{ key: "preflight:web", value: gitPreflight }],
            removals: [],
          });
          yield* fixture.send({ type: "scope-ready", scope, incarnation: "detail", revision: 4 });
          yield* settle;
          expect(read().records).toEqual({
            "preflight:web": { kind: "preflight", repo: "web", value: gitPreflight },
          });
        }
        release();
        link.stop();
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect(
    "A released application detail returns to unknown and its records are no longer held",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const { fiber, link } = yield* live(store, fixture);
        const release = link.demandDetail({ family: "hqAppDetail", ownerId: "shop" });
        yield* settle;
        const scope = { kind: "app-detail", appId: "shop" } as const;
        yield* fixture.send({
          type: "scope-reset",
          scope,
          incarnation: "detail",
          revision: 2,
          values: [{ key: "preflight:web", value: gitPreflight }],
          removals: [],
        });
        yield* fixture.send({ type: "scope-ready", scope, incarnation: "detail", revision: 2 });
        yield* settle;
        const read = () =>
          hqAppDetail.derive(readsOfState(store.state()), { orgId: ORG, appId: "shop" });
        expect(read().preflight).toEqual({ web: gitPreflight });
        expect(read().read).toBe("read");

        release();
        yield* settle;

        expect(read().preflight).toEqual({});
        expect(read().read).toBe("unread");
        expect(factOf(store.state(), "hqAppDetail", "shop/preflight:web")).toBeUndefined();
        link.stop();
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect.each([
    { when: "after the link let it go", between: settle },
    { when: "before the link looked", between: Effect.void },
  ])(
    "An application detail held again $when asks HQ for its records whole and reads them again",
    ({ between }) =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const { fiber, link } = yield* live(store, fixture);
        const scope = { kind: "app-detail", appId: "shop" } as const;
        const subscribes = () =>
          fixture.sent.flatMap(({ request }) =>
            request.type === "subscribe"
              ? request.scopes.filter((entry) => entry.scope.kind === "app-detail")
              : [],
          );
        const first = link.demandDetail({ family: "hqAppDetail", ownerId: "shop" });
        yield* settle;
        yield* fixture.send({
          type: "scope-reset",
          scope,
          incarnation: "detail",
          revision: 2,
          values: [{ key: "preflight:web", value: gitPreflight }],
          removals: [],
        });
        yield* fixture.send({ type: "scope-ready", scope, incarnation: "detail", revision: 2 });
        yield* settle;
        const read = () =>
          hqAppDetail.derive(readsOfState(store.state()), { orgId: ORG, appId: "shop" });

        first();
        yield* between;
        const again = link.demandDetail({ family: "hqAppDetail", ownerId: "shop" });
        yield* settle;

        expect(subscribes()).toHaveLength(2);
        expect(subscribes().at(-1)).toEqual({ scope, knownKeys: [] });
        yield* fixture.send({
          type: "scope-reset",
          scope,
          incarnation: "detail",
          revision: 2,
          values: [{ key: "preflight:web", value: gitPreflight }],
          removals: [],
        });
        yield* fixture.send({ type: "scope-ready", scope, incarnation: "detail", revision: 2 });
        yield* settle;
        expect(read().preflight).toEqual({ web: gitPreflight });
        expect(read().read).toBe("read");
        again();
        link.stop();
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect(
    "ending an HQ lifetime forgets protected Git facts and fences late input and holds",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const { fiber, link } = yield* live(store, fixture);
        yield* fixture.send(
          navigation("scope-values", 4, [
            { key: "app:shop", value: { ...app("shop", "Shop"), environments: [gitEnvironment] } },
          ]),
        );
        yield* settle;
        link.stop();
        expect(hqNavigation.derive(readsOfState(store.state()), ORG).deliveryEnvironments).toEqual(
          {},
        );
        expect(
          [...store.state().facts.values()].some(
            (fact) =>
              fact.content.kind === "value" &&
              JSON.stringify(fact.content.value).includes(gitRemote.url),
          ),
        ).toBe(false);
        const release = link.demandDetail({ family: "hqAppDetail", ownerId: "shop" });
        expect(link.details!()).toEqual([]);
        expect(streamOf(store.state(), hqAppDetailScope(ORG, "shop")).demanded).toBe(false);
        yield* fixture.send(
          navigation("scope-values", 5, [
            { key: "app:shop", value: { ...app("shop", "Late"), environments: [gitEnvironment] } },
          ]),
        );
        yield* settle;
        expect(hqNavigation.derive(readsOfState(store.state()), ORG).deliveryEnvironments).toEqual(
          {},
        );
        release();
        yield* Fiber.interrupt(fiber);
      }),
  );
  it.effect("colleague enrollment adds a Mate beneath its application", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* live(store, fixture);
      expect(
        hqNavigation
          .derive(readsOfState(store.state()), ORG)
          .structure?.apps[0]?.projects.map((row) => row.name),
      ).toEqual(["ada"]);
      yield* fixture.send(
        navigation("scope-values", 4, [
          { key: "app:shop", value: app("shop", "Shop", ["ada", "bea"]) },
          { key: "project:bea", value: project("bea", "shop") },
        ]),
      );
      yield* settle;
      expect(
        hqNavigation.derive(readsOfState(store.state()), ORG).structure?.apps[0],
      ).toMatchObject({ name: "Shop", projects: [{ name: "ada" }, { name: "bea" }] });
      expect(fixture.opens()).toBe(1);
      yield* Fiber.interrupt(fiber);
    }),
  );
  it.effect("application rename updates its heading without reload", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* live(store, fixture);
      yield* fixture.send(
        navigation("scope-values", 4, [{ key: "app:shop", value: app("shop", "Bakery", ["ada"]) }]),
      );
      yield* settle;
      const view = hqNavigation.derive(readsOfState(store.state()), ORG);
      expect(view.structure?.apps.map((row) => row.name)).toEqual(["Bakery"]);
      expect(view.structure?.apps[0]?.projects.map((row) => row.name)).toEqual(["ada"]);
      expect(fixture.opens()).toBe(1);
      yield* Fiber.interrupt(fiber);
    }),
  );
  it.effect("detaching a Mate keeps its row outside the application", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* live(store, fixture);
      yield* fixture.send(
        navigation("scope-values", 4, [
          { key: "app:shop", value: app("shop", "Shop", ["ada", "bea"]) },
          { key: "project:bea", value: project("bea", "shop") },
        ]),
      );
      yield* settle;
      yield* fixture.send(
        navigation("scope-values", 5, [
          { key: "app:shop", value: app("shop", "Shop", ["bea"]) },
          { key: "project:ada", value: project("ada", null) },
        ]),
      );
      yield* settle;
      const view = hqNavigation.derive(readsOfState(store.state()), ORG);
      expect(view.structure?.apps[0]?.projects.map((row) => row.name)).toEqual(["bea"]);
      expect(view.structure?.ungrouped.map((row) => row.name)).toEqual(["ada"]);
      expect(fixture.opens()).toBe(1);
      yield* Fiber.interrupt(fiber);
    }),
  );
  it.effect("application menu rows arrive before HQ application detail", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* live(store, fixture);
      const view = hqNavigation.derive(readsOfState(store.state()), ORG);
      expect(view.structure?.apps[0]).toMatchObject({ name: "Shop", projects: [{ name: "ada" }] });
      // The navigation projection is consumed before any application-detail scope is requested.
      expect(
        fixture.sent.flatMap(({ request }) =>
          request.type === "subscribe" ? request.scopes.map(({ scope }) => scope.kind) : [],
        ),
      ).not.toContain("app-detail");
      expect([...store.state().streams.keys()].some((key) => key.includes("hq-app-detail"))).toBe(
        false,
      );
      yield* Fiber.interrupt(fiber);
    }),
  );
  it.effect.each(
    Array.from(
      [
        { name: "undeclared", core: undefined, updateRequired: true },
        { name: "unreadable", core: { protocol: "bad" }, updateRequired: true },
        { name: "older", core: { protocol: 0, build: "old" }, updateRequired: true },
        { name: "supported", core: { protocol: 1, build: "current" }, updateRequired: false },
        { name: "newer", core: { protocol: 2, build: "new" }, updateRequired: false },
      ],
      ({ name, core, updateRequired }) => ({
        title: `reads a ${name} Core declaration without discarding navigation`,
        core,
        updateRequired,
      }),
    ),
  )("$title", ({ core, updateRequired }) =>
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
        for (const input of graceOver(store.state())) store.dispatch(input);
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
              { scope: { kind: "attention", projectId: "ada", health: "apart" }, knownKeys: [] },
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
      for (const input of graceOver(store.state())) store.dispatch(input);
      const view = () => hqNavigation.derive(readsOfState(store.state()), ORG);
      expect(view()).toMatchObject({ live: false, reconnecting: true });
      expect(appName(store, "shop")).toBe("Shop");
      yield* TestClock.adjust(20_000);
      yield* settle;
      // Still unconfirmed, HQ is slow on a socket that holds: the navigation is not asked again.
      expect(view()).toMatchObject({ live: false, reconnecting: true, slow: true });
      expect(fixture.opens()).toBe(2);
      expect(streamOf(store.state(), linkKeys.hq(ORG)).fault).toBeNull();
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect(
    "a planned HQ segment end moves nothing: what HQ said stays current while it confirms it again",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const { fiber } = yield* live(store, fixture);
        const view = () => hqNavigation.derive(readsOfState(store.state()), ORG);
        const before = view();
        expect(before).toMatchObject({ live: true, reconnecting: false });
        yield* fixture.endSegment;
        yield* settle;
        expect(fixture.opens()).toBe(2);
        expect(view()).toMatchObject({ live: true, reconnecting: false });
        expect(view().downSince).toBeUndefined();
        expect(view().structure).toEqual(before.structure);
        yield* fixture.send(ready(3));
        yield* settle;
        expect(phase(store, hqAppsScope(ORG))).toBe("live");
        expect(view()).toMatchObject({ live: true, reconnecting: false });
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

  it.effect.each(["forbidden", "session_required", "chief_owner_required"] as const)(
    "an authoritative %s refusal removes the previously read Mate overview",
    (code) =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const { fiber } = yield* live(store, fixture);
        const scope = { kind: "attention", projectId: "ada", health: "apart" } as const;
        yield* fixture.send({
          type: "scope-reset",
          scope,
          incarnation: "a1",
          revision: 1,
          values: [
            {
              key: "ada",
              value: {
                presence: { online: true, since: "2026-10-06T00:00:00Z", overview: "live" },
                overview: {
                  identity: { environmentId: "env-ada", serverVersion: "0.14.35", update: null },
                  main: null,
                  threads: { list: [], omitted: 0 },
                  logins: {},
                  crew: { status: "off" },
                },
                attention: null,
                attentionState: "none",
              },
            },
          ],
          removals: [],
        });
        yield* fixture.send({ type: "scope-ready", scope, incarnation: "a1", revision: 1 });
        yield* settle;
        expect(publicRead(factOf(store.state(), "hqMate", "ada")).kind).toBe("known");
        yield* fixture.send({
          type: "scope-error",
          scope,
          code,
          reason: "Karlos",
          disposition: "refused",
        });
        yield* settle;
        expect(factOf(store.state(), "hqMate", "ada")?.content.kind).toBe("purged");
        expect(
          hqMateOverview.derive(readsOfState(store.state()), { orgId: ORG, projectId: "ada" }),
        ).toBeNull();
        expect(
          hqMateRefusal.derive(readsOfState(store.state()), { orgId: ORG, projectId: "ada" }),
        ).toEqual(
          code === "chief_owner_required"
            ? { kind: "refused-role", chiefOwnerName: "Karlos" }
            : null,
        );
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
      const attention = { kind: "attention", projectId: "ada", health: "apart" } as const;
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
  const ATTENTION = { kind: "attention", projectId: "ada", health: "apart" } as const;
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

describe("a slow HQ", () => {
  it.effect("A slow socket handshake is waited for, not restarted from a new ticket", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const upgraded = Deferred.makeUnsafe<void>();
      let tickets = 0;
      // Chrome queues the upgrade behind another handshake: the socket exists, its 101 is late.
      const fixture = hqFixtureWire({
        open: (socketCreated) =>
          Effect.gen(function* () {
            tickets += 1;
            yield* socketCreated;
            yield* Deferred.await(upgraded);
          }),
      });
      const { fiber } = yield* run(store, fixture);
      yield* TestClock.adjust(14_300);
      yield* settle;
      expect({ tickets, phase: phase(store, linkKeys.hq(ORG)) }).toEqual({
        tickets: 1,
        phase: "connecting",
      });
      yield* Deferred.succeed(upgraded, undefined);
      yield* settle;
      yield* fixture.send(
        navigation("scope-reset", 1, [{ key: "app:shop", value: app("shop", "Shop") }]),
      );
      yield* fixture.send(ready(1));
      yield* settle;
      expect({ tickets, phase: phase(store, linkKeys.hq(ORG)) }).toEqual({
        tickets: 1,
        phase: "live",
      });
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect(
    "a navigation HQ sends long after its connection opened lands on that connection, asked once",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const { fiber } = yield* run(store, fixture);
        // HQ computes the navigation for 45 s, pinging every 20 s meanwhile.
        for (let ping = 0; ping < 2; ping++) {
          yield* TestClock.adjust(20_000);
          yield* fixture.send({ type: "ping" });
          yield* settle;
        }
        yield* TestClock.adjust(5_000);
        yield* fixture.send(
          navigation("scope-reset", 1, [{ key: "app:shop", value: app("shop", "Shop") }]),
        );
        yield* fixture.send(ready(1));
        yield* settle;
        expect(fixture.opens()).toBe(1);
        expect(
          navigationRequests(fixture, 1).filter(({ type }) => type === "subscribe"),
        ).toHaveLength(1);
        expect(appName(store, "shop")).toBe("Shop");
        expect(phase(store, hqAppsScope(ORG))).toBe("live");
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect(
    "a navigation HQ is still working on, past a first answer's patience, reads slow and not down",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const { fiber } = yield* run(store, fixture);
        const view = () => hqNavigation.derive(readsOfState(store.state()), ORG);
        // Within its first answer's patience, a wait is not worth saying.
        expect(view()).toMatchObject({ live: false, slow: false });
        yield* TestClock.adjust(20_000);
        yield* fixture.send({ type: "ping" });
        yield* settle;
        for (const input of graceOver(store.state())) store.dispatch(input);
        expect(view()).toMatchObject({
          live: false,
          slow: true,
          reconnecting: false,
          capped: false,
          refusal: null,
        });
        yield* fixture.send(navigation("scope-reset", 1, []));
        yield* fixture.send(ready(1));
        yield* settle;
        expect(view()).toMatchObject({ live: true, slow: false });
        yield* Fiber.interrupt(fiber);
      }),
  );
});

describe("a slow HQ's applications", () => {
  it.effect(
    "applications HQ is slow to confirm again are not called unanswered; a lost socket's are",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const { fiber } = yield* live(store, fixture);
        const unavailable = () =>
          projectApplications.derive(readsOfState(store.state()), ORG).unavailable;
        yield* fixture.endSegment;
        yield* settle;
        for (const input of graceOver(store.state())) store.dispatch(input);
        expect(unavailable()).toBe(false);
        yield* fixture.drop({ outcome: "transient", message: "HQ's stream broke." });
        yield* settle;
        for (const input of graceOver(store.state())) store.dispatch(input);
        expect(unavailable()).toBe(true);
        yield* Fiber.interrupt(fiber);
      }),
  );
});

describe("an HQ outage", () => {
  it.effect(
    "a socket HQ closes before it says anything is a failed attempt: retries back off",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const { fiber } = yield* run(store, fixture);
        for (const failures of [1, 2, 3]) {
          yield* fixture.drop(classifyHqClose(4401));
          yield* settle;
          const link = streamOf(store.state(), linkKeys.hq(ORG));
          expect({ phase: link.phase, failures: link.failures }).toEqual({
            phase: "recovering",
            failures,
          });
          if (link.next.kind === "retry")
            yield* TestClock.adjust(link.next.at - (yield* Clock.currentTimeMillis));
          yield* settle;
        }
        yield* Fiber.interrupt(fiber);
      }),
  );

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
            { scope: { kind: "attention", projectId: "ada", health: "apart" }, knownKeys: [] },
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

const decodeHealth = Schema.decodeUnknownSync(MateHealth);
it.effect(
  "asks HQ for a Mate's health apart and reads it from that value, or from the whole record of an HQ that sends it inside",
  () =>
    Effect.gen(function* () {
      const sample = (revision: number) =>
        decodeHealth({
          source: { environmentId: "env", epoch: 1, incarnation: "run", revision },
          sampledAt: `2026-10-09T13:00:0${revision}Z`,
          evidence: {
            status: "strained",
            severity: "warning",
            resources: ["io"],
            memory: null,
            pids: null,
            io: { some: { avg10: 1.75, total: revision }, full: null },
            disk: null,
            unavailable: [],
          },
        });
      const record = {
        presence: { online: true, since: "2026-10-09T13:00:00Z", overview: "none" },
        overview: null,
        attention: null,
        attentionState: "none",
      } as const;
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* live(store, fixture);
      const asked = fixture.sent.flatMap(({ request }) =>
        request.type === "subscribe"
          ? request.scopes.filter(({ scope }) => scope.kind === "attention")
          : [],
      );
      expect(asked.map(({ scope }) => scope)).toEqual([
        { kind: "attention", projectId: "ada", health: "apart" },
      ]);
      const health = () => {
        const read = publicRead(factOf(store.state(), "mateHealth", "ada"));
        return read.kind === "known" ? (read.value as MateHealth).source.revision : read.kind;
      };
      // An HQ from before the option answers on the scope it knows, health inside the record.
      const older = { kind: "attention", projectId: "ada" } as const;
      yield* fixture.send({
        type: "scope-reset",
        scope: older,
        incarnation: "hq1",
        revision: 1,
        values: [{ key: "ada", value: { ...record, health: sample(1), healthState: "live" } }],
        removals: [],
      });
      yield* fixture.send({ type: "scope-ready", scope: older, incarnation: "hq1", revision: 1 });
      yield* settle;
      expect(health()).toBe(1);
      // A newer HQ sends the record without it, and each sample as its own value.
      const apart = { ...older, health: "apart" } as const;
      yield* fixture.send({
        type: "scope-values",
        scope: apart,
        incarnation: "hq1",
        revision: 2,
        values: [
          { key: "ada", value: record },
          { key: HQ_ATTENTION_HEALTH_KEY, value: { health: sample(2), healthState: "live" } },
        ],
        removals: [],
      });
      yield* settle;
      expect(health()).toBe(2);
      yield* fixture.send({
        type: "scope-values",
        scope: apart,
        incarnation: "hq1",
        revision: 3,
        values: [
          { key: HQ_ATTENTION_HEALTH_KEY, value: { health: sample(3), healthState: "live" } },
        ],
        removals: [],
      });
      yield* settle;
      expect(health()).toBe(3);
      expect(publicRead(factOf(store.state(), "hqMate", "ada"))).toMatchObject({
        kind: "known",
        value: record,
      });
      expect(publicRead(factOf(store.state(), "hqMate", HQ_ATTENTION_HEALTH_KEY)).kind).not.toBe(
        "known",
      );
      yield* Fiber.interrupt(fiber);
    }),
);

it.effect("relays health without an overview or attention and keeps it when HQ goes away", () =>
  Effect.gen(function* () {
    const health = yield* Schema.decodeUnknownEffect(MateHealth)({
      source: { environmentId: "env", epoch: 1, incarnation: "run", revision: 4 },
      sampledAt: "2026-10-07T12:00:00Z",
      evidence: {
        status: "strained",
        severity: "critical",
        resources: ["memory"],
        memory: {
          scope: "/sys/fs/cgroup",
          current: 2 * 1024 ** 3,
          high: 1.375 * 1024 ** 3,
          max: 3.375 * 1024 ** 3,
          events: { high: 2514, max: 7, oom: 0, oomKill: 0 },
          growth: { high: 1, max: 1, oom: 0, oomKill: 0 },
          pressure: null,
          swapCurrent: 200 * 1024 ** 2,
          swapMax: 512 * 1024 ** 2,
          swapGrowth: 1024,
        },
        pids: null,
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

describe("outage scenarios at the HQ input", () => {
  it.effect("an unchanged HQ segment rollover keeps rows and follows the next change", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* run(store, fixture);
      const values = [
        { key: "app:shop", value: app("shop", "Shop", ["ada", "bea"]) },
        { key: "project:ada", value: { ...project("ada", "shop"), name: "Ada" } },
        { key: "project:bea", value: { ...project("bea", "shop"), name: "Bea" } },
      ];
      yield* fixture.send(navigation("scope-reset", 3, values));
      yield* fixture.send(ready(3));
      yield* settle;
      const view = () => hqNavigation.derive(readsOfState(store.state()), ORG);
      const before = view();
      const observed: Array<ReturnType<typeof view>> = [];
      const stop = store.subscribe(() => observed.push(view()));
      try {
        yield* fixture.endSegment;
        yield* settle;
        expect(fixture.opens()).toBe(2);
        expect(view().structure).toEqual(before.structure);
        yield* fixture.send(ready(3));
        yield* settle;
        expect(view().structure).toEqual(before.structure);
        yield* fixture.send(
          navigation("scope-values", 4, [
            { key: "app:shop", value: app("shop", "Shop after rollover", ["ada", "bea"]) },
          ]),
        );
        yield* settle;
        expect(appName(store, "shop")).toBe("Shop after rollover");
        expect(observed.length).toBeGreaterThan(0);
        for (const snapshot of observed) {
          expect(
            snapshot.structure?.apps.flatMap((app) => app.projects.map((row) => row.name)).sort(),
          ).toEqual(["Ada", "Bea"]);
          expect(snapshot.live).toBe(true);
          expect(snapshot.reconnecting).toBe(false);
        }
      } finally {
        stop();
        yield* Fiber.interrupt(fiber);
      }
    }),
  );

  it.effect("successive HQ session endings renew and restore the menu", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber, supervisor } = yield* live(store, fixture);
      const view = () => hqNavigation.derive(readsOfState(store.state()), ORG);
      for (let ended = 0; ended < 3; ended++) {
        yield* fixture.drop(classifyHqClose(4401));
        yield* settle;
        // Observe the renewal before HQ answers: its grace must hide the outage.
        expect(view()).toMatchObject({ live: true, reconnecting: false, refusal: null });
        yield* supervisor.signal("resume");
        yield* settle;
        expect(fixture.opens()).toBe(ended + 2);
        expect(
          view().structure?.apps.flatMap((app) => app.projects.map(({ projectId }) => projectId)),
        ).toEqual(["ada"]);
        yield* fixture.send(ready(3));
        yield* settle;
        expect(view()).toMatchObject({ live: true, reconnecting: false, refusal: null });
        expect(view().structure?.apps[0]?.name).toBe("Shop");
      }
      yield* Fiber.interrupt(fiber);
    }),
  );

  const reconcileOutages = (names: readonly string[]) =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber, supervisor } = yield* live(store, fixture);
      const view = () => hqNavigation.derive(readsOfState(store.state()), ORG);
      const observed: Array<ReturnType<typeof view>> = [];
      const stop = store.subscribe(() => observed.push(view()));
      let previous = "Shop";
      try {
        for (const [index, name] of names.entries()) {
          yield* fixture.drop(classifyHqClose(1011));
          yield* settle;
          for (const input of graceOver(store.state())) store.dispatch(input);
          expect(view()).toMatchObject({ live: false, reconnecting: true });
          expect(view().structure?.apps[0]?.name).toBe(previous);
          yield* supervisor.signal("resume");
          yield* settle;
          yield* fixture.send(
            navigation("scope-values", 4 + index, [
              { key: "app:shop", value: app("shop", name, ["ada"]) },
            ]),
          );
          yield* fixture.send(ready(4 + index));
          yield* settle;
          expect(view()).toMatchObject({ live: true, reconnecting: false });
          expect(view().structure?.apps.map(({ name }) => name)).toEqual([name]);
          expect(view().structure?.apps.some(({ name }) => name === previous)).toBe(false);
          previous = name;
        }
        expect(observed.length).toBeGreaterThan(0);
        for (const snapshot of observed) {
          expect(snapshot.structure?.apps.map(({ id }) => id)).toEqual(["shop"]);
          expect(
            snapshot.structure?.apps.flatMap((app) =>
              app.projects.map(({ projectId }) => projectId),
            ),
          ).toEqual(["ada"]);
        }
      } finally {
        stop();
        yield* Fiber.interrupt(fiber);
      }
    });

  it.effect("two consecutive HQ outages each reconcile the latest name", () =>
    reconcileOutages(["Shop first return", "Shop second return"]),
  );
  it.effect("G: HQ outage preserves rows and catches up after return", () =>
    reconcileOutages(["Shop returned"]),
  );

  it.effect("a new HQ segment without its snapshot cannot stay live on pings", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* live(store, fixture);
      yield* fixture.endSegment;
      yield* settle;
      for (let ping = 0; ping < 3; ping++) {
        yield* TestClock.adjust(5_000);
        yield* fixture.send({ type: "ping" });
        yield* settle;
      }
      yield* TestClock.adjust(5_000);
      yield* settle;
      for (const input of graceOver(store.state())) store.dispatch(input);
      expect(hqNavigation.derive(readsOfState(store.state()), ORG)).toMatchObject({
        live: false,
        reconnecting: true,
        slow: true,
      });
      expect(fixture.opens()).toBe(2);
      expect(appName(store, "shop")).toBe("Shop");
      yield* Fiber.interrupt(fiber);
    }),
  );

  const main = (id: string, task: string) => ({
    id,
    title: task,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    interactionMode: "default",
    backgroundLiveness: null,
    session: null,
    latestTurn: null,
    latestUserMessageAt: "2026-10-07T00:00:00Z",
    updatedAt: "2026-10-07T00:00:00Z",
    latestMessagePreview: null,
    latestUserMessagePreview: { text: task },
    planProgress: null,
    pendingQuestion: null,
    usagePause: null,
    liveStep: null,
  });
  const corruptRecord = () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* live(store, fixture);
      yield* fixture.send(
        navigation("scope-values", 4, [
          { key: "app:shop", value: app("shop", "Shop", ["ada", "bea"]) },
          { key: "project:bea", value: project("bea", "shop") },
        ]),
      );
      yield* settle;

      for (const id of ["ada", "bea"]) {
        const scope = { kind: "attention", projectId: id, health: "apart" } as const;
        yield* fixture.send({
          type: "scope-reset",
          scope,
          incarnation: "m1",
          revision: 1,
          removals: [],
          values: [
            {
              key: id,
              value: {
                presence: { online: true, since: "2026-10-07T00:00:00Z", overview: "live" },
                overview: {
                  identity: { environmentId: `env-${id}`, serverVersion: "0.14.35", update: null },
                  main: main(id, `Inspect ${id} checkout`),
                  threads: { list: [], omitted: 0 },
                  logins: {},
                  crew: { status: "off" },
                },
                attention: null,
                attentionState: "none",
              },
            },
          ],
        });
        yield* fixture.send({ type: "scope-ready", scope, incarnation: "m1", revision: 1 });
      }
      yield* settle;
      const task = (projectId: string) =>
        hqMateOverview.derive(readsOfState(store.state()), { orgId: ORG, projectId })?.main
          ?.latestUserMessagePreview?.text;
      expect(task("ada")).toBe("Inspect ada checkout");
      expect(task("bea")).toBe("Inspect bea checkout");
      yield* fixture.send({
        type: "scope-values",
        scope: { kind: "attention", projectId: "ada", health: "apart" },
        incarnation: "m1",
        revision: 2,
        removals: [],
        values: [{ key: "ada", value: { presence: "corrupt" } }],
      });
      yield* fixture.send(
        navigation("scope-values", 5, [
          { key: "app:shop", value: app("shop", "Shop after corrupt", ["ada", "bea"]) },
        ]),
      );
      yield* settle;
      expect(appName(store, "shop")).toBe("Shop after corrupt");
      expect(
        hqNavigation
          .derive(readsOfState(store.state()), ORG)
          .structure?.apps.flatMap((app) => app.projects.map(({ projectId }) => projectId))
          .sort(),
      ).toEqual(["ada", "bea"]);
      expect(task("ada")).toBe("Inspect ada checkout");
      expect(task("bea")).toBe("Inspect bea checkout");
      yield* Fiber.interrupt(fiber);
    });
  it.effect("a corrupt HQ Mate record keeps unrelated tasks and menu rows", corruptRecord);
  it.effect("Ada's task is kept after a corrupt update", corruptRecord);
  it.effect("HQ down retains the last known pending question", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber } = yield* live(store, fixture);
      const scope = { kind: "attention", projectId: "ada", health: "apart" } as const;
      const question = "Which checkout should I inspect?";
      yield* fixture.send({
        type: "scope-reset",
        scope,
        incarnation: "m1",
        revision: 1,
        removals: [],
        values: [
          {
            key: "ada",
            value: {
              presence: { online: true, since: "2026-10-07T00:00:00Z", overview: "live" },
              overview: {
                identity: { environmentId: "env-ada", serverVersion: "0.14.35", update: null },
                main: {
                  ...main("ada", "Inspect checkout"),
                  hasPendingUserInput: true,
                  pendingQuestion: question,
                },
                threads: { list: [], omitted: 0 },
                logins: {},
                crew: { status: "off" },
              },
              attention: null,
              attentionState: "none",
            },
          },
        ],
      });
      yield* fixture.send({ type: "scope-ready", scope, incarnation: "m1", revision: 1 });
      yield* settle;
      const heldQuestion = () =>
        hqMateOverview.derive(readsOfState(store.state()), { orgId: ORG, projectId: "ada" })?.main
          ?.pendingQuestion;
      expect(heldQuestion()).toBe(question);
      yield* fixture.drop(classifyHqClose(1011));
      yield* settle;
      for (const input of graceOver(store.state())) store.dispatch(input);
      expect(hqNavigation.derive(readsOfState(store.state()), ORG)).toMatchObject({
        live: false,
        reconnecting: true,
      });
      // Hold the record through the whole capped retry interval, not only the first failure.
      yield* TestClock.adjust(120_000);
      yield* settle;
      expect(heldQuestion()).toBe(question);
      yield* Fiber.interrupt(fiber);
    }),
  );
  it.effect("HQ refusal says why and waits for an explicit retry", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const { fiber, supervisor } = yield* live(store, fixture);
      yield* fixture.drop({
        outcome: "definitive-refusal",
        message: "Zerops refused HQ's access",
        code: "zerops_refused",
      });
      yield* settle;
      const view = () => hqNavigation.derive(readsOfState(store.state()), ORG);
      expect(view().refusal).toBe("Zerops refused HQ's access");
      expect(view().refusal).not.toContain("not reachable");
      for (let wake = 0; wake < 3; wake++) yield* supervisor.signal("resume");
      yield* TestClock.adjust(120_000);
      yield* settle;
      expect(fixture.opens()).toBe(1);
      expect(view().refusal).toBe("Zerops refused HQ's access");
      yield* supervisor.signal("manual-retry");
      yield* settle;
      expect(fixture.opens()).toBe(2);
      yield* fixture.send(ready(3));
      yield* settle;
      expect(view()).toMatchObject({ live: true, refusal: null });
      expect(appName(store, "shop")).toBe("Shop");
      yield* Fiber.interrupt(fiber);
    }),
  );
});

describe("the usage reports a period holds", () => {
  const periodOwners = (since: string) =>
    (["mate", "model", "provider", "day"] as const).map((groupBy) =>
      agentUsageOwner({
        since,
        until: "2026-10-25T00:00:00.000Z",
        mode: "utc-days",
        timezone: "UTC",
        projectId: null,
        appId: null,
        mateId: null,
        ownerUserId: null,
        provider: null,
        model: null,
        groupBy,
        provenance: "live-responses",
      } satisfies UsageReportQuery),
    );

  it.effect(
    "Switching the usage period lets go of the old period's reports before asking HQ for the new ones",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const link = hqNavigationLink({ orgId: ORG, wire: fixture.wire, store });
        const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
        const fiber = yield* Effect.forkChild(supervisor.run);
        yield* settle;
        yield* fixture.send({
          type: "scope-ready",
          scope: NAVIGATION,
          incarnation: "hq",
          revision: 1,
          core: { protocol: 1, agentUsage: AGENT_USAGE_REPORT_PROTOCOL },
        });
        yield* settle;
        const usageFrames = () =>
          fixture.sent.flatMap(({ request }) =>
            request.type === "subscribe" || request.type === "unsubscribe"
              ? request.scopes.flatMap((entry) => {
                  const wire = "scope" in entry ? entry.scope : entry;
                  return wire.kind === "agentUsage"
                    ? [{ type: request.type, owner: agentUsageOwner(wire.query) }]
                    : [];
                })
              : [],
          );
        const [week, month] = [
          periodOwners("2026-10-18T00:00:00.000Z"),
          periodOwners("2026-09-25T00:00:00.000Z"),
        ];

        const releaseWeek = week.map((ownerId) =>
          link.demandDetail({ family: "agentUsage", ownerId }),
        );
        yield* settle;
        releaseWeek.forEach((release) => release());
        const holdMonth = month.map((ownerId) =>
          link.demandDetail({ family: "agentUsage", ownerId }),
        );
        yield* settle;

        const frames = usageFrames();
        const of = (type: string, from: number, to: number) =>
          new Set(
            frames
              .slice(from, to)
              .filter((f) => f.type === type)
              .map((f) => f.owner),
          );
        expect(frames).toHaveLength(12);
        expect(of("subscribe", 0, 4)).toEqual(new Set(week));
        expect(of("unsubscribe", 4, 8)).toEqual(new Set(week));
        expect(of("subscribe", 8, 12)).toEqual(new Set(month));
        holdMonth.forEach((release) => release());
        yield* Fiber.interrupt(fiber);
      }),
  );
});
