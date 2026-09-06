import { describe, expect, it } from "vite-plus/test";

import { recipeProjectImportYaml, recipeServicesYaml } from "./recipeStore.ts";

/** The shape every tier in `zeropsio/recipes` has, comments and all. */
const TIER = `#zeropsPreprocessor=on

# Small production environment.

# APP_KEY is Laravel's encryption key — project-level so every container agrees.
project:
  name: laravel-minimal-small-prod
  tags:
    - published
  envVariables:
    APP_KEY: <@generateRandomString(<32>)>

services:
  - hostname: app
    type: php-nginx@8.4
    minContainers: 2
`;

describe("recipeProjectImportYaml", () => {
  const out = recipeProjectImportYaml(TIER, {
    name: "Aurora - production",
    tagList: ["mate:g:6qxmgx4chfcm", "mate:role:prod"],
  });

  it("keeps the project-level env the strip would have taken", () => {
    // The whole reason this exists: the stripped path drops APP_KEY, and it
    // cannot be written back afterwards — the value is a preprocessor
    // directive, evaluated by the platform on the way in.
    expect(out).toContain("APP_KEY: <@generateRandomString(<32>)>");
    expect(recipeServicesYaml(TIER)).not.toMatch(/^\s+APP_KEY:/mu);
  });

  it("keeps the preprocessor header first, or none of it is evaluated", () => {
    expect(out.split("\n")[0]).toBe("#zeropsPreprocessor=on");
  });

  it("takes the caller's name over the recipe's", () => {
    expect(out).toContain("  name: Aurora - production");
    expect(out).not.toContain("laravel-minimal-small-prod");
  });

  it("replaces the recipe's tags with the group's membership", () => {
    expect(out).toContain("    - mate:g:6qxmgx4chfcm");
    expect(out).toContain("    - mate:role:prod");
    // The published tag and its key go together; a stray item is rejected.
    expect(out).not.toContain("- published");
    expect(out.match(/^\s+tags:/gmu)).toHaveLength(1);
  });

  it("keeps the services and the comments written for whoever reads next", () => {
    expect(out).toContain("hostname: app");
    expect(out).toContain("minContainers: 2");
    expect(out).toContain("# APP_KEY is Laravel's encryption key");
  });

  it("gives a services-only document a project block", () => {
    const servicesOnly = "#zeropsPreprocessor=on\nservices:\n  - hostname: app\n";
    const built = recipeProjectImportYaml(servicesOnly, { name: "New", tagList: ["mate"] });
    expect(built.split("\n")[0]).toBe("#zeropsPreprocessor=on");
    expect(built).toContain("project:\n  name: New\n  tags:\n    - mate");
    expect(built).toContain("services:");
  });

  it("omits tags entirely when the caller has none", () => {
    expect(recipeProjectImportYaml(TIER, { name: "New" })).not.toMatch(/^\s+tags:/mu);
  });
});
