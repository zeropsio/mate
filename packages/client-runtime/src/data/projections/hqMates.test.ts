import { Atom, AtomRegistry } from "effect/reactivity";
import { EnvironmentId } from "@t3tools/contracts";
import type { MateOverview } from "@t3tools/shared/mateLink";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import { describe, expect, it } from "vite-plus/test";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { hqMateScope } from "../families/hqMate.ts";
import { placementsScope } from "../families/hqNavigation.ts";
import { linkKeys } from "../model.ts";
import { makeAccountStore, readsOfState, type Projection } from "../store.ts";
import { mateArrival, mateNoticeDecision } from "./mateArrival.ts";
import {
  hqMates,
  hqMateAnswered,
  hqMatesAnswered,
  hqIndexWord,
  hqMateOverview,
  hqMatePresence,
  hqMateLogins,
  hqMateReady,
  hqMateRefusal,
} from "./hqMates.ts";

const presence = { online: true, since: "2026-10-07T00:00:00Z", overview: "live" } as const;
const mate: MateOverview & { readonly presence: typeof presence } = {
  presence,
  identity: { environmentId: EnvironmentId.make("env-a"), serverVersion: "0.14.35", update: null },
  main: null,
  threads: { list: [], omitted: 0 },
  logins: {},
  crew: { status: "off" },
};
const key = (projectId: string) => ({ orgId: "org", projectId });

