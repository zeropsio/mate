import { describe, expect, it, vi } from "vite-plus/test";

import {
  planProjectLeave,
  planProjectMove,
  planProjectRenames,
  projectRenameTrouble,
  renameStillDue,
  renamesLeft,
  runProjectRenames,
} from "./projectRenames.logic";

describe("planProjectRenames — what each project of an application is renamed to", () => {
  it.each([
    {
      case: "a Mate named in full moves to the new application's name",
      projects: [{ id: "p1", name: "SPN - Rune" }],
      plan: [{ projectId: "p1", from: "SPN - Rune", to: "Shop - Rune" }],
    },
    {
      case: "a stage and a production, as a Mate",
      projects: [
        { id: "p2", name: "SPN - stage" },
        { id: "p3", name: "SPN - production" },
      ],
      plan: [
        { projectId: "p2", from: "SPN - stage", to: "Shop - stage" },
        { projectId: "p3", from: "SPN - production", to: "Shop - production" },
      ],
    },
    {
      case: "a project without the old prefix: its whole name is its own",
      projects: [{ id: "p4", name: "Sage" }],
      plan: [{ projectId: "p4", from: "Sage", to: "Shop - Sage" }],
    },
    {
      case: "a stale prefix of another application is its own name too",
      projects: [{ id: "p5", name: "Old - Rune" }],
      plan: [{ projectId: "p5", from: "Old - Rune", to: "Shop - Old - Rune" }],
    },
    {
      case: "a project already named for the new application is left as it is",
      projects: [{ id: "p6", name: "Shop - Ada" }],
      plan: [],
    },
    {
      case: "a project named as the old application alone keeps it as its own name",
      projects: [{ id: "p7", name: "SPN" }],
      plan: [{ projectId: "p7", from: "SPN", to: "Shop - SPN" }],
    },
  ])("$case", ({ projects, plan }) => {
    expect(planProjectRenames(projects, "SPN", "Shop")).toEqual(plan);
  });

  it("builds nothing where the old name is not read: no prefix can be told from a name", () => {
    expect(planProjectRenames([{ id: "p1", name: "SPN - Rune" }], undefined, "Shop")).toEqual([]);
  });

  it("builds nothing where the name does not change", () => {
    expect(planProjectRenames([{ id: "p1", name: "SPN - Rune" }], "SPN", "SPN")).toEqual([]);
  });
});

describe("planProjectMove — the rename of a Mate moved into another application", () => {
  it.each([
    { case: "from its old application", name: "SPN - Rune", old: "SPN", to: "Shop - Rune" },
    {
      case: "from no application: its whole name is its own",
      name: "Rune",
      old: undefined,
      to: "Shop - Rune",
    },
    {
      case: "with a prefix that is not its application's",
      name: "Old - Rune",
      old: "SPN",
      to: "Shop - Old - Rune",
    },
    {
      case: "already named for the new application",
      name: "Shop - Rune",
      old: undefined,
      to: undefined,
    },
  ])("renames $name $case", ({ name, old, to }) => {
    expect(planProjectMove({ id: "p1", name }, old, "Shop")).toEqual(
      to === undefined ? [] : [{ projectId: "p1", from: name, to }],
    );
  });
});

describe("planProjectLeave — the rename of a Mate that leaves every application", () => {
  it.each([
    { case: "named in full: its own name alone", name: "SPN - Rune", old: "SPN", to: "Rune" },
    { case: "without its application's prefix: as it is", name: "Rune", old: "SPN", to: undefined },
    { case: "in no application: as it is", name: "SPN - Rune", old: undefined, to: undefined },
    {
      case: "a prefix that is not its application's",
      name: "Old - Rune",
      old: "SPN",
      to: undefined,
    },
  ])("renames $name $case", ({ name, old, to }) => {
    expect(planProjectLeave({ id: "p1", name }, old)).toEqual(
      to === undefined ? [] : [{ projectId: "p1", from: name, to }],
    );
  });
});

describe("runProjectRenames — every project is tried, a refusal is kept", () => {
  const plan = [
    { projectId: "p1", from: "SPN - Rune", to: "Shop - Rune" },
    { projectId: "p2", from: "SPN - stage", to: "Shop - stage" },
    { projectId: "p3", from: "Sage", to: "Shop - Sage" },
  ];

  it("settles with no failure once every project is renamed", async () => {
    const apply = vi.fn(async () => undefined);
    expect(await runProjectRenames(plan, apply)).toEqual([]);
    expect(apply).toHaveBeenCalledTimes(3);
  });

  it("keeps the projects refused with why, and still renames the rest", async () => {
    const apply = vi.fn(async (rename: (typeof plan)[number]) => {
      if (rename.projectId === "p2") throw new Error("No access.");
    });
    const failures = await runProjectRenames(plan, apply);
    expect(apply).toHaveBeenCalledTimes(3);
    expect(failures).toEqual([{ rename: plan[1], reason: "No access." }]);
  });

  it("retries the same targets: what is left is the failed renames as they were planned", () => {
    expect(renamesLeft([{ rename: plan[1]!, reason: "x" }])).toEqual([plan[1]]);
  });
});

describe("renameStillDue", () => {
  const left = { projectId: "p1", from: "SPN - Rune", to: "Shop - Rune" };

  it.each([
    { case: "while the project is named as planned from", current: " SPN - Rune ", due: left },
    {
      case: "no longer once the project was renamed since",
      current: "Shop - Rune",
      due: undefined,
    },
    { case: "no longer once it is named another way", current: "Milo", due: undefined },
  ])("offers it $case", ({ current, due }) => {
    expect(renameStillDue(left, current)).toEqual(due);
  });

  it("offers nothing where nothing was left", () => {
    expect(renameStillDue(undefined, "SPN - Rune")).toBeUndefined();
  });
});

describe("projectRenameTrouble", () => {
  it("says which projects were not renamed and why", () => {
    expect(
      projectRenameTrouble([
        {
          rename: { projectId: "p2", from: "SPN - stage", to: "Shop - stage" },
          reason: "No access.",
        },
      ]),
    ).toBe("SPN - stage was not renamed to Shop - stage in Zerops: No access.");
  });
});
