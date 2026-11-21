import { expect, it } from "vite-plus/test";

import {
  hqAppsScope,
  hqBirthsScope,
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
import { menuPlacedProjectIds, menuTree } from "./menuTree.ts";

const ORG = "org";
const NAV: ReadonlyArray<ScopeKey> = [
  hqOrganizationScope(ORG),
  hqStatusScope(ORG),
  hqAppsScope(ORG),
  placementsScope(ORG),
  hqPressesScope(ORG),
  hqBirthsScope(ORG),
];
const revision = { kind: "hq", incarnation: "i", revision: 1 } as const;
const person = { mine: true, ownerUserId: null, waitsOnViewer: false, unseen: null };

const stream = (key: ScopeKey | ReturnType<typeof linkKeys.hq>, event: StreamEvent) =>
  ({ kind: "stream", key, now: 0, event }) satisfies AccountInput;
const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((next, input) => reduceAccount(next, input).state, state);
const generations = NAV.map((scope) => ({ scope, generation: 1 }));

/** HQ's navigation said these records, and the roster of `user` lists these projects. */
function treeOf(
  records: ReadonlyArray<Row>,
  roster: ReadonlyArray<{ readonly id: string; readonly tagList?: ReadonlyArray<string> }> = [],
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
  ]);
  return menuTree.derive(readsOfState(state), ORG);
}

const app = (id: string, createdAt: string): Row => ({
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
    environments: [],
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
    ...(chief === undefined ? {} : { chief: true, ...chief }),
  },
});

// witness: packages/client-runtime/src/data/projections/menuTree.ts | key: value.mate.birthId ?? id, → key: id,
it("PJ+2: A birth and the Mate born of it are one member under the birth's id, before and after the hello; breaks: a new Mate's row is drawn twice or changes key", () => {
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
it("PJ+3: Groups are HQ's applications in their creation order and members keep HQ's order from the first frame; breaks: the menu reorders when the roster or a Mate arrives", () => {
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

// witness: packages/client-runtime/src/data/projections/menuTree.ts | project.value.tagList?.some((tag) => tag.startsWith(BIRTH_TAG_PREFIX)) !== true → project.value.tagList?.some((tag) => tag.startsWith(BIRTH_TAG_PREFIX)) !== false
it("PJ+4: A roster project HQ names nowhere is a Platform project unless it carries a birth tag; breaks: a Mate being made is offered Set up Mate", () => {
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
it("PJ+5: A member HQ sends stays while the roster lacks its project; breaks: a just-made Mate vanishes until search lists it", () => {
  const tree = treeOf([placed("quinn", null, "2026-11-01T10:02:00.000Z")], [{ id: "ada" }]);
  expect(tree.ungrouped.map((member) => [member.key, member.projectId])).toEqual([
    ["quinn", "quinn"],
  ]);
  expect([...menuPlacedProjectIds(tree)]).toEqual(["quinn"]);
});

// witness: packages/client-runtime/src/data/projections/menuTree.ts | if (member.birth?.chief === true) return viewer === undefined || member.birth.madeBy === viewer; → if (member.birth?.chief === true) return true;
it("PJ+6: The viewer's own Chief and another person's registered Chief are no members of the menu, and a Chief birth another person left for whoever its project reaches is one; breaks: the own Chief is listed beside the header, or a colleague's unfinished Chief cannot be continued from the menu", () => {
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
it("PJ+7: An application HQ lists that the tree draws no group for is named undrawn, and a drawn one never is; breaks: a project page opened on it waits forever, or a drawn project's page says it is left out", () => {
  const tree = treeOf([
    app("seen", "2026-10-02T00:00:00.000Z"),
    app("nothing", "2026-10-01T00:00:00.000Z"),
    placed("bea", "seen", "2026-10-05T00:00:00.000Z"),
  ]);
  expect(tree.groups.map((group) => group.id)).toEqual(["seen"]);
  expect(tree.undrawn).toEqual(["nothing"]);
});
