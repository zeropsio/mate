import { describe, expect, it } from "vite-plus/test";

import { canCreateEnvironment, recipeServicesYaml } from "./recipeStore.ts";
import { GO_HELLO_WORLD_GROUP } from "./recipeStoreSeed.ts";

const RECIPE_WITH_PROJECT = `# a leading comment
project:
  name: go-hello-world-remote

services:
  - hostname: app
    type: golang@1.22
`;

describe("recipeServicesYaml", () => {
  it("strips the project block the import endpoint rejects", () => {
    expect(recipeServicesYaml(RECIPE_WITH_PROJECT)).toBe(`# a leading comment
services:
  - hostname: app
    type: golang@1.22
`);
  });

  it("leaves a services-only recipe untouched", () => {
    const yaml = "services:\n  - hostname: app\n";
    expect(recipeServicesYaml(yaml)).toBe(yaml);
  });

  it("keeps comments that sit inside the services block", () => {
    const yaml =
      "project:\n  name: x\n\nservices:\n  # why this service exists\n  - hostname: app\n";
    expect(recipeServicesYaml(yaml)).toContain("# why this service exists");
  });

  it("does not mistake an indented project key for the block", () => {
    const yaml = "services:\n  - hostname: app\n    project: not-a-block\n";
    expect(recipeServicesYaml(yaml)).toBe(yaml);
  });

  it("strips a project block that runs to the end of the document", () => {
    expect(recipeServicesYaml("project:\n  name: x\n")).toBe("");
  });
});

describe("the go-hello-world seed", () => {
  it.each(["dev", "stage", "prod"] as const)(
    "carries a %s recipe with no project block",
    (role) => {
      const recipe = GO_HELLO_WORLD_GROUP.recipes[role];
      expect(recipe).toBeDefined();
      expect(recipe).toContain("services:");
      expect(recipe).not.toMatch(/^project:/m);
    },
  );

  it("keeps the multirepo build sources the recipe is the source of truth for", () => {
    expect(GO_HELLO_WORLD_GROUP.recipes.prod).toContain(
      "buildFromGit: https://github.com/zerops-recipe-apps/go-hello-world-app",
    );
  });

  it("scales the production tier differently from dev — the recipes are not copies", () => {
    expect(GO_HELLO_WORLD_GROUP.recipes.prod).toContain("minContainers: 2");
    expect(GO_HELLO_WORLD_GROUP.recipes.dev).not.toContain("minContainers: 2");
  });
});

describe("canCreateEnvironment", () => {
  it.each([
    {
      name: "allows a role the group has a recipe for",
      record: GO_HELLO_WORLD_GROUP,
      role: "prod",
      allowed: true,
    },
    {
      name: "refuses a role with no recipe",
      record: GO_HELLO_WORLD_GROUP,
      role: "devstage",
      allowed: false,
    },
    {
      name: "refuses a group with no record at all",
      record: undefined,
      role: "prod",
      allowed: false,
    },
  ] as const)("$name", ({ record, role, allowed }) => {
    const result = canCreateEnvironment(record, role);
    expect(result.allowed).toBe(allowed);
    if (!allowed) expect(result.reason).toBeTruthy();
  });

  it("refuses a recipe that exists but is blank", () => {
    expect(
      canCreateEnvironment({ groupId: "a", name: "A", recipes: { prod: "  " } }, "prod").allowed,
    ).toBe(false);
  });
});
