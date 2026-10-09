import { hqProjectPeople } from "./hqProjectPeople.ts";
import { describe, expect, it } from "vite-plus/test";

import { hqMateScope } from "../families/hqMate.ts";
import {
  hqAppFamily,
  placementFamily,
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
import { pastGrace } from "../__fixtures__/account.ts";
import { hqMates } from "./hqMates.ts";
import {
  hqAppReleaseOffers,
  hqAppChanges,
  hqNavigation,
  hqPersonFacts,
  hqStatus,
} from "./hqNavigation.ts";

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
  heldForMs: 30_000,
  until: "2026-10-06T00:00:30.000Z",
} as const;
const person = {
  role: "DEVELOPER",
  mayWrite: true,
  mine: true,
  ownerUserId: null,
  waitsOnViewer: false,
  unseen: null,
};
const mate = {
  face: "",
  madeBy: null,
  standupRequestedBy: null,
  closedOff: false,
  setupMarker: null,
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
  {
    family: "hqPerson",
    id: "u1",
    revision,
    value: { name: "Jan", clientUserId: "cu1", avatarUrl: null },
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
]);
const down = pastGrace(
  apply(read, [
    stream(linkKeys.hq(ORG), {
      kind: "fault",
      fault: { outcome: "transient", message: "HQ's stream broke." },
      jitter: 0,
    }),
    ...NAV.map((scope) => stream(scope, { kind: "parent-lost" })),
  ]),
);
const refused = apply(read, [
  stream(hqAppsScope(ORG), {
    kind: "fault",
    fault: { outcome: "definitive-refusal", message: "Zerops refused HQ." },
    jitter: 0,
  }),
]);
const removed = apply(read, [
  {
    kind: "delivery",
    via: "hq-stream",
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

  it.each([
    ["live", read],
    ["outage", down],
    ["refusal", refused],
    ["partial", demanded],
  ] as const)("preserves grouping with an unknown offer during %s", (_name, state) => {
    const raw = {
      id: "shop",
      name: "Shop",
      can: {},
      contents: { empty: false, deletingProjectIds: [] },
      environments: [],
      changes: [],
      projectIds: ["ada", "stage"],
      births: [],
    };
    const app = hqAppFamily.hq!.decode(raw, "app:shop")!;
    const next = apply(state, [
      {
        kind: "delivery",
        via: "hq-stream",
        scopes: generations,
        reset: true,
        rows: [
          ...rows.filter((row) => row.family !== "hqApp"),
          { family: "hqApp", id: "shop", value: app, revision: { ...revision, revision: 2 } },
        ],
        removals: [],
      },
    ]);
    expect(navigation(next).structure?.apps[0]?.projects.map(({ name }) => name)).toEqual([
      "Ada",
      "Stage",
    ]);
    expect(hqAppReleaseOffers.derive(readsOfState(next), ORG).shop).toBeUndefined();
  });

  it("keeps the placement when Mate metadata is unknown without claiming there is no Mate", () => {
    const placed = placementFamily.hq!.decode(
      { projectId: "ada", appId: "shop", name: "Ada", kind: "mate", mate: 42 },
      "project:ada",
    )!;
    const next = apply(read, [
      {
        kind: "delivery",
        via: "hq-stream",
        scopes: generations,
        reset: false,
        rows: [
          { family: "placement", id: "ada", value: placed, revision: { ...revision, revision: 2 } },
        ],
        removals: [],
      },
    ]);
    expect(navigation(next).structure?.apps[0]?.projects[0]).toMatchObject({
      projectId: "ada",
      name: "Ada",
      kind: "mate",
    });
    expect(navigation(next).structure?.apps[0]?.projects[0]?.mate).toBeUndefined();
  });

  it("places each project in its application, and HQ's Mates in none apart", () => {
    const { structure, people, presses, organization } = navigation(read);
    expect(
      structure?.apps.map(({ name, projects }) => [name, projects.map((p) => p.name)]),
    ).toEqual([["Shop", ["Ada", "Stage"]]]);
    expect(structure?.ungrouped.map(({ name }) => name)).toEqual(["Lone"]);
    expect(people).toEqual({ u1: { name: "Jan", clientUserId: "cu1", avatarUrl: null } });
    expect(presses).toEqual({ p1: PRESS });
    expect(organization?.build).toBe("b1");
  });

  it("says when HQ's retries are as far apart as they get", () => {
    const failing = (failures: number) =>
      apply(read, [
        stream(linkKeys.hq(ORG), {
          kind: "fault",
          fault: { outcome: "transient", message: "Closed" },
          jitter: 0,
        }),
        ...Array.from({ length: failures }, () => [
          stream(linkKeys.hq(ORG), { kind: "retry-due" }),
          stream(linkKeys.hq(ORG), {
            kind: "fault",
            fault: { outcome: "transient", message: "Reconnect failed" },
            jitter: 0,
          }),
        ]).flat(),
      ]);
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

  it("a planned HQ reconnect is no outage: what it read stays current while HQ confirms it again", () => {
    // HQ ends every segment after 100 s; the new socket asks for each scope again.
    const reasking = apply(
      read,
      NAV.flatMap((scope) => [
        stream(scope, { kind: "attempt" }, 100_000),
        stream(scope, { kind: "handshake" }, 100_080),
      ]),
    );
    expect(navigation(reasking)).toMatchObject({ live: true, reconnecting: false });
    expect(navigation(reasking).downSince).toBeUndefined();
    const confirmed = apply(reasking, [
      { kind: "hq-ready", scopes: NAV.map((scope) => ({ scope, generation: 2 })) },
      ...NAV.map((scope) => stream(scope, { kind: "baseline-committed" }, 100_200)),
    ]);
    expect(navigation(confirmed)).toMatchObject({ live: true, reconnecting: false });
  });

  it("is down only once HQ stays away past the grace, and down since it went away", () => {
    const lost = apply(read, [
      stream(
        linkKeys.hq(ORG),
        {
          kind: "fault",
          fault: { outcome: "transient", message: "HQ's stream broke." },
          jitter: 0,
        },
        60_000,
      ),
      ...NAV.map((scope) => stream(scope, { kind: "parent-lost" }, 60_000)),
    ]);
    expect(navigation(lost)).toMatchObject({ live: true, reconnecting: false });
    expect(navigation(pastGrace(lost))).toMatchObject({
      live: false,
      reconnecting: true,
      downSince: 60_000,
    });
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
      kind: "delivery",
      via: "hq-stream",
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
    const outage = pastGrace(
      apply(withMate, [
        stream(linkKeys.hq(ORG), {
          kind: "fault",
          fault: { outcome: "transient", message: "HQ's stream broke." },
          jitter: 0,
        }),
      ]),
    );
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

describe("hqAppChanges", () => {
  it("is each application's open changes as HQ's navigation says them", () => {
    expect(hqAppChanges.derive(readsOfState(read), ORG)).toEqual({ shop: [CHANGE] });
    expect(hqAppChanges.derive(readsOfState(emptyAccount), ORG)).toEqual({});
  });
});

describe("HQ-computed Mate owners", () => {
  const owners = (read: ReturnType<typeof readsOfState>, orgId: string) =>
    Object.fromEntries(
      Object.entries(hqProjectPeople.derive(read, orgId)).flatMap(([id, entry]) =>
        entry.owner === null ? [] : [[id, { userId: entry.owner.userId, name: entry.owner.name }]],
      ),
    );
  const owned = (state: AccountState, ownerUserId: string | null) =>
    apply(state, [
      {
        kind: "delivery",
        via: "hq-stream",
        scopes: generations,
        reset: false,
        removals: [],
        rows: [
          {
            family: "placement",
            id: "ada",
            revision: { ...revision, revision: 2 },
            value: {
              projectId: "ada",
              appId: "shop",
              name: "Ada",
              kind: "mate",
              mate,
              person: { ...person, ownerUserId },
              signedInNow: {},
              everSignedIn: { codex: "other" },
            },
          },
        ],
      },
    ]);
  it.each([
    { name: "live", state: read, owner: "u1", expected: { ada: { userId: "u1", name: "Jan" } } },
    {
      name: "outage keeps the owner",
      state: down,
      owner: "u1",
      expected: { ada: { userId: "u1", name: "Jan" } },
    },
    {
      name: "a scope refusal keeps known evidence",
      state: refused,
      owner: "u1",
      expected: { ada: { userId: "u1", name: "Jan" } },
    },
    { name: "partial person coverage", state: read, owner: "unknown", expected: {} },
    { name: "HQ names no owner despite a saved signer", state: read, owner: null, expected: {} },
  ])("$name", ({ state, owner, expected }) => {
    expect(owners(readsOfState(owned(state, owner)), ORG)).toEqual(expected);
  });
  it("withholds an owner when HQ denies their person fact", () => {
    const state = apply(owned(read, "u1"), [
      { kind: "access", family: "hqPerson", id: "u1", access: "denied" },
    ]);
    expect(owners(readsOfState(state), ORG)).toEqual({});
  });
  it("moves the owner on newer HQ evidence without reading project grants", () => {
    const before = owned(read, "u1");
    const after = apply(before, [
      {
        kind: "delivery",
        via: "hq-stream",
        scopes: generations,
        reset: false,
        removals: [],
        rows: [
          {
            family: "placement",
            id: "ada",
            revision: { ...revision, revision: 3 },
            value: {
              projectId: "ada",
              appId: "shop",
              name: "Ada",
              kind: "mate",
              mate,
              person: { ...person, ownerUserId: null },
              signedInNow: {},
              everSignedIn: { codex: "u1" },
            },
          },
        ],
      },
    ]);
    expect(owners(readsOfState(before), ORG)).toEqual({
      ada: { userId: "u1", name: "Jan" },
    });
    expect(owners(readsOfState(after), ORG)).toEqual({});
  });
});

describe("release offers from navigation", () => {
  const offer = {
    head: "a".repeat(40),
    suggestion: "v0.1.1",
    gate: { allow: true },
    inFlight: null,
    summary: { subjects: ["Dynamic bakery greeting"], total: 1, more: 0, atLeast: false },
  } as const;
  it.each([
    ["live", read],
    ["outage", down],
    ["refused scope retains facts", refused],
  ] as const)("%s needs no app detail and preserves the owner's offer", (_label, state) => {
    const next = reduceAccount(state, {
      kind: "delivery",
      via: "hq-stream",
      scopes: generations,
      reset: false,
      removals: [],
      rows: [
        {
          family: "hqApp",
          id: "shop",
          revision: { ...revision, revision: 2 },
          value: {
            ...(rows[2]!.value as import("../families/hqNavigation.ts").HqAppValue),
            releaseOffer: offer,
          },
        },
      ],
    }).state;
    expect(hqAppReleaseOffers.derive(readsOfState(next), ORG).shop).toEqual(offer);
  });
});
