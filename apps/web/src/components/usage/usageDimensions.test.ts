import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentTotals } from "@t3tools/shared/usageMerge";
import { describe, expect, it } from "vite-plus/test";

import type {
  UsageEnvironmentIdentity,
  UsageEnvironmentOwner,
} from "../../zerops/usageEnvironmentIdentities";
import { usageDimensions, usageScopeIncludes } from "./usageDimensions";

const env = (id: string) => id as EnvironmentId;

function owner(id: string, isViewer = false): UsageEnvironmentOwner {
  return {
    id,
    name: `Person ${id}`,
    initials: id.slice(0, 2).toUpperCase(),
    avatarUrl: null,
    isViewer,
  };
}

function totals(id: string, costUsd: number, totalTokens: number): EnvironmentTotals {
  return {
    environmentId: env(id),
    costUsd,
    totalTokens,
    records: 1,
    unpricedRecords: 0,
    sessions: 1,
    costShare: 0,
    tokenShare: 0,
    providers: ["claude"],
  };
}

function identities(
  entries: Record<string, UsageEnvironmentIdentity>,
): ReadonlyMap<EnvironmentId, UsageEnvironmentIdentity> {
  return new Map(Object.entries(entries).map(([id, identity]) => [env(id), identity]));
}

const labels = (ids: readonly string[]) => new Map(ids.map((id) => [env(id), `label ${id}`]));

describe("usageDimensions visibility", () => {
  it.each([
    {
      name: "one Mate shows no dimension",
      byEnvironment: [totals("a", 10, 100)],
      identities: identities({ a: { mateName: "Lena", projectName: "shop", owner: owner("u1") } }),
      visible: { person: false, project: false, mate: false },
    },
    {
      name: "two Mates of one person in one project show only Mate",
      byEnvironment: [totals("a", 10, 100), totals("b", 5, 50)],
      identities: identities({
        a: { mateName: "Lena", projectName: "shop", owner: owner("u1") },
        b: { mateName: "Otto", projectName: "shop", owner: owner("u1") },
      }),
      visible: { person: false, project: false, mate: true },
    },
    {
      name: "two Mates of one person in two projects show Project and Mate",
      byEnvironment: [totals("a", 10, 100), totals("b", 5, 50)],
      identities: identities({
        a: { mateName: "Lena", projectName: "shop", owner: owner("u1") },
        b: { mateName: "Otto", projectName: "blog", owner: owner("u1") },
      }),
      visible: { person: false, project: true, mate: true },
    },
    {
      name: "two people show Person",
      byEnvironment: [totals("a", 10, 100), totals("b", 5, 50)],
      identities: identities({
        a: { mateName: "Lena", projectName: "shop", owner: owner("u1") },
        b: { mateName: "Otto", projectName: "shop", owner: owner("u2") },
      }),
      visible: { person: true, project: false, mate: true },
    },
    {
      name: "an environment without identity counts as a Mate but not as a person or project",
      byEnvironment: [totals("a", 10, 100), totals("local", 5, 50)],
      identities: identities({ a: { mateName: "Lena", projectName: "shop", owner: owner("u1") } }),
      visible: { person: false, project: false, mate: true },
    },
    {
      name: "no activity shows no dimension",
      byEnvironment: [],
      identities: identities({}),
      visible: { person: false, project: false, mate: false },
    },
  ])("$name", ({ byEnvironment, identities, visible }) => {
    const dimensions = usageDimensions({
      byEnvironment,
      identities,
      labels: labels(byEnvironment.map((row) => row.environmentId)),
      metric: "cost",
    });
    expect(dimensions.visible).toEqual(visible);
  });
});

describe("usageDimensions rows", () => {
  const team = {
    byEnvironment: [
      totals("a", 10, 100),
      totals("b", 30, 50),
      totals("c", 20, 400),
      totals("local", 40, 10),
    ],
    identities: identities({
      a: { mateName: "Lena", projectName: "shop", owner: owner("u1", true) },
      b: { mateName: "Otto", projectName: "blog", owner: owner("u2") },
      c: { mateName: "Ida", projectName: "shop", owner: owner("u2") },
    }),
    labels: labels(["a", "b", "c", "local"]),
  };

  it.each([
    {
      metric: "cost" as const,
      mates: ["label local", "Otto", "Ida", "Lena"],
      people: [
        ["u2", ["Otto", "Ida"]],
        [null, ["label local"]],
        ["u1", ["Lena"]],
      ],
      projects: [
        ["Unassigned", []],
        ["shop", ["u2", "u1"]],
        ["blog", ["u2"]],
      ],
    },
    {
      metric: "tokens" as const,
      mates: ["Ida", "Lena", "Otto", "label local"],
      people: [
        ["u2", ["Ida", "Otto"]],
        ["u1", ["Lena"]],
        [null, ["label local"]],
      ],
      projects: [
        ["shop", ["u2", "u1"]],
        ["blog", ["u2"]],
        ["Unassigned", []],
      ],
    },
  ])("rolls Mates up to people and projects, sorted by $metric", ({ metric, ...expected }) => {
    const dimensions = usageDimensions({ ...team, metric });

    expect(dimensions.mates.map((mate) => mate.mateName)).toEqual(expected.mates);
    expect(
      dimensions.people.map((person) => [
        person.owner?.id ?? null,
        person.mates.map((mate) => mate.mateName),
      ]),
    ).toEqual(expected.people);
    expect(
      dimensions.projects.map((project) => [
        project.projectName ?? "Unassigned",
        project.owners.map((projectOwner) => projectOwner.id),
      ]),
    ).toEqual(expected.projects);
  });

  it("carries amounts and shares of the rolled-up total", () => {
    const dimensions = usageDimensions({ ...team, metric: "cost" });
    const u2 = dimensions.people.find((person) => person.owner?.id === "u2");

    expect(u2).toMatchObject({ costUsd: 50, totalTokens: 450, costShare: 0.5 });
    expect(u2?.tokenShare).toBeCloseTo(450 / 560, 9);
    expect(dimensions.mates.find((mate) => mate.mateName === "Lena")).toMatchObject({
      projectName: "shop",
      owner: { id: "u1", isViewer: true },
      costShare: 0.1,
    });
    expect(dimensions.people.reduce((sum, person) => sum + person.costShare, 0)).toBeCloseTo(1, 9);
  });
});

describe("usageScopeIncludes", () => {
  const known = identities({
    a: { mateName: "Lena", projectName: "shop", owner: owner("u1") },
    b: { mateName: "Otto", projectName: "blog", owner: owner("u2") },
  });

  it.each([
    { scope: {}, included: ["a", "b", "local"] },
    { scope: { person: "u1" }, included: ["a"] },
    { scope: { project: "blog" }, included: ["b"] },
    { scope: { mate: env("local") }, included: ["local"] },
    { scope: { person: "u1", project: "blog" }, included: [] },
  ])("scope $scope includes $included", ({ scope, included }) => {
    expect(["a", "b", "local"].filter((id) => usageScopeIncludes(scope, known, env(id)))).toEqual(
      included,
    );
  });
});
