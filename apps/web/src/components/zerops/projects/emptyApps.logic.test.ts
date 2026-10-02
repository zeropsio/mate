import { describe, expect, it } from "vite-plus/test";

import type { HqStructureView } from "~/state/zerops";

import { emptyApplications, groupIsEmpty } from "./emptyApps.logic";

const view = (organizationId: string): HqStructureView => ({
  organizationId,
  structure: {
    ungrouped: [],
    apps: [
      { id: "app-crm", name: "Beviro CRM", projects: [{ projectId: "p-1" }] },
      { id: "app-e2e", name: "mate-rig-e2e-a", projects: [] },
    ],
  } as unknown as NonNullable<HqStructureView["structure"]>,
  changes: null,
  readAt: 0,
  current: true,
  unavailableSince: null,
});

// `mate-rig-e2e-a`, 2026-10-02: a New project that stopped before its Mate left an application
// with no project, drawn nowhere.
describe("the applications HQ holds with no project", () => {
  it.each<{
    readonly name: string;
    readonly view: HqStructureView | null;
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
      view: null,
      organizationId: "org-a",
      apps: [],
    },
  ])("$name", ({ view: given, organizationId, apps }) => {
    expect(emptyApplications(given, organizationId)).toEqual(apps);
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
