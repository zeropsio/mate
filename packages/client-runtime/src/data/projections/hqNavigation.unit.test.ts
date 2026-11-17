import { expect, it } from "vite-plus/test";

import {
  hqAppFamily,
  hqAppsScope,
  hqOrganizationScope,
  hqPressesScope,
  hqStatusScope,
  placementsScope,
} from "../families/hqNavigation.ts";
import { emptyAccount, linkKeys, type AccountState, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { liveProjects } from "../__fixtures__/account.ts";
import { membershipInputs } from "../__fixtures__/membership.ts";
import { hqNavigation } from "./hqNavigation.ts";
import { membersScope } from "../families/organizationMembers.ts";

const ORG = "org";
const NAV: ReadonlyArray<ScopeKey> = [
  hqOrganizationScope(ORG),
  hqStatusScope(ORG),
  hqAppsScope(ORG),
  placementsScope(ORG),
  hqPressesScope(ORG),
];
const revision = { kind: "hq", incarnation: "i", revision: 1 } as const;

const CHANGE = {
  repo: "app",
  number: 7,
  mateProjectId: "ada",
  title: "Quicker checkout",
  state: "open",
  hasHead: true,
  updatedAt: "2026-10-06T00:00:00.000Z",
  mergeability: "clean",
  ready: true,
} as const;
const PRESS = {
  kind: "stage",
  appId: "shop",
  held: true,
} as const;
const person = {
  mine: true,
  ownerUserId: null,
  waitsOnViewer: false,
  unseen: null,
};
const mate = {
  face: "",
  madeBy: null,
  standupRequestedBy: null,
};
const rows: ReadonlyArray<Row> = [
  {
    family: "hqOrganization",
    id: ORG,
    revision,
    value: { build: "b1" },
  },
  {
    family: "hqStatus",
    id: ORG,
    revision,
    value: { parts: { quarantined: [] } },
  },
  {
    family: "hqApp",
    id: "shop",
    revision,
    value: {
      id: "shop",
      name: "Shop",
      contents: { empty: false, deletingProjectIds: [] },
      projectIds: ["ada", "stage"],
      births: [],
      environments: [],
      changes: [CHANGE],
      releaseOffer: null,
    },
  },
  {
    family: "placement",
    id: "ada",
    revision,
    value: {
      projectId: "ada",
      appId: "shop",
      name: "Ada",
      kind: "mate",
      mate,
      person,
      signedInNow: {},
      everSignedIn: {},
    },
  },
  {
    family: "placement",
    id: "stage",
    revision,
    value: {
      projectId: "stage",
      appId: "shop",
      name: "Stage",
      kind: "stage",
      mate: null,
      person,
      signedInNow: {},
      everSignedIn: {},
    },
  },
  {
    family: "placement",
    id: "lone",
    revision,
    value: {
      projectId: "lone",
      appId: null,
      name: "Lone",
      kind: "mate",
      mate,
      person,
      signedInNow: {},
      everSignedIn: {},
    },
  },
  { family: "hqPress", id: "p1", revision, value: PRESS },
];

const stream = (
  key: ScopeKey | ReturnType<typeof linkKeys.hq>,
  event: StreamEvent,
  now = 0,
): AccountInput => ({
  kind: "stream",
  key,
  now,
  event,
});
const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((next, input) => reduceAccount(next, input).state, state);
const generations = NAV.map((scope) => ({ scope, generation: 1 }));

const demanded = apply(emptyAccount, [
  stream(linkKeys.hq(ORG), { kind: "demand", demanded: true }),
  ...NAV.flatMap((scope) => [
    stream(scope, { kind: "demand", demanded: true }),
    stream(scope, { kind: "attempt" }),
    stream(scope, { kind: "handshake" }),
  ]),
]);

const read = apply(demanded, [
  stream(linkKeys.hq(ORG), { kind: "handshake" }),
  stream(linkKeys.hq(ORG), { kind: "baseline-committed" }),
  { kind: "delivery", via: "hq-stream", scopes: generations, reset: true, rows, removals: [] },
  { kind: "hq-ready", scopes: generations },
  ...NAV.map((scope) => stream(scope, { kind: "baseline-committed" })),
  // The organization's member list names HQ's user ids (`GET /client/{id}/user/list`).
  stream(membersScope(ORG), { kind: "demand", demanded: true }),
  stream(membersScope(ORG), { kind: "attempt" }),
  stream(membersScope(ORG), { kind: "handshake" }),
  { kind: "baseline-begin", scope: membersScope(ORG), generation: 1 },
  {
    kind: "baseline-commit",
    scope: membersScope(ORG),
    generation: 1,
    via: "zerops-read",
    members: [ORG],
    rows: [
      {
        family: "organizationMembers",
        id: ORG,
        value: [{ id: "cu1", userId: "u1", user: { id: "u1", fullName: "Jan" } }],
        revision: { kind: "zerops", version: null },
      },
    ],
  },
]);

const navigation = (state: AccountState) => hqNavigation.derive(readsOfState(state), ORG);

/** The shop limiting who merges to `people`, read by a Basic user whose Zerops user id is `user`. */
const shop = (people: ReadonlyArray<string> | undefined) => {
  const app = hqAppFamily.hq!.decode(
    {
      id: "shop",
      name: "Shop",
      contents: { empty: false, deletingProjectIds: [] },
      environments: [],
      changes: [],
      releaseOffer: null,
      projectIds: ["ada", "stage"],
      births: [],
      ...(people === undefined
        ? {}
        : { mergers: { people, setBy: "owner", setAt: "2026-11-12T09:00:00.000Z" } }),
    },
    "app:shop",
  )!;
  return navigation(
    apply(read, [
      ...liveProjects(ORG, [{ id: "ada" }, { id: "stage" }, { id: "lone" }]),
      ...membershipInputs("BASIC_USER"),
      {
        kind: "delivery",
        via: "hq-stream",
        scopes: generations,
        reset: false,
        rows: [{ family: "hqApp", id: "shop", value: app, revision: { ...revision, revision: 2 } }],
        removals: [],
      },
    ]),
  ).structure?.apps[0];
};

// witness: packages/client-runtime/src/data/projections/permissionFacts.ts | ...(app.mergers == null ? {} : { mergers: app.mergers }), →
it("PJ8: A project that limits who merges holds Merge for a person it does not name", () => {
  expect(shop(["ada-k", "sam-r"])?.can?.merge_change).toEqual({
    allow: false,
    reason: "not_app_merger",
  });
  expect(shop(undefined)?.can?.merge_change).toEqual({ allow: true });
});

// witness: packages/client-runtime/src/data/projections/permissionFacts.ts | userId: user.value.id, →
it("PJ9: The person a project names among those who merge is offered Merge", () => {
  expect(shop(["ada-k", "user"])?.can?.merge_change).toEqual({ allow: true });
});

// witness: packages/client-runtime/src/data/projections/hqNavigation.ts | ...(app.mergers == null ? {} : { mergers: app.mergers }), →
it("PJ10: The people a project names reach its surfaces as HQ's navigation holds them", () => {
  expect(shop(["ada-k", "sam-r"])?.mergers?.people).toEqual(["ada-k", "sam-r"]);
  expect(shop(undefined)?.mergers).toBeUndefined();
});
