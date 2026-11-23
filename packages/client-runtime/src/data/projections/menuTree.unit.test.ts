import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import {
  hqAppsScope,
  hqBirthsScope,
  hqOrganizationScope,
  hqStatusScope,
  placementFamily,
  placementsScope,
  type HqAppValue,
  type HqPersonFacts,
} from "../families/hqNavigation.ts";
import { emptyAccount, linkKeys, type AccountState, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { projectsScope } from "../families/project.ts";
import { liveProjects } from "../__fixtures__/account.ts";
import { recorded } from "../__fixtures__/recorded.ts";
import { membershipInputs } from "../__fixtures__/membership.ts";
import {
  accessAsksOf,
  MENU_LOADING,
  menuMateVisibilities,
  menuPlacedProjectIds,
  menuTree,
  type MenuEnvironment,
  type MenuGroup,
  type MenuMember,
} from "./menuTree.ts";

const ORG = "org";
const NAV: ReadonlyArray<ScopeKey> = [
  hqOrganizationScope(ORG),
  hqStatusScope(ORG),
  hqAppsScope(ORG),
  placementsScope(ORG),
  hqBirthsScope(ORG),
];
const revision = { kind: "hq", incarnation: "i", revision: 1 } as const;
const unentered = { mine: true, ownerUserId: null, waitsOnViewer: false, unseen: null };
const person = { ...unentered, entry: "operates" } as const;

const stream = (key: ScopeKey | ReturnType<typeof linkKeys.hq>, event: StreamEvent) =>
  ({ kind: "stream", key, now: 0, event }) satisfies AccountInput;
const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((next, input) => reduceAccount(next, input).state, state);
const generations = NAV.map((scope) => ({ scope, generation: 1 }));

/** HQ's navigation said these records, and the roster of `user` lists these projects. */
function treeOf(
  records: ReadonlyArray<Row>,
  roster: ReadonlyArray<{ readonly id: string; readonly tagList?: ReadonlyArray<string> }> = [],
  then: ReadonlyArray<AccountInput> = [],
) {
  const state = apply(emptyAccount, [
    stream(linkKeys.hq(ORG), { kind: "demand", demanded: true }),
    ...NAV.flatMap((scope) => [
      stream(scope, { kind: "demand", demanded: true }),
      stream(scope, { kind: "attempt" }),
      stream(scope, { kind: "handshake" }),
    ]),
    stream(linkKeys.hq(ORG), { kind: "handshake" }),
    stream(linkKeys.hq(ORG), { kind: "baseline-committed" }),
    {
      kind: "delivery",
      via: "hq-stream",
      scopes: generations,
      reset: true,
      rows: [
        { family: "hqOrganization", id: ORG, revision, value: { build: "b1" } },
        { family: "hqStatus", id: ORG, revision, value: { parts: { quarantined: [] } } },
        ...records,
      ],
      removals: [],
    },
    { kind: "hq-ready", scopes: generations },
    ...NAV.map((scope) => stream(scope, { kind: "baseline-committed" })),
    ...liveProjects(ORG, roster),
    ...membershipInputs("BASIC_USER"),
    ...then,
  ]);
  return menuTree.derive(readsOfState(state), ORG);
}

const app = (
  id: string,
  createdAt: string,
  environments: NonNullable<HqAppValue["environments"]> = [],
): Row => ({
  family: "hqApp",
  id,
  revision,
  value: {
    id,
    name: id,
    createdAt,
    contents: { empty: false, deletingProjectIds: [] },
    projectIds: [],
    births: [],
    environments,
    changes: [],
    releaseOffer: null,
  },
});

const placed = (
  projectId: string,
  appId: string | null,
  bornAt: string,
  birthId?: string,
  chief?: "mine" | "another",
): Row => ({
  family: "placement",
  id: projectId,
  revision,
  value: {
    projectId,
    appId,
    name: projectId,
    kind: "mate",
    mate: {
      face: "",
      madeBy: null,
      standupRequestedBy: null,
      bornAt,
      ...(birthId === undefined ? {} : { birthId }),
    },
    person: chief === undefined ? person : { ...person, chief },
    signedInNow: {},
    everSignedIn: {},
  },
});

const birth = (
  id: string,
  projectId: string | null,
  chief?: { readonly madeBy: string; readonly chiefRegistered: boolean },
): Row => ({
  family: "hqBirth",
  id,
  revision,
  value: {
    id,
    face: "",
    projectId,
    startedAt: "2026-11-01T10:00:00.000Z",
    operation: {
      kind: "birth",
      phase: "accepted",
      at: "2026-11-01T10:00:00.000Z",
      acceptedAt: "2026-11-01T10:00:00.000Z",
    },
    state: "running",
    offers: [],
    ...(chief === undefined ? {} : { chief: true, ...chief }),
  },
});

// witness: packages/client-runtime/src/data/projections/menuTree.ts | key: value.mate.birthId ?? id, → key: id,
it("PJ113: A birth and the Mate born of it are one member under the birth's id, before and after the hello; breaks: a new Mate's row is drawn twice or changes key", () => {
  const born = "2026-11-01T10:02:00.000Z";
  const keys = (tree: ReturnType<typeof treeOf>) =>
    tree.ungrouped.map((member) => [member.key, member.projectId, member.placement !== null]);
  // Its birth alone, before Zerops made its project.
  expect(keys(treeOf([birth("b1", null)]))).toEqual([["b1", null, false]]);
  // The hello: HQ places its project while its birth is still open.
  expect(keys(treeOf([birth("b1", "quinn"), placed("quinn", null, born, "b1")]))).toEqual([
    ["b1", "quinn", true],
  ]);
  // Its birth ended: the Mate alone, under the same key.
  expect(keys(treeOf([placed("quinn", null, born, "b1")]))).toEqual([["b1", "quinn", true]]);
});

// witness: packages/client-runtime/src/data/projections/menuTree.ts | (right.createdAt ?? "").localeCompare(left.createdAt ?? "") || → (left.createdAt ?? "").localeCompare(right.createdAt ?? "") ||
it("PJ114: Groups are HQ's applications in their creation order and members keep HQ's order from the first frame; breaks: the menu reorders when the roster or a Mate arrives", () => {
  const records = [
    app("alpha", "2026-10-02T00:00:00.000Z"),
    app("beta", "2026-10-01T00:00:00.000Z"),
    placed("zed", "beta", "2026-10-03T00:00:00.000Z"),
    placed("ann", "beta", "2026-10-04T00:00:00.000Z"),
    placed("bea", "alpha", "2026-10-05T00:00:00.000Z"),
  ];
  const order = (tree: ReturnType<typeof treeOf>) =>
    tree.groups.map((group) => [group.id, group.members.map((member) => member.key)]);
  const first = order(treeOf(records));
  expect(first).toEqual([
    ["alpha", ["bea"]],
    ["beta", ["zed", "ann"]],
  ]);
  // The roster arriving, in its own order, moves nothing.
  expect(order(treeOf(records, [{ id: "bea" }, { id: "ann" }, { id: "zed" }]))).toEqual(first);
});

// witness: packages/client-runtime/src/data/projections/menuTree.ts | project.value.tagList?.some((tag) => tag.startsWith(BIRTH_TAG_PREFIX)) !== true → project.value.tagList?.some((tag) => tag.startsWith(BIRTH_TAG_PREFIX)) === true
it("PJ115: A roster project HQ names nowhere is a Platform project unless it carries a birth tag; breaks: a Mate being made is offered Set up Mate", () => {
  const tree = treeOf(
    [placed("ada", null, "2026-10-01T00:00:00.000Z")],
    [
      { id: "ada" },
      { id: "plain", tagList: ["shop"] },
      { id: "making", tagList: ["mb-0123456789abcdef0123456789abcdef"] },
    ],
  );
  expect(tree.platform.map((project) => project.id)).toEqual(["plain"]);
});

// witness: packages/client-runtime/src/data/projections/menuTree.ts | placements.filter(({ value }) => value.appId == null || !listedApps.has(value.appId)), → placements.filter(({ id, value }) => (value.appId == null || !listedApps.has(value.appId)) && read.fact("project", id).kind === "known"),
it("PJ116: A member HQ sends stays drawn until HQ removes it. The roster lacking its project, the person's membership, or an absence being verified never takes it away; breaks: a just-made Mate vanishes until search lists it, or rows leave, return and leave during a demotion", () => {
  const justMade = treeOf([placed("quinn", null, "2026-11-01T10:02:00.000Z")], [{ id: "ada" }]);
  expect(justMade.ungrouped.map((member) => [member.key, member.projectId])).toEqual([
    ["quinn", "quinn"],
  ]);
  expect([...menuPlacedProjectIds(justMade)]).toEqual(["quinn"]);

  // A demotion to No access as it arrived live: the person's membership, the roster's empty
  // answer, the two by-id reads of the project refused; then HQ's no-access removal.
  const records = [placed("quinn", null, "2026-11-01T10:02:00.000Z")];
  const roster = projectsScope(ORG);
  const steps: ReadonlyArray<ReadonlyArray<AccountInput>> = [
    membershipInputs("NO_ACCESS", false, 2),
    [
      stream(roster, { kind: "attempt" }),
      stream(roster, { kind: "handshake" }),
      { kind: "baseline-begin", scope: roster, generation: 2 },
      {
        kind: "baseline-commit",
        scope: roster,
        generation: 2,
        via: "zerops-realtime",
        members: [],
        rows: [],
      },
      stream(roster, { kind: "baseline-committed" }),
    ],
    [{ kind: "access", family: "project", id: "quinn", access: "denied" }],
    [{ kind: "access", family: "project", id: "quinn", access: "denied" }],
  ];
  const members = (then: ReadonlyArray<AccountInput>) =>
    treeOf(records, [{ id: "quinn" }], then).ungrouped.map((member) => member.key);
  const replayed = steps.map((_, index) => members(steps.slice(0, index + 1).flat()));
  expect(replayed).toEqual(steps.map(() => ["quinn"]));

  const removal: AccountInput = {
    kind: "delivery",
    via: "hq-stream",
    scopes: generations,
    reset: false,
    rows: [],
    removals: [{ family: "placement", id: "quinn" }],
  };
  expect(members([...steps.flat(), removal])).toEqual([]);
});

// witness: packages/client-runtime/src/data/projections/menuTree.ts | if (member.birth?.chief === true) return viewer === undefined || member.birth.madeBy === viewer; → if (member.birth?.chief === true) return true;
it("PJ117: The viewer's own Chief and another person's registered Chief are no members of the menu, and a Chief birth another person left for whoever its project reaches is one; breaks: the own Chief is listed beside the header, or a colleague's unfinished Chief cannot be continued from the menu", () => {
  const tree = treeOf([
    placed("own", null, "2026-10-01T00:00:00.000Z", undefined, "mine"),
    placed("theirs", null, "2026-10-02T00:00:00.000Z", undefined, "another"),
    birth("b-mine", "making", { madeBy: "user", chiefRegistered: false }),
    birth("b-left", "left", { madeBy: "colleague", chiefRegistered: false }),
  ]);
  expect(tree.ungrouped.map((member) => member.key)).toEqual(["b-left"]);
  expect([...menuPlacedProjectIds(tree)]).toEqual([]);
});

// witness: packages/client-runtime/src/data/projections/menuTree.ts | ? apps.flatMap(({ id }) => (drawn.has(id) ? [] : [id])) → ? apps.flatMap(({ id }) => (drawn.has(id) ? [id] : []))
it("PJ118: An application HQ lists that the tree draws no group for is named undrawn, and a drawn one never is; breaks: a project page opened on it waits forever, or a drawn project's page says it is left out", () => {
  const tree = treeOf([
    app("seen", "2026-10-02T00:00:00.000Z"),
    app("nothing", "2026-10-01T00:00:00.000Z"),
    placed("bea", "seen", "2026-10-05T00:00:00.000Z"),
  ]);
  expect(tree.groups.map((group) => group.id)).toEqual(["seen"]);
  expect(tree.undrawn).toEqual(["nothing"]);
});

// witness: packages/client-runtime/src/data/projections/menuTree.ts | listsNothing: apps.length === 0 && placements.length === 0 && births.length === 0, → listsNothing: apps.length === 0 && read.members(projectsScope(orgId)).ids.length === 0,
it("PJ122: HQ listing nothing for the person is their first run, and it moves only with HQ's frames: the roster emptied by a demotion before HQ's word, or still empty when HQ lists the person's Mates again after access is given back, never decides it; breaks: the menu hides at a demotion before HQ removes its rows, or stays behind the first run after a give-back", () => {
  const records = [placed("quinn", null, "2026-11-01T10:02:00.000Z")];
  const roster = projectsScope(ORG);
  // HQ's answer to the subscribe Zerops' access event makes: its reset of the person's navigation
  // at a newer revision, removing what the person no longer sees of the keys the web knew, then
  // its ready.
  const hqAnswer = (
    at: number,
    rows: ReadonlyArray<Row>,
    removals: ReadonlyArray<{ readonly family: "placement"; readonly id: string }> = [],
  ): ReadonlyArray<AccountInput> => {
    const revisionAt = { ...revision, revision: at };
    return [
      {
        kind: "delivery",
        via: "hq-stream",
        scopes: generations,
        reset: true,
        rows: [
          { family: "hqOrganization", id: ORG, revision: revisionAt, value: { build: "b1" } },
          {
            family: "hqStatus",
            id: ORG,
            revision: revisionAt,
            value: { parts: { quarantined: [] } },
          },
          ...rows.map((row) => ({ ...row, revision: revisionAt })),
        ],
        removals,
      },
      { kind: "hq-ready", scopes: generations },
    ];
  };
  // Membership before and after, Zerops' roster and by-id reads, and HQ's frames: Zerops' word
  // before HQ's each way, the order in which the first run hid the menu.
  const steps: ReadonlyArray<ReadonlyArray<AccountInput>> = [
    // Demoted to No access: Zerops says it first.
    [
      ...membershipInputs("NO_ACCESS", false, 2),
      stream(roster, { kind: "attempt" }),
      stream(roster, { kind: "handshake" }),
      { kind: "baseline-begin", scope: roster, generation: 2 },
      {
        kind: "baseline-commit",
        scope: roster,
        generation: 2,
        via: "zerops-realtime",
        members: [],
        rows: [],
      },
      stream(roster, { kind: "baseline-committed" }),
      { kind: "access", family: "project", id: "quinn", access: "denied" },
    ],
    // HQ's word on the demotion: nothing of the organization is the person's.
    hqAnswer(2, [], [{ family: "placement", id: "quinn" }]),
    // Access given back: Zerops' membership says it; its roster is not read again yet.
    membershipInputs("BASIC_USER", false, 3),
    // HQ's first answer after it lists the person's Mate again.
    hqAnswer(3, records),
  ];
  const seen = (then: ReadonlyArray<AccountInput>) => {
    const tree = treeOf(records, [{ id: "quinn" }], then);
    return [tree.listsNothing, tree.ungrouped.map((member) => member.key)];
  };
  expect(steps.map((_, index) => seen(steps.slice(0, index + 1).flat()))).toEqual([
    [false, ["quinn"]],
    [true, []],
    [true, []],
    [false, ["quinn"]],
  ]);
  // Before HQ answered there is no first run to say.
  expect(MENU_LOADING.listsNothing).toBe(false);
});

// witness: packages/client-runtime/src/data/projections/menuTree.ts | member.environment.target.kind !== "outside" → true
it("PJ125: An application whose stages and productions the person reaches none of asks read access for each one HQ names hidden, and one with a reachable stage or production, or none hidden, asks none; breaks: a person who sees nothing of an application finds no way to ask from its page, or a person with a stage is asked again on top of Who has access", () => {
  const h1 = { id: "p-hidden-prod", tier: "production" } as const;
  const h2 = { id: "p-hidden-stage", tier: "stage" } as const;
  const member = (environment: MenuEnvironment["environment"]): MenuEnvironment => ({
    kind: "environment",
    key: environment.id,
    environment,
    projectId: environment.target.kind === "zerops" ? environment.target.projectId : null,
    placement: null,
  });
  const mate: MenuMember = {
    kind: "mate",
    key: "p-mate",
    projectId: "p-mate",
    bornAt: "2026-10-01T00:00:00.000Z",
    birth: null,
    intent: undefined,
    placement: null,
    visibility: "open",
  };
  const outside = member({
    id: HqEnvironmentId.make("env-outside"),
    tier: "production",
    name: "production",
    target: { kind: "outside", address: null, setBy: "u1", setAt: "2026-10-01T00:00:00.000Z" },
  });
  const stage = member({
    id: HqEnvironmentId.make("env-stage"),
    target: { kind: "zerops", projectId: ProjectId.make("p-stage") },
    tier: "stage",
    name: "stage",
    sources: [],
    order: 1,
    keyHeld: false,
    keyInvalid: false,
    jobs: [],
    release: null,
    birth: null,
  });
  const group = (
    members: ReadonlyArray<MenuMember>,
    hiddenEnvironments: MenuGroup["hiddenEnvironments"],
  ): MenuGroup => ({
    id: "shop",
    name: "shop",
    createdAt: "2026-10-01T00:00:00.000Z",
    empty: false,
    hiddenEnvironments,
    members,
  });
  expect(
    [
      group([], [h1, h2]),
      group([mate], [h1]),
      group([outside], [h1]),
      group([stage], [h2]),
      group([], []),
    ].map(accessAsksOf),
  ).toEqual([[h1, h2], [h1], [h1], [], []]);
});

// witness: packages/client-runtime/src/zerops/mateAccess.ts | entry === undefined ? "unknown" : entry === "operates" ? "open" : "listed"; → entry === undefined ? "unknown" : "open";
it("PJ127: A Mate member of the menu opens when HQ's entry says the person operates it, is only listed when HQ says read only or none, is judged neither way until the entry arrives, and stays a member whatever it says; breaks: a Read-only person is offered Open, or a Mate leaves the menu on the web's verdict", () => {
  const entered = (entry: HqPersonFacts["entry"] | undefined) => {
    const row = placed("quinn", null, "2026-11-01T10:02:00.000Z");
    return {
      ...row,
      value: {
        ...(row.value as object),
        person: entry === undefined ? unentered : { ...unentered, entry },
      },
    } as Row;
  };
  const seen = (entry: HqPersonFacts["entry"] | undefined) => {
    const tree = treeOf([entered(entry)]);
    return [
      tree.ungrouped.map((member) => [member.key, member.visibility]),
      menuMateVisibilities(tree).get("quinn"),
    ];
  };
  expect(seen("operates")).toEqual([[["quinn", "open"]], "open"]);
  expect(seen("read_only")).toEqual([[["quinn", "listed"]], "listed"]);
  expect(seen("none")).toEqual([[["quinn", "listed"]], "listed"]);
  expect(seen(undefined)).toEqual([[["quinn", "unknown"]], undefined]);

  // HQ's own frame: the project it places for the person, with the entry it recorded.
  const frame = recorded("scope-reset", "mate-hq/navigation.scope-reset");
  const raw = frame.values.find(({ key }) => key === "project:v2")?.value;
  const value = placementFamily.hq!.decode(raw, "project:v2")!;
  const tree = treeOf([{ family: "placement", id: "v2", revision, value }]);
  expect(menuMateVisibilities(tree).get("v2")).toBe("open");
});

// witness: packages/client-runtime/src/data/projections/menuTree.ts | (value.mate != null && birth.projectId != null && id === birth.projectId), → (birth.projectId != null && id === birth.projectId),
it("PJ140: An open birth on a project HQ holds with no Mate is that project's member, drawn from its birth with no placement, and no plain row stands beside it; breaks: a setup stopped early reads as No Mate yet and its Continue and Delete cannot be reached", () => {
  const shop = app("shop", "2026-10-01T00:00:00.000Z");
  const held = placed("plain", "shop", "2026-11-01T10:02:00.000Z");
  const records = [
    { ...shop, value: { ...(shop.value as object), births: [birth("b1", "plain").value] } },
    { ...held, value: { ...(held.value as object), kind: "plain", mate: null } },
  ] as ReadonlyArray<Row>;
  const members = treeOf(records).groups[0]?.members ?? [];
  expect(members.map((member) => [member.kind, member.key, member.placement === null])).toEqual([
    ["mate", "b1", true],
  ]);
});
