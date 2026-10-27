import { describe, expect, it } from "vite-plus/test";

import type { GroupEnvironmentTier } from "./groupEnvironments.ts";
import { recipeReach, type RecipeReach } from "./recipeReach.ts";

const file = (filename: string, previousFilename?: string) => ({ filename, previousFilename });

const stage = { tier: "stage" } as const;
const production = { tier: "production" } as const;

const NOTHING: RecipeReach = {
  stages: 0,
  production: false,
  later: [],
  unused: [],
};

describe("recipeReach: what merging a change to the group repo does", () => {
  it.each<
    [
      string,
      ReadonlyArray<ReturnType<typeof file>>,
      ReadonlyArray<{ readonly tier: GroupEnvironmentTier }>,
      Partial<RecipeReach>,
    ]
  >([
    [
      "the stage recipe reaches every stage made from it",
      [file("3 — Stage/import.yaml"), file("3 — Stage/README.md")],
      [stage, stage, production],
      { stages: 2 },
    ],
    [
      "the stage and production recipes reach both",
      [file("4 — Small Production/import.yaml"), file("3 — Stage/import.yaml")],
      [stage, production],
      { stages: 1, production: true },
    ],
    [
      // The owner's case, 2026-09-30: a service added to these two, and the review offered a release.
      "a recipe nothing in the project is made from reaches nothing",
      [file("1 — Remote (CDE)/import.yaml"), file("2 — Local/import.yaml")],
      [stage, production],
      { unused: ["Remote (CDE)", "Local"] },
    ],
    [
      "the recipes nothing is made from, in the recipe's order",
      [file("2 — Local/import.yaml"), file("1 — Remote (CDE)/import.yaml")],
      [],
      { unused: ["Remote (CDE)", "Local"] },
    ],
    [
      "production's recipe with no production yet: the one added later is made from it",
      [file("4 — Small Production/import.yaml")],
      [stage],
      { later: ["production"] },
    ],
    [
      "the Mates' recipe reaches only a Mate added later",
      [file("0 — AI Agent/import.yaml")],
      [stage, production],
      { later: ["mate"] },
    ],
    [
      "every recipe the app makes from, in a project with nothing made yet",
      [
        file("4 — Small Production/import.yaml"),
        file("0 — AI Agent/import.yaml"),
        file("3 — Stage/import.yaml"),
      ],
      [],
      { later: ["mate", "stage", "production"] },
    ],
    [
      "a README, the root's or a tier's, changes nothing",
      [file("README.md"), file("3 — Stage/README.md"), file("4 — Small Production/README.md")],
      [stage, production],
      {},
    ],
    // HQ holds an application's environments itself (SPEC §3.2b): a file of them changes nothing.
    ["an environments.yaml changes nothing", [file("environments.yaml")], [stage], {}],
    [
      "a directory that is no tier holds no recipe",
      [file(".gitea/workflows/release.yml"), file("docs/import.yaml"), file("import.yaml")],
      [stage, production],
      {},
    ],
    [
      // Production is made from the small production tier (`RECIPE_TIER_PATHS`), never this one.
      "the highly available production is not the recipe production is made from",
      [file("5 — Highly-available Production/import.yaml")],
      [production],
      { unused: ["Highly-available Production"] },
    ],
    [
      "a recipe moved counts where it came from too",
      [file("4 — Small Production/import.yaml", "5 — Highly-available Production/import.yaml")],
      [production],
      { production: true, unused: ["Highly-available Production"] },
    ],
  ])("%s", (_case, files, environments, want) => {
    expect(recipeReach({ files, environments })).toEqual({ ...NOTHING, ...want });
  });
});
