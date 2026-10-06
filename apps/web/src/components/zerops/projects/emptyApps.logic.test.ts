import { buildZeropsGroupTree } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import { NOT_READ_HQ } from "@t3tools/client-runtime/data";

import type { HqNavigationView } from "~/state/zerops";

import {
  applicationContents,
  deleteOffered,
  emptyApplications,
  emptyMateLine,
  groupIsEmpty,
  heldLine,
} from "./emptyApps.logic";

const view = (organizationId: string): HqNavigationView => ({
  ...NOT_READ_HQ,
  orgId: organizationId,
  read: "read",
  live: true,
  structure: {
    ungrouped: [],
    apps: [
      { id: "app-crm", name: "Beviro CRM", projects: [{ projectId: "p-1" }] },
      { id: "app-e2e", name: "mate-rig-e2e-a", projects: [] },
    ],
  } as unknown as NonNullable<HqNavigationView["structure"]>,
});

// `mate-rig-e2e-a`, 2026-10-02: a New project that stopped before its Mate left an application
// with no project, drawn nowhere.
describe("the applications HQ holds with no project", () => {
  it.each<{
    readonly name: string;
    readonly view: HqNavigationView;
    readonly organizationId: string | undefined;
    readonly apps: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  }>([
    {
      name: "are drawn, by id and name, for the organization in view",
      view: view("org-a"),
      organizationId: "org-a",
      apps: [{ id: "app-e2e", name: "mate-rig-e2e-a" }],
    },
    {
      name: "are none of another organization's",
      view: view("org-b"),
      organizationId: "org-a",
      apps: [],
    },
    {
      name: "are none before HQ's structure is read",
      view: { ...NOT_READ_HQ, orgId: "org-a" },
      organizationId: "org-a",
      apps: [],
    },
  ])("$name", ({ view: given, organizationId, apps }) => {
    expect(emptyApplications(given, organizationId)).toEqual(apps);
  });
});

// E2E 2026-10-03 (F5): Ada's presses left the applications a, a2 and a3, seen only on the Git
// page, and the bare project `mate-rig-e2e-a - Ada` in no application. The projects page draws
// each application as its project, empty — offered *Add a Mate* — and the bare project ungrouped.
describe("the applications a stopped press left, on the projects page", () => {
  it("draws each as its project, empty, beside the bare project left ungrouped", () => {
    const structure = {
      ungrouped: [],
      apps: [
        { id: "app-a", name: "mate-rig-e2e-a", projects: [] },
        { id: "app-a2", name: "mate-rig-e2e-a2", projects: [] },
        { id: "app-a3", name: "mate-rig-e2e-a3", projects: [] },
        { id: "app-a4", name: "mate-rig-e2e-a4", projects: [{ projectId: "p-a4" }] },
      ],
    } as unknown as NonNullable<HqNavigationView["structure"]>;
    const given = { ...view("org-a"), structure };
    const bare = {
      project: { id: "p-a", name: "mate-rig-e2e-a - Ada", status: "ACTIVE", tagList: ["mate"] },
    };
    const tree = buildZeropsGroupTree([bare], {
      order: "name",
      apps: emptyApplications(given, "org-a"),
    });
    expect(tree.groups.map(({ group }) => [group.name, groupIsEmpty(group)])).toEqual([
      ["mate-rig-e2e-a", true],
      ["mate-rig-e2e-a2", true],
      ["mate-rig-e2e-a3", true],
    ]);
    expect(tree.ungrouped.map(({ project }) => project.name)).toEqual(["mate-rig-e2e-a - Ada"]);
  });
});

describe("a group with nothing in it", () => {
  it.each([
    { name: "no member and none coming: empty", environments: 0, pending: 0, empty: true },
    { name: "a member listed: not empty", environments: 1, pending: 0, empty: false },
    { name: "a member coming: not empty", environments: 0, pending: 1, empty: false },
  ])("$name", ({ environments, pending, empty }) => {
    expect(
      groupIsEmpty({
        environments: Array.from({ length: environments }, () => ({}) as never),
        pending: Array.from({ length: pending }, () => ({}) as never),
      }),
    ).toBe(empty);
  });
});

