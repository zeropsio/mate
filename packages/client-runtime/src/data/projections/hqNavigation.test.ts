import { describe, expect, it } from "vite-plus/test";

import { hqMateScope } from "../families/hqMate.ts";
import {
  hqAppsScope,
  hqOrganizationScope,
  hqPeopleScope,
  hqPressesScope,
  hqStatusScope,
  placementsScope,
} from "../families/hqNavigation.ts";
import { emptyAccount, linkKeys, type AccountState, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { hqMates } from "./hqMates.ts";
import { hqNavigation, hqPersonFacts, hqStatus } from "./hqNavigation.ts";

const ORG = "org";
const NAV: ReadonlyArray<ScopeKey> = [
  hqOrganizationScope(ORG),
  hqStatusScope(ORG),
  hqAppsScope(ORG),
  placementsScope(ORG),
  hqPeopleScope(ORG),
  hqPressesScope(ORG),
];
const revision = { kind: "hq", incarnation: "i", revision: 1 } as const;

const person = { role: "DEVELOPER", mayWrite: true, mine: true, unseen: null };
const mate = {
  face: "",
  madeBy: null,
  standupRequestedBy: null,
  closedOff: false,
  keyWider: false,
};
const rows: ReadonlyArray<Row> = [
  {
    family: "hqOrganization",
    id: ORG,
    revision,
    value: { can: {}, unheld: {}, tools: [], build: "b1" },
  },
  {
    family: "hqStatus",
    id: ORG,
    revision,
    value: { official: "ok", parts: { quarantined: [] } },
  },
  {
    family: "hqApp",
    id: "shop",
    revision,
    value: {
      id: "shop",
      name: "Shop",
      can: {},
      contents: { empty: false, deletingProjectIds: [] },
      projectIds: ["ada", "stage"],
      births: [],
    },
  },
  {
    family: "placement",
    id: "ada",
    revision,
    value: { projectId: "ada", appId: "shop", name: "Ada", kind: "mate", mate, person },
  },
  {
    family: "placement",
    id: "stage",
    revision,
    value: { projectId: "stage", appId: "shop", name: "Stage", kind: "stage", mate: null, person },
  },
  {
    family: "placement",
    id: "lone",
    revision,
    value: { projectId: "lone", appId: null, name: "Lone", kind: "mate", mate, person },
  },
  { family: "hqPerson", id: "u1", revision, value: { name: "Jan", clientUserId: "cu1" } },
  { family: "hqPress", id: "p1", revision, value: { kind: "stage", appId: "shop" } },
];

const stream = (
  key: ScopeKey | ReturnType<typeof linkKeys.hq>,
  event: StreamEvent,
): AccountInput => ({
  kind: "stream",
  key,
  now: 0,
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
  { kind: "hq-delivery", scopes: generations, reset: true, rows, removals: [] },
  { kind: "hq-ready", scopes: generations },
  ...NAV.map((scope) => stream(scope, { kind: "baseline-committed" })),
]);
const down = apply(read, [
  stream(linkKeys.hq(ORG), {
    kind: "fault",
    fault: { outcome: "transient", message: "HQ's stream broke." },
    jitter: 0,
  }),
  ...NAV.map((scope) => stream(scope, { kind: "parent-lost" })),
]);
const refused = apply(read, [
  stream(hqAppsScope(ORG), {
    kind: "fault",
    fault: { outcome: "definitive-refusal", message: "Zerops refused HQ." },
    jitter: 0,
  }),
]);
const removed = apply(read, [
  {
    kind: "hq-delivery",
    scopes: generations,
    reset: false,
    rows: [],
    removals: [
      { family: "placement", id: "lone", reason: "deleted" },
      { family: "placement", id: "stage", reason: "no-access" },
    ],
  },
]);

const navigation = (state: AccountState) => hqNavigation.derive(readsOfState(state), ORG);

describe("hqNavigation", () => {
  it.each([
    {
      name: "not asked",
      state: emptyAccount,
      expected: { read: "unread", structure: null, live: false },
    },
    {
      name: "first catchup",
      state: demanded,
      expected: { read: "reading", structure: null, live: false },
    },
    { name: "read", state: read, expected: { read: "read", live: true, reconnecting: false } },
    { name: "HQ down", state: down, expected: { read: "read", live: false, reconnecting: true } },
    {
      name: "refused",
      state: refused,
      expected: {
        live: false,
        refusal: "Zerops refused HQ.",
        unavailableReason: "expired-session",
      },
    },
  ])("$name", ({ state, expected }) => {
    expect(navigation(state)).toMatchObject(expected);
  });

  it("places each project in its application, and HQ's Mates in none apart", () => {
    const { structure, people, presses, organization } = navigation(read);
    expect(
      structure?.apps.map(({ name, projects }) => [name, projects.map((p) => p.name)]),
    ).toEqual([["Shop", ["Ada", "Stage"]]]);
    expect(structure?.ungrouped.map(({ name }) => name)).toEqual(["Lone"]);
    expect(people).toEqual({ u1: { name: "Jan", clientUserId: "cu1" } });
    expect(presses).toEqual({ p1: { kind: "stage", appId: "shop" } });
    expect(organization?.build).toBe("b1");
  });

  it("says when HQ's retries are as far apart as they get", () => {
    const failing = (failures: number) =>
      apply(
        read,
        Array.from({ length: failures }, () =>
          stream(linkKeys.hq(ORG), {
            kind: "fault",
            fault: { outcome: "transient", message: "HQ's stream broke." },
            jitter: 0,
          }),
        ),
      );
    expect(navigation(failing(1)).capped).toBe(false);
    expect(navigation(failing(7)).capped).toBe(true);
  });

  it("is catching up while what it read is asked again on a new socket", () => {
    const asking = apply(down, [
      stream(linkKeys.hq(ORG), { kind: "retry-due" }),
      ...NAV.flatMap((scope) => [
        stream(scope, { kind: "attempt" }),
        stream(scope, { kind: "handshake" }),
      ]),
    ]);
    expect(navigation(asking)).toMatchObject({ live: false, reconnecting: true });
  });

  it("keeps what it read through an outage", () => {
    expect(navigation(down).structure).toEqual(navigation(read).structure);
  });

  it("drops a project HQ removed, deleted or withheld", () => {
    const { structure } = navigation(removed);
    expect(structure?.apps[0]?.projects.map(({ name }) => name)).toEqual(["Ada"]);
    expect(structure?.ungrouped).toEqual([]);
  });
});

describe("hqMates", () => {
  const presence = { online: true, since: "2026-10-06T00:00:00Z", overview: "live" } as const;
  const withMate = apply(read, [
    stream(hqMateScope(ORG, "ada"), { kind: "demand", demanded: true }),
    stream(hqMateScope(ORG, "ada"), { kind: "attempt" }),
    {
      kind: "hq-delivery",
      scopes: [{ scope: hqMateScope(ORG, "ada"), generation: 1 }],
      reset: true,
      rows: [
        {
          family: "hqMate",
          id: "ada",
          revision,
          value: { presence, overview: null, attention: null, attentionState: "none" },
        },
      ],
      removals: [],
    },
  ]);

  it.each([
    { name: "a relayed Mate, live", state: withMate, live: true, mates: { ada: { presence } } },
    { name: "none relayed yet", state: read, live: true, mates: {} },
  ])("$name", ({ state, live, mates }) => {
    expect(hqMates.derive(readsOfState(state), ORG)).toEqual({ live, mates });
  });

  it("keeps a Mate's last word through an outage, no longer live", () => {
    const outage = apply(withMate, [
      stream(linkKeys.hq(ORG), {
        kind: "fault",
        fault: { outcome: "transient", message: "HQ's stream broke." },
        jitter: 0,
      }),
    ]);
    expect(hqMates.derive(readsOfState(outage), ORG)).toEqual({
      live: false,
      mates: { ada: { presence } },
    });
  });
});

describe("hqPersonFacts", () => {
  it("is what HQ computed of the reader for each project it places, none it removed", () => {
    expect(hqPersonFacts.derive(readsOfState(read), ORG)).toEqual({
      ada: person,
      stage: person,
      lone: person,
    });
    expect(hqPersonFacts.derive(readsOfState(removed), ORG)).toEqual({ ada: person });
    expect(hqPersonFacts.derive(readsOfState(emptyAccount), ORG)).toEqual({});
  });
});

describe("hqStatus", () => {
  it("is how HQ stands as its navigation says it, apart from the organization's record", () => {
    expect(hqStatus.derive(readsOfState(read), ORG)).toEqual({
      official: "ok",
      parts: { quarantined: [] },
    });
    expect(hqStatus.derive(readsOfState(emptyAccount), ORG)).toBeNull();
  });
});
