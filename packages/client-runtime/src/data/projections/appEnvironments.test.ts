import { describe, expect, it } from "vite-plus/test";

import { hqAppsScope } from "../families/hqNavigation.ts";
import { emptyAccount, linkKeys, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { appEnvironments, appsEnvironments } from "./appEnvironments.ts";

const ORG = "org";
const SCOPE = hqAppsScope(ORG);
const revision = { kind: "hq", incarnation: "i", revision: 1 } as const;

const STAGE = {
  projectId: "stage",
  tier: "stage",
  name: "stage",
  sources: ["main"],
  order: 1,
  keyHeld: true,
  keyInvalid: false,
  can: {},
  jobs: [],
  release: null,
  birth: null,
} as const;
const PRODUCTION = { ...STAGE, projectId: "prod", tier: "production", name: "production" } as const;

const app = (id: string, environments: unknown): Row =>
  ({
    family: "hqApp",
    id,
    revision,
    value: {
      id,
      name: id,
      can: {},
      contents: { empty: false, deletingProjectIds: [] },
      projectIds: [],
      births: [],
      environments,
      changes: [],
    },
  }) as Row;

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((next, input) => reduceAccount(next, input).state, state);
const deliver = (
  rows: ReadonlyArray<Row>,
  removals: ReadonlyArray<{ family: "hqApp"; id: string; reason: "deleted" | "no-access" }> = [],
): Extract<AccountInput, { readonly kind: "hq-delivery" }> => ({
  kind: "hq-delivery",
  scopes: [{ scope: SCOPE, generation: 1 }],
  reset: false,
  rows,
  removals,
});

const demanded = apply(emptyAccount, [
  { kind: "stream", key: linkKeys.hq(ORG), now: 0, event: { kind: "demand", demanded: true } },
  { kind: "stream", key: SCOPE, now: 0, event: { kind: "demand", demanded: true } },
  { kind: "stream", key: SCOPE, now: 0, event: { kind: "attempt" } },
  { kind: "stream", key: SCOPE, now: 0, event: { kind: "handshake" } },
]);
const told = apply(demanded, [
  deliver([app("shop", [STAGE, PRODUCTION]), app("blog", { refused: "read_change" })]),
]);
const outage = apply(told, [
  {
    kind: "stream",
    key: SCOPE,
    now: 0,
    event: { kind: "fault", fault: { outcome: "transient", message: "down" }, jitter: 0 },
  },
]);
const partial = apply(told, [
  { ...deliver([app("blog", { refused: "read_change" })]), reset: true },
]);
const refused = apply(told, [
  {
    kind: "stream",
    key: SCOPE,
    now: 1,
    event: {
      kind: "fault",
      fault: { outcome: "definitive-refusal", message: "Refused" },
      jitter: 0,
    },
  },
]);
const removed = apply(told, [deliver([], [{ family: "hqApp", id: "shop", reason: "no-access" }])]);

const of = (state: AccountState, appId: string) =>
  appEnvironments.derive(readsOfState(state), { orgId: ORG, appId });

describe("appEnvironments", () => {
  it.each([
    { name: "nothing told yet", state: demanded, appId: "shop", environments: undefined },
    { name: "told", state: told, appId: "shop", environments: [STAGE, PRODUCTION] },
    {
      name: "told, then HQ went down",
      state: outage,
      appId: "shop",
      environments: [STAGE, PRODUCTION],
    },
    {
      name: "a partial reset omitted it",
      state: partial,
      appId: "shop",
      environments: [STAGE, PRODUCTION],
    },
    {
      name: "the stream refused",
      state: refused,
      appId: "shop",
      environments: [STAGE, PRODUCTION],
    },
    { name: "the application withheld", state: removed, appId: "shop", environments: undefined },
    { name: "refused to the reader", state: told, appId: "blog", environments: undefined },
    { name: "an application HQ never named", state: told, appId: "none", environments: undefined },
  ])("reads $name", ({ state, appId, environments }) => {
    expect(of(state, appId).environments).toEqual(environments);
  });

  it.each([
    { appId: "blog", refused: "read_change" },
    { appId: "shop", refused: null },
    { appId: "none", refused: null },
  ])("says HQ's refusal of $appId's environments as $refused", ({ appId, refused }) => {
    expect(of(told, appId).refused).toBe(refused);
  });

  it("reads several applications, each apart", () => {
    const read = appsEnvironments.derive(readsOfState(told), {
      orgId: ORG,
      appIds: ["shop", "blog"],
    });
    expect(read.shop?.environments).toEqual([STAGE, PRODUCTION]);
    expect(read.blog).toEqual({ environments: undefined, refused: "read_change" });
  });
});
