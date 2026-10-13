import { describe, expect, it } from "vite-plus/test";

import {
  hqAppFamily,
  hqAppsScope,
  placementsScope,
  type HqAppValue,
  type PlacementValue,
} from "./families/hqNavigation.ts";
import { emptyAccount, linkKeys, type AccountState, type ScopeKey } from "./model.ts";
import { factOf, reduceAccount, type AccountInput } from "./reducer.ts";
import { publicRead, readsOfState } from "./store.ts";
import { gitEnvironment } from "./__fixtures__/hqWire.ts";
import { hqNavigation } from "./projections/hqNavigation.ts";

const ORG = "org";
const apps = hqAppsScope(ORG);
const placements = placementsScope(ORG);

const app = (id: string, name: string): HqAppValue => ({
  id,
  name,
  can: {},
  contents: { empty: false, deletingProjectIds: [] },
  projectIds: [],
  births: [],
  environments: [],
  changes: [],
  releaseOffer: null,
});
const project = (projectId: string, appId: string | null): PlacementValue => ({
  projectId,
  appId,
  name: projectId,
  kind: "mate",
  mate: null,
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

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((next, input) => reduceAccount(next, input).state, state);

/** The link and both scopes demanded and in their first attempt (generation 1). */
function attached(): AccountState {
  const now = 0;
  return apply(emptyAccount, [
    { kind: "stream", key: linkKeys.hq(ORG), now, event: { kind: "demand", demanded: true } },
    ...[apps, placements].flatMap((key): AccountInput[] => [
      { kind: "stream", key, now, event: { kind: "demand", demanded: true } },
      { kind: "stream", key, now, event: { kind: "attempt" } },
    ]),
  ]);
}

const scopes = (generation = 1) => [
  { scope: apps, generation },
  { scope: placements, generation },
];

const delivery = (input: {
  readonly reset?: boolean;
  readonly incarnation?: string;
  readonly revision: number;
  readonly rows?: ReadonlyArray<
    | { readonly family: "hqApp"; readonly id: string; readonly value: HqAppValue }
    | { readonly family: "placement"; readonly id: string; readonly value: PlacementValue }
  >;
  readonly removals?: ReadonlyArray<{
    readonly family: "hqApp" | "placement";
    readonly id: string;
    readonly reason: "deleted" | "no-access";
  }>;
  readonly generation?: number;
}): AccountInput => ({
  kind: "delivery",
  via: "hq-stream",
  scopes: scopes(input.generation),
  reset: input.reset ?? false,
  rows: (input.rows ?? []).map((row) => ({
    ...row,
    revision: { kind: "hq", incarnation: input.incarnation ?? "a", revision: input.revision },
  })) as never,
  removals: input.removals ?? [],
});

const appName = (state: AccountState, id: string) => {
  const read = publicRead(factOf(state, "hqApp", id));
  return read.kind === "known" ? (read.value as HqAppValue).name : read.kind;
};
const members = (state: AccountState, scope: ScopeKey) => readsOfState(state).members(scope);

describe("an HQ scope's delivery", () => {
  it.each([1, 2, 3])(
    "Git receipt admission follows HQ source revision %s, not the receipt timestamp",
    (revision) => {
      const value = hqAppFamily.hq!.decode(
        { ...app("shop", "Shop"), environments: [gitEnvironment] },
        "app:shop",
      )!;
      const held = apply(attached(), [
        delivery({ revision: 2, rows: [{ family: "hqApp", id: "shop", value }] }),
        { kind: "hq-ready", scopes: scopes() },
      ]);
      const changed = {
        ...gitEnvironment,
        jobs: [
          {
            ...gitEnvironment.jobs[0],
            id: "push-v3",
            ref: "v3.0.0",
            sha: "c".repeat(40),
            state: "queued",
            evidence: null,
            endedAt: null,
          },
        ],
      };
      const newer = hqAppFamily.hq!.decode(
        { ...app("shop", "Shop"), environments: [changed] },
        "app:shop",
      )!;
      const next = apply(held, [
        delivery({ revision, rows: [{ family: "hqApp", id: "shop", value: newer }] }),
      ]);
      expect(hqNavigation.derive(readsOfState(next), ORG).deliveryEnvironments.shop).toEqual([
        revision > 2 ? changed : gitEnvironment,
      ]);
      expect(readsOfState(next).coverage(apps)).toBe("complete");
    },
  );
  it("incomplete Git input preserves evidence, while an explicit environment denial replaces it", () => {
    const value = hqAppFamily.hq!.decode(
      { ...app("shop", "Shop"), environments: [gitEnvironment] },
      "app:shop",
    )!;
    const held = apply(attached(), [
      delivery({ revision: 1, rows: [{ family: "hqApp", id: "shop", value }] }),
    ]);
    const damaged = hqAppFamily.hq!.decode(
      {
        ...app("shop", "Shop"),
        environments: [{ ...gitEnvironment, jobs: [{ ...gitEnvironment.jobs[0], state: "live" }] }],
      },
      "app:shop",
    )!;
    const preserved = apply(held, [
      delivery({ revision: 2, rows: [{ family: "hqApp", id: "shop", value: damaged }] }),
    ]);
    expect(hqNavigation.derive(readsOfState(preserved), ORG).deliveryEnvironments.shop).toEqual([
      gitEnvironment,
    ]);
    const denied = hqAppFamily.hq!.decode(
      { ...app("shop", "Shop"), environments: { refused: "Cannot read changes" } },
      "app:shop",
    )!;
    const purged = apply(preserved, [
      delivery({ revision: 3, rows: [{ family: "hqApp", id: "shop", value: denied }] }),
    ]);
    expect(hqNavigation.derive(readsOfState(purged), ORG).deliveryEnvironments.shop).toEqual({
      refused: "Cannot read changes",
    });
    expect(JSON.stringify([...purged.facts.values()])).not.toContain("push-v2");
  });
  it.each([
    { revision: 2, keys: ["hqApp:shop"] },
    { revision: 1, keys: [] },
    { revision: 0, keys: [] },
  ])(
    "publishes only admitted facts for an existing member at revision $revision",
    ({ revision, keys }) => {
      const held = apply(attached(), [
        delivery({
          revision: 1,
          rows: [{ family: "hqApp", id: "shop", value: app("shop", "Shop") }],
        }),
      ]);
      const reduced = reduceAccount(
        held,
        delivery({
          revision,
          rows: [{ family: "hqApp", id: "shop", value: app("shop", "Changed") }],
        }),
      );
      expect([...reduced.changed]).toEqual(keys);
      expect(reduced.state.memberships).toBe(held.memberships);
    },
  );

  it("does not relist a retained fact from a rejected row", () => {
    const held = apply(attached(), [
      delivery({
        revision: 2,
        rows: [{ family: "hqApp", id: "shop", value: app("shop", "Shop") }],
      }),
      { kind: "left", scope: apps, generation: 1, id: "shop" },
    ]);
    const rejected = reduceAccount(
      held,
      delivery({ revision: 1, rows: [{ family: "hqApp", id: "shop", value: app("shop", "Old") }] }),
    );
    expect(rejected.changed.size).toBe(0);
    expect(rejected.state).toBe(held);
    expect(members(rejected.state, apps).ids).toEqual([]);
  });

  it("lists a new admitted member and retains omitted reset keys without publication", () => {
    const added = reduceAccount(
      attached(),
      delivery({
        revision: 1,
        rows: [{ family: "hqApp", id: "shop", value: app("shop", "Shop") }],
      }),
    );
    expect(added.changed).toEqual(new Set(["hqApp:shop", `members:${apps}`]));
    const omitted = reduceAccount(
      added.state,
      delivery({ reset: true, incarnation: "b", revision: 0 }),
    );
    expect(omitted.changed.size).toBe(0);
    expect(omitted.state).toBe(added.state);
  });

  it.each(["deleted", "no-access"] as const)(
    "publishes exclusion and owner reauthorization after %s",
    (reason) => {
      const held = apply(attached(), [
        delivery({
          revision: 1,
          rows: [{ family: "hqApp", id: "shop", value: app("shop", "Shop") }],
        }),
      ]);
      const removed = reduceAccount(
        held,
        delivery({ revision: 2, removals: [{ family: "hqApp", id: "shop", reason }] }),
      );
      expect(removed.changed).toEqual(new Set(["hqApp:shop", `members:${apps}`]));
      expect(members(removed.state, apps).excluded).toEqual(["shop"]);
      const repeated = reduceAccount(
        removed.state,
        delivery({ revision: 2, removals: [{ family: "hqApp", id: "shop", reason }] }),
      );
      expect(repeated.changed).toEqual(new Set(["hqApp:shop"]));
      expect(repeated.state.memberships).toBe(removed.state.memberships);
      const restored = reduceAccount(
        removed.state,
        delivery({
          reset: true,
          revision: 3,
          rows: [{ family: "hqApp", id: "shop", value: app("shop", "Restored") }],
        }),
      );
      expect(restored.changed).toEqual(new Set(["hqApp:shop", `members:${apps}`]));
      expect(members(restored.state, apps)).toMatchObject({ ids: ["shop"], excluded: [] });
    },
  );

  it("publishes coverage once and rejects obsolete deliveries without publication", () => {
    const held = attached();
    const ready = reduceAccount(held, { kind: "hq-ready", scopes: scopes() });
    expect(ready.changed).toEqual(
      new Set([
        `coverage:${apps}`,
        `members:${apps}`,
        `coverage:${placements}`,
        `members:${placements}`,
      ]),
    );
    expect(reduceAccount(ready.state, { kind: "hq-ready", scopes: scopes() }).changed.size).toBe(0);
    const late = reduceAccount(
      ready.state,
      delivery({
        generation: 0,
        revision: 9,
        rows: [{ family: "hqApp", id: "late", value: app("late", "Late") }],
      }),
    );
    expect(late.changed.size).toBe(0);
    expect(late.state).toBe(ready.state);
  });

  it.each([undefined, "bad", { head: 42 }])(
    "commits readable facts while the offered release is unknown: %s",
    (releaseOffer) => {
      const decoded = hqAppFamily.hq!.decode({ ...app("shop", "Shop"), releaseOffer }, "app:shop")!;
      const state = apply(attached(), [
        delivery({
          reset: true,
          revision: 1,
          rows: [{ family: "hqApp", id: "shop", value: app("shop", "Before") }],
        }),
        delivery({ revision: 2, rows: [{ family: "hqApp", id: "shop", value: decoded }] }),
      ]);
      const fact = readsOfState(state).fact("hqApp", "shop");
      expect(fact).toMatchObject({
        kind: "known",
        value: { name: "Shop", environments: [], projectIds: [] },
      });
      if (fact.kind === "known") expect(fact.value.releaseOffer).toBeUndefined();
      expect(members(state, apps).ids).toContain("shop");
    },
  );

  it("commits every family's records of one delivery together", () => {
    const state = apply(attached(), [
      delivery({
        reset: true,
        revision: 1,
        rows: [
          { family: "hqApp", id: "shop", value: app("shop", "Shop") },
          { family: "placement", id: "ada", value: project("ada", "shop") },
        ],
      }),
    ]);
    expect(appName(state, "shop")).toBe("Shop");
    expect(members(state, apps).ids).toEqual(["shop"]);
    expect(members(state, placements).ids).toEqual(["ada"]);
  });

  it.each([
    { name: "a later revision replaces", second: { revision: 2 }, expected: "Shop 2" },
    { name: "an older revision changes nothing", second: { revision: 0 }, expected: "Shop" },
    {
      name: "another incarnation's delta changes nothing",
      second: { revision: 9, incarnation: "b" },
      expected: "Shop",
    },
    {
      name: "another incarnation's reset replaces",
      second: { revision: 0, incarnation: "b", reset: true },
      expected: "Shop 2",
    },
  ])("$name", ({ second, expected }) => {
    const state = apply(attached(), [
      delivery({
        reset: true,
        revision: 1,
        rows: [{ family: "hqApp", id: "shop", value: app("shop", "Shop") }],
      }),
      delivery({
        ...second,
        rows: [{ family: "hqApp", id: "shop", value: app("shop", "Shop 2") }],
      }),
    ]);
    expect(appName(state, "shop")).toBe(expected);
  });

  it("keeps a record a reset leaves out: only an explicit removal takes it", () => {
    const state = apply(attached(), [
      delivery({
        reset: true,
        revision: 1,
        rows: [{ family: "hqApp", id: "shop", value: app("shop", "Shop") }],
      }),
      delivery({ reset: true, incarnation: "b", revision: 1 }),
    ]);
    expect(appName(state, "shop")).toBe("Shop");
    expect(members(state, apps).ids).toEqual(["shop"]);
  });

  it.each([
    { reason: "deleted" as const, read: "deleted" },
    { reason: "no-access" as const, read: "withheld" },
  ])("a removal for $reason unlists the record and reads $read", ({ reason, read }) => {
    const state = apply(attached(), [
      delivery({
        reset: true,
        revision: 1,
        rows: [{ family: "hqApp", id: "shop", value: app("shop", "Shop") }],
      }),
      delivery({ revision: 2, removals: [{ family: "hqApp", id: "shop", reason }] }),
    ]);
    expect(appName(state, "shop")).toBe(read);
    expect(members(state, apps).ids).toEqual([]);
  });

  it("fences out a delivery of a superseded registration whole", () => {
    const state = apply(attached(), [
      delivery({
        reset: true,
        revision: 1,
        generation: 0,
        rows: [{ family: "hqApp", id: "shop", value: app("shop", "Shop") }],
      }),
    ]);
    expect(appName(state, "shop")).toBe("unknown");
  });

  it("completes the scopes' coverage only when HQ says catchup ended", () => {
    const delivered = apply(attached(), [
      delivery({
        reset: true,
        revision: 1,
        rows: [{ family: "hqApp", id: "shop", value: app("shop", "Shop") }],
      }),
    ]);
    expect(readsOfState(delivered).coverage(apps)).toBe("unknown");
    const ready = apply(delivered, [{ kind: "hq-ready", scopes: scopes() }]);
    expect(readsOfState(ready).coverage(apps)).toBe("complete");
    expect(readsOfState(ready).coverage(placements)).toBe("complete");
  });
});
