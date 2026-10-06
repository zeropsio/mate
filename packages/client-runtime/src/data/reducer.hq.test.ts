import { describe, expect, it } from "vite-plus/test";

import {
  hqAppsScope,
  placementsScope,
  type HqAppValue,
  type PlacementValue,
} from "./families/hqNavigation.ts";
import { emptyAccount, linkKeys, type AccountState, type ScopeKey } from "./model.ts";
import { factOf, reduceAccount, type AccountInput } from "./reducer.ts";
import { publicRead, readsOfState } from "./store.ts";

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
  signers: {},
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
  kind: "hq-delivery",
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
