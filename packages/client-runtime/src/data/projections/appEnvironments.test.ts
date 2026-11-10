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
  jobs: [],
  release: null,
  birth: null,
} as const;
const PRODUCTION = { ...STAGE, projectId: "prod", tier: "production", name: "production" } as const;

const app = (id: string, environments: unknown, more: object = {}): Row =>
  ({
    family: "hqApp",
    id,
    revision,
    value: {
      id,
      name: id,
      contents: { empty: false, deletingProjectIds: [] },
      projectIds: [],
      births: [],
      environments,
      changes: [],
      releaseOffer: null,
      ...more,
    },
  }) as Row;

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((next, input) => reduceAccount(next, input).state, state);
const deliver = (
  rows: ReadonlyArray<Row>,
  removals: ReadonlyArray<{ family: "hqApp"; id: string }> = [],
): Extract<AccountInput, { readonly kind: "delivery" }> => ({
  kind: "delivery",
  via: "hq-stream",
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
const told = apply(demanded, [deliver([app("shop", [STAGE, PRODUCTION]), app("blog", [STAGE])])]);
const outage = apply(told, [
  {
    kind: "stream",
    key: SCOPE,
    now: 0,
    event: { kind: "fault", fault: { outcome: "transient", message: "down" }, jitter: 0 },
  },
]);
const partial = apply(told, [{ ...deliver([app("blog", [STAGE])]), reset: true }]);
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
const removed = apply(told, [deliver([], [{ family: "hqApp", id: "shop" }])]);

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
    { name: "an application HQ never named", state: told, appId: "none", environments: undefined },
  ])("reads $name", ({ state, appId, environments }) => {
    expect(of(state, appId).environments).toEqual(environments);
  });

  it("reads an application's recent rollouts beside its environments, none from an older HQ", () => {
    const rollouts = [{ id: "41", planned: true, note: "the production tier could not be read" }];
    const state = apply(demanded, [
      deliver([app("shop", [STAGE], { rollouts }), app("blog", [STAGE])]),
    ]);
    expect(of(state, "shop").rollouts).toEqual(rollouts);
    expect(of(state, "blog").rollouts).toBeUndefined();
  });

  it("reads several applications, each apart", () => {
    const read = appsEnvironments.derive(readsOfState(told), {
      orgId: ORG,
      appIds: ["shop", "blog"],
    });
    expect(read.shop?.environments).toEqual([STAGE, PRODUCTION]);
    expect(read.blog?.environments).toEqual([STAGE]);
  });

  it.each([
    {
      name: "one of two",
      sent: [STAGE, { ...PRODUCTION, id: "env-prod", jobs: [{ id: "j", state: "unheard-of" }] }],
      readable: [STAGE],
      unread: [{ id: "env-prod", name: "production", tier: "production" }],
    },
    {
      name: "the only one",
      sent: [{ ...STAGE, keyHeld: "yes" }],
      readable: [],
      unread: [{ id: null, name: "stage", tier: "stage" }],
    },
    {
      name: "one that is not even a record",
      sent: [PRODUCTION, 7],
      readable: [PRODUCTION],
      unread: [{ id: null, name: null, tier: null }],
    },
    { name: "none", sent: [STAGE, PRODUCTION], readable: [STAGE, PRODUCTION], unread: [] },
  ])(
    "An environment this build cannot read shows as unread, never as an application without it: $name",
    ({ sent, readable, unread }) => {
      const state = apply(demanded, [deliver([app("shop", sent)])]);
      const read = of(state, "shop");
      expect(read.environments).toEqual(readable);
      expect(read.unread).toEqual(unread);
    },
  );
});