describe("keyed HQ Mate readers", () => {
  it("a Mate's admission is unanswered until its own HQ attention scope answers", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const answer = store.data.project(hqMateAnswered, key("chief"));
    const stop = registry.subscribe(answer, () => undefined);
    const refuse = (orgId: string, projectId: string) =>
      store.dispatch({
        kind: "stream",
        key: hqMateScope(orgId, projectId),
        now: 100,
        event: {
          kind: "fault",
          jitter: 0,
          fault: { outcome: "definitive-refusal", code: "forbidden", message: "no-access" },
        },
      });
    expect(registry.get(answer), "ASSERTION: an unread target has no admission answer").toBe(false);
    refuse("org", "unrelated");
    refuse("another-org", "chief");
    expect(
      registry.get(answer),
      "ASSERTION: another target's refusal is no answer for this Mate",
    ).toBe(false);
    refuse("org", "chief");
    expect(
      registry.get(answer),
      "ASSERTION: this Mate's definitive refusal answers its admission",
    ).toBe(true);
    stop();
    registry.dispose();
  });

  it("a targeted Chief refusal names its owner without listing their Chief", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    seedHqNavigation(store, "org", { mates: {}, people: { "u-karlos": { name: "Karlos" } } });
    const refusal = store.data.project(hqMateRefusal, key("hidden-chief"));
    const seen: unknown[] = [];
    const stop = registry.subscribe(refusal, () => seen.push(registry.get(refusal)), {
      immediate: true,
    });
    const fault = (orgId: string, projectId: string) =>
      store.dispatch({
        kind: "stream",
        key: hqMateScope(orgId, projectId),
        now: 100,
        event: {
          kind: "fault",
          jitter: 0,
          fault: { outcome: "definitive-refusal", code: "chief_owner_required", message: "Karlos" },
        },
      });
    expect(registry.get(refusal)).toBeNull();
    fault("org", "unrelated");
    fault("another-org", "hidden-chief");
    expect(registry.get(refusal)).toBeNull();
    fault("org", "hidden-chief");
    expect(registry.get(refusal)).toEqual({ kind: "refused-role", chiefOwnerName: "Karlos" });
    const recovery = {
      standing: { kind: "denied" },
      status: undefined,
      process: undefined,
    } as const;
    const arrival = mateArrival({
      press: undefined,
      candidate: undefined,
      recovery,
      admissionRefusal: registry.get(refusal),
    });
    expect(arrival.page).toEqual({
      kind: "unreachable",
      reachability: { kind: "refused-role", chiefOwnerName: "Karlos" },
    });
    expect(arrival.projectUnavailable).toBe(false);
    expect(
      mateNoticeDecision({
        reachability: arrival.page?.kind === "unreachable" ? arrival.page.reachability : null,
        conversationShown: false,
        nowMs: 100,
        mateName: "Mate",
        recovery,
      }),
    ).toMatchObject({ phase: "reachability", recovery: null });
    expect(seen).toEqual([null, { kind: "refused-role", chiefOwnerName: "Karlos" }]);
    expect(registry.get(store.data.project(hqMates, "org")).mates).toEqual({});
    expect(registry.get(store.data.project(hqMateOverview, key("hidden-chief")))).toBeNull();
    expect([...store.state().memberships.get(placementsScope("org"))!.members.keys()]).toEqual([]);
    stop();
    registry.dispose();
  });

  // witness: packages/client-runtime/src/data/projections/hqMates.ts | const byId = people.get(reason)?.name; → const byId = undefined;
  it("a Chief refusal giving its owner's Zerops user id names them from the organization's member list, and somebody it does not hold as another person", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    seedHqNavigation(store, "org", { mates: {}, people: { "u-karlos": { name: "Karlos" } } });
    const refuse = (projectId: string, reason: string) =>
      store.dispatch({
        kind: "stream",
        key: hqMateScope("org", projectId),
        now: 100,
        event: {
          kind: "fault",
          jitter: 0,
          fault: { outcome: "definitive-refusal", code: "chief_owner_required", message: reason },
        },
      });
    refuse("karlos-chief", "u-karlos");
    refuse("stranger-chief", "u-stranger");
    expect(registry.get(store.data.project(hqMateRefusal, key("karlos-chief")))).toEqual({
      kind: "refused-role",
      chiefOwnerName: "Karlos",
    });
    expect(registry.get(store.data.project(hqMateRefusal, key("stranger-chief")))).toEqual({
      kind: "refused-role",
      chiefOwnerName: "another person",
    });
    registry.dispose();
  });

  it.each([
    { outcome: "definitive-refusal", code: "forbidden" },
    { outcome: "definitive-refusal", code: undefined },
    { outcome: "transient", code: "chief_owner_required" },
  ] as const)("a generic $outcome $code error does not claim Chief ownership", (fault) => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    store.dispatch({
      kind: "stream",
      key: hqMateScope("org", "hidden-chief"),
      now: 100,
      event: {
        kind: "fault",
        jitter: 0,
        fault: {
          outcome: fault.outcome,
          ...(fault.code === undefined ? {} : { code: fault.code }),
          message: "Karlos",
        },
      },
    });
    expect(registry.get(store.data.project(hqMateRefusal, key("hidden-chief")))).toBeNull();
    registry.dispose();
  });

  it("derives/publishes only A while retaining B, login and ready values and source revisions", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const ids = Array.from({ length: 30 }, (_, i) => `mate-${i}`);
    seedHqNavigation(store, "org", { mates: Object.fromEntries(ids.map((id) => [id, mate])) });
    const derives: string[] = [];
    const published: string[] = [];
    const before = { derives: 0, publications: 0 };
    const counted: typeof hqMateOverview = {
      ...hqMateOverview,
      derive: (read, k) => {
        derives.push(k.projectId);
        return hqMateOverview.derive(read, k);
      },
    };
    const stops = ids.map((id) => {
      const atom = store.data.project(counted, key(id));
      return registry.subscribe(
        atom,
        () => {
          registry.get(atom);
          published.push(id);
        },
        { immediate: true },
      );
    });
    const aggregate = store.data.project(hqMates, "org");
    for (const id of ids) {
      const row = Atom.make((get) => {
        before.derives++;
        return get(aggregate).mates[id];
      });
      stops.push(
        registry.subscribe(
          row,
          () => {
            registry.get(row);
            before.publications++;
          },
          { immediate: true },
        ),
      );
    }
    let sections = 0;
    function watch<V>(projection: Projection<ReturnType<typeof key>, V>) {
      const atom = store.data.project(projection, key(ids[0]!));
      stops.push(
        registry.subscribe(
          atom,
          () => {
            registry.get(atom);
            sections++;
          },
          { immediate: true },
        ),
      );
    }
    watch(hqMateLogins);
    watch(hqMateReady);
    watch(hqMatePresence);
    const b = registry.get(store.data.project(counted, key(ids[1]!)));
    const delivery = (
      value: MateOverview & { readonly presence: MateLiveView["presence"] },
      revision: number,
    ) => {
      const { presence: p, ...overview } = value;
      store.dispatch({
        kind: "delivery",
        via: "hq-stream",
        scopes: [{ scope: hqMateScope("org", ids[0]!), generation: 1 }],
        reset: false,
        rows: [
          {
            family: "hqMate",
            id: ids[0]!,
            value: { presence: p, overview, attention: null, attentionState: "none" },
            revision: { kind: "hq", incarnation: "seed", revision },
          },
        ],
        removals: [],
      });
    };
    derives.length = 0;
    published.length = 0;
    sections = 0;
    before.derives = 0;
    before.publications = 0;
    // A's crew changes; B is never derived. Unrelated sections of A stay stable.
    const changed: typeof mate = { ...mate, crew: { status: "none" } };
    delivery(changed, 10000);
    expect(before).toEqual({ derives: 30, publications: 30 });
    expect(derives).toEqual([ids[0]]);
    expect(published).toEqual([ids[0]]);
    expect(sections).toBe(0);
    expect(registry.get(store.data.project(counted, key(ids[1]!)))).toBe(b);
    derives.length = 0;
    published.length = 0;
    delivery(structuredClone(changed), 10001);
    expect(derives).toEqual([ids[0]]);
    expect(published).toEqual([]);
    expect(registry.get(store.data.fact("hqMate", ids[0]!))).toMatchObject({
      revision: { revision: 10001 },
    });
    delivery(
      {
        ...changed,
        logins: {
          codex: { present: true, token: true, signedInBy: "user", lastSignedInBy: "user" },
        },
      },
      10002,
    );
    expect(sections).toBe(1);
    stops.forEach((stop) => stop());
    registry.dispose();
  });

  it("keeps stored words through outage, withholds removal, and reads missing sections as unknown", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    seedHqNavigation(store, "org", { mates: { a: mate } });
    const overview = store.data.project(hqMateOverview, key("a"));
    const linked = store.data.project(hqMatePresence, key("a"));
    seedHqNavigation(store, "org", {
      mates: { a: { presence: { ...presence, online: false, overview: "stored" } } },
      live: false,
    });
    expect(registry.get(overview)).toEqual({
      presence: { ...presence, online: false, overview: "stored" },
    });
    expect(registry.get(linked).live).toBe(false);
    expect(registry.get(store.data.project(hqMateReady, key("a")))).toBeUndefined();
    expect(registry.get(store.data.project(hqMateLogins, key("a")))).toBeUndefined();
    const scope = placementsScope("org");
    store.dispatch({
      kind: "delivery",
      via: "hq-stream",
      scopes: [{ scope, generation: 1 }],
      reset: false,
      rows: [],
      removals: [{ family: "placement", id: "a", reason: "no-access" }],
    });
    expect(registry.get(overview)).toBeNull();
    expect(registry.get(store.data.project(hqMates, "org")).mates).toEqual({});
    registry.dispose();
  });
});