// The lead, 2026-10-03: an empty application is deleted from its heading's menu — offered only on
// one with nothing in it, and only to whoever writes the structure (`delete_app`).
describe("Delete, on a project's menu", () => {
  const group = (environments: number, pending: number) => ({
    environments: Array.from({ length: environments }, () => ({}) as never),
    pending: Array.from({ length: pending }, () => ({}) as never),
  });
  it.each([
    { name: "empty, to a writer: offered", group: group(0, 0), mayDelete: true, offered: true },
    { name: "empty, to anyone else: not", group: group(0, 0), mayDelete: false, offered: false },
    { name: "holding a Mate: not", group: group(1, 0), mayDelete: true, offered: false },
    { name: "a Mate coming: not", group: group(0, 1), mayDelete: true, offered: false },
  ])("$name", ({ group: given, mayDelete, offered }) => {
    expect(deleteOffered(given, mayDelete, { empty: true, deletingProjectIds: [] })).toBe(offered);
  });
});

describe("HQ's word on an application's contents", () => {
  it("keeps the application's row when HQ still projects the deleting Mate but the client no longer lists it", () => {
    const given = view("org-a");
    const structure = {
      ungrouped: [],
      apps: [
        {
          id: "app-zed",
          name: "Zed's app",
          projects: [{ projectId: "zed", name: "Zed", kind: "mate", mate: null }],
          contents: { empty: false, deletingProjectIds: ["zed"] },
        },
      ],
    };
    const tree = buildZeropsGroupTree([], {
      order: "name",
      apps: emptyApplications({ ...given, structure }, "org-a"),
    });
    expect(tree.groups.map(({ group }) => group.groupId)).toEqual(["app-zed"]);
  });

  it.each([
    ["unknown", undefined, "Checking what HQ holds…"],
    ["held", { empty: false, deletingProjectIds: [] }, "HQ still holds this project's records."],
    ["deleting", { empty: false, deletingProjectIds: ["zed"] }, "Deletion is still in progress."],
    ["empty", { empty: true, deletingProjectIds: [] }, "No Mate yet"],
  ] as const)("requires HQ's empty answer before offering Delete: %s", (_state, contents, line) => {
    expect(deleteOffered({ environments: [], pending: [] }, true, contents)).toBe(
      contents?.empty === true,
    );
    expect(emptyMateLine(contents)).toBe(line);
  });

  it("uses only the current structure for this organization and application id", () => {
    const contents = { empty: true, deletingProjectIds: [] };
    const given = {
      ...view("org-a"),
      structure: { ungrouped: [], apps: [{ id: "app-e2e", name: "Zed", projects: [], contents }] },
    };
    expect(applicationContents(given, "org-a", "app-e2e")).toEqual(contents);
    expect(applicationContents(given, "org-b", "app-e2e")).toBeUndefined();
    expect(applicationContents(given, "org-a", "other-id")).toBeUndefined();
    expect(applicationContents({ ...given, live: false }, "org-a", "app-e2e")).toBeUndefined();
    expect(
      applicationContents({ ...given, live: false, reconnecting: true }, "org-a", "app-e2e"),
    ).toBeUndefined();
  });
});

describe("what HQ still holds, on a project's row", () => {
  it.each([
    [
      "a deletion under way, Mates left",
      1,
      { empty: false, deletingProjectIds: ["zed"] },
      "Deletion is still in progress.",
    ],
    [
      "a deletion under way, no Mate left",
      0,
      { empty: false, deletingProjectIds: ["zed"] },
      "Deletion is still in progress.",
    ],
    [
      "no Mate, HQ still holding records",
      0,
      { empty: false, deletingProjectIds: [] },
      "HQ still holds this project's records.",
    ],
    // Nothing for nothing: the menu offers its first Mate.
    ["no Mate, nothing held", 0, { empty: true, deletingProjectIds: [] }, undefined],
    // Not HQ's current answer: nothing is claimed.
    ["no Mate, HQ's word not known", 0, undefined, undefined],
    ["Mates, nothing deleting", 1, { empty: false, deletingProjectIds: [] }, undefined],
  ] as const)("%s", (_name, mates, contents, expected) => {
    expect(heldLine(mates, contents)).toBe(expected);
  });
});