describe("hqMatesAnswered", () => {
  const placed = (projectIds: ReadonlyArray<string>) => ({
    apps: [],
    ungrouped: projectIds.map((projectId) => ({ projectId, name: projectId, mate: { face: "" } })),
  });
  it.each([
    { name: "every placed Mate's last words relayed", unanswered: [], refused: [], answered: true },
    {
      name: "one placed Mate's attention not yet read",
      unanswered: ["b"],
      refused: [],
      answered: false,
    },
    {
      name: "one placed Mate's attention refused",
      unanswered: ["b"],
      refused: ["b"],
      answered: true,
    },
  ])("HQ answered for its Mates: $name", ({ unanswered, refused, answered }) => {
    const store = makeAccountStore(AtomRegistry.make());
    seedHqNavigation(store, "org", {
      structure: placed(["a", "b"]),
      mates: { a: mate },
      attentionUnanswered: unanswered,
    });
    for (const projectId of refused) {
      const scope = hqMateScope("org", projectId);
      for (const event of [
        { kind: "demand", demanded: true },
        { kind: "attempt" },
        {
          kind: "fault",
          jitter: 0,
          fault: { outcome: "authoritative-denial", message: "No" },
        },
      ] as const)
        store.dispatch({ kind: "stream", key: scope, now: 0, event });
    }
    expect(hqMatesAnswered.derive(readsOfState(store.state()), "org")).toBe(answered);
  });
});

describe("hqIndexWord", () => {
  type Store = ReturnType<typeof makeAccountStore>;
  const placedAB = {
    apps: [],
    ungrouped: ["a", "b"].map((projectId) => ({ projectId, name: projectId, mate: { face: "" } })),
  };
  const streamEvent = (store: Store, key: string, event: object) =>
    store.dispatch({ kind: "stream", key, now: 0, event } as never);
  /** HQ's connection asked for and, when `connected`, open. */
  const link = (store: Store, connected: boolean) => {
    streamEvent(store, linkKeys.hq("org"), { kind: "demand", demanded: true });
    streamEvent(store, linkKeys.hq("org"), { kind: "attempt" });
    if (connected) streamEvent(store, linkKeys.hq("org"), { kind: "handshake" });
  };
  /** A scope asked on HQ's connection, still unanswered past a first answer's patience. */
  const waitedOn = (store: Store, scope: string) => {
    streamEvent(store, scope, { kind: "demand", demanded: true });
    streamEvent(store, scope, { kind: "attempt" });
    streamEvent(store, scope, { kind: "grace-over", since: 0 });
  };
  const refuse = (store: Store, scope: string) =>
    streamEvent(store, scope, {
      kind: "fault",
      fault: { outcome: "definitive-refusal", message: "no" },
      jitter: 0,
    });
  const named = (environmentId: string) => ({
    ...mate,
    identity: { ...mate.identity, environmentId: EnvironmentId.make(environmentId) },
  });
  it.each([
    { title: "HQ not asked at all", arrange: () => undefined, word: "due" },
    {
      title: "HQ's connection still connecting, its placements past a first answer's patience",
      arrange: (store: Store) => {
        link(store, false);
        waitedOn(store, placementsScope("org"));
      },
      word: "due",
    },
    {
      title: "HQ's connection open, its placements past a first answer's patience",
      arrange: (store: Store) => {
        link(store, true);
        waitedOn(store, placementsScope("org"));
      },
      word: "slow",
    },
    {
      title: "its placements read, a Mate it places not answered yet",
      arrange: (store: Store) =>
        seedHqNavigation(store, "org", {
          structure: placedAB,
          mates: { a: mate },
          attentionUnanswered: ["b"],
        }),
      word: "due",
    },
    {
      title: "its placements read, a placed Mate's scope past a first answer's patience",
      arrange: (store: Store) => {
        seedHqNavigation(store, "org", {
          structure: placedAB,
          mates: { a: mate },
          attentionUnanswered: ["b"],
        });
        waitedOn(store, hqMateScope("org", "b"));
      },
      word: "slow",
    },
    {
      title: "its placements read, a placed Mate's overview naming no environment",
      arrange: (store: Store) =>
        seedHqNavigation(store, "org", {
          structure: placedAB,
          mates: { a: mate, b: { ...mate, identity: null } as never },
        }),
      word: "due",
    },
    {
      title: "its placements read, a placed Mate answered with no overview",
      arrange: (store: Store) =>
        seedHqNavigation(store, "org", { structure: placedAB, mates: { a: mate } }),
      word: "due",
    },
    {
      title: "its placements read, a placed Mate's scope refused",
      arrange: (store: Store) => {
        seedHqNavigation(store, "org", {
          structure: placedAB,
          mates: { a: mate },
          attentionUnanswered: ["b"],
        });
        refuse(store, hqMateScope("org", "b"));
      },
      word: "answered",
    },
    ...[
      { title: "a placed Mate HQ still holds the birth of, so it never connected", birth: {} },
      {
        title: "a placed Chief whose birth HQ holds until it is registered, past its link",
        birth: { chief: true },
      },
      { title: "a placed Mate adopted, which may have connected before", birth: { adopted: true } },
    ].map(({ title, birth }) => ({
      title,
      arrange: (store: Store) =>
        seedHqNavigation(store, "org", {
          structure: {
            apps: [
              {
                id: "app",
                name: "Shop",
                projects: [
                  { projectId: "a", name: "a", kind: "mate", mate: { face: "" } },
                  { projectId: "b", name: "b", kind: "mate", mate: { face: "", birthId: "birth" } },
                ],
                births: [{ id: "birth", face: "", projectId: "b", ...birth }],
              },
            ],
            ungrouped: [],
          },
          mates: { a: mate },
          attentionUnanswered: ["b"],
        }),
      word: Object.keys(birth).length === 0 ? "answered" : "due",
    })),
    {
      title: "its placements read and every placed Mate naming its environment",
      arrange: (store: Store) =>
        seedHqNavigation(store, "org", {
          structure: placedAB,
          mates: { a: mate, b: named("env-b") },
        }),
      word: "answered",
    },
  ])(
    "an environment HQ's index does not name is absent from it only once every Mate HQ places named its environment, was refused or never connected: $title",
    ({ arrange, word }) => {
      const store = makeAccountStore(AtomRegistry.make());
      arrange(store);
      expect(hqIndexWord.derive(readsOfState(store.state()), "org")).toBe(word);
    },
  );
});
