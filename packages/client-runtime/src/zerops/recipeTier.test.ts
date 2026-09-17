import { describe, expect, it } from "vite-plus/test";

import {
  ENVIRONMENTS_DOCUMENT_PATH,
  RECIPE_TIER_PATHS,
  importReadyTier,
  recipeProjectImportYaml,
} from "./recipeTier.ts";

const TIER = `#yamlPreprocessor=on
services:
  # The API, built from its own repository.
  - hostname: api
    type: nodejs@22
    buildFromGit: https://web-1234-3000.prg1.zerops.app/acme/api
    zeropsSetup: api
    minContainers: 1
  - hostname: web
    type: nodejs@22
    buildFromGit: https://web-1234-3000.prg1.zerops.app/acme/web
    zeropsSetup: web
  - hostname: db
    type: postgresql@17
    mode: NON_HA
  - hostname: files
    type: shared-storage
`;

describe("the group repo's paths", () => {
  it("spells the tier directories exactly as the repository does", () => {
    // The em dash is part of the directory name (`zcp/internal/recipe/layout.go`).
    expect(RECIPE_TIER_PATHS).toEqual({
      mate: "0 — AI Agent/import.yaml",
      stage: "3 — Stage/import.yaml",
      production: "4 — Small Production/import.yaml",
    });
    expect(ENVIRONMENTS_DOCUMENT_PATH).toBe("environments.yaml");
  });
});

describe("importReadyTier", () => {
  const ready = importReadyTier(TIER);

  it("turns every buildFromGit + zeropsSetup into startWithoutCode", () => {
    expect(ready?.yaml).toBe(`#yamlPreprocessor=on
services:
  # The API, built from its own repository.
  - hostname: api
    type: nodejs@22
    startWithoutCode: true
    minContainers: 1
  - hostname: web
    type: nodejs@22
    startWithoutCode: true
  - hostname: db
    type: postgresql@17
    mode: NON_HA
  - hostname: files
    type: shared-storage
`);
  });

  it("keeps the source map for zcp's adoption", () => {
    expect(ready?.sources).toEqual({
      api: { repository: "https://web-1234-3000.prg1.zerops.app/acme/api", setup: "api" },
      web: { repository: "https://web-1234-3000.prg1.zerops.app/acme/web", setup: "web" },
    });
  });

  it("names every service, built or managed, in the document's order", () => {
    expect(ready?.services).toEqual(["api", "web", "db", "files"]);
  });

  it("leaves a managed service byte for byte", () => {
    expect(ready?.yaml).toContain("  - hostname: db\n    type: postgresql@17\n    mode: NON_HA");
  });

  it("keeps the comments a person wrote for whoever reads the tier next", () => {
    expect(ready?.yaml).toContain("# The API, built from its own repository.");
  });

  it("keeps the preprocessor header first, where the platform needs it", () => {
    expect(ready?.yaml.split("\n")[0]).toBe("#yamlPreprocessor=on");
  });

  it.each([
    {
      name: "a build named as a block",
      yaml: `services:
  - hostname: api
    type: nodejs@22
    buildFromGit:
      url: https://gitea.test/acme/api
      ref: main
    zeropsSetup: api
`,
      expected: `services:
  - hostname: api
    type: nodejs@22
    startWithoutCode: true
`,
    },
    {
      name: "a build with no setup named — the platform defaults it to the hostname",
      yaml: `services:
  - hostname: api
    type: nodejs@22
    buildFromGit: https://gitea.test/acme/api
`,
      expected: `services:
  - hostname: api
    type: nodejs@22
    startWithoutCode: true
`,
    },
  ])("converts $name", ({ yaml, expected }) => {
    const result = importReadyTier(yaml);
    expect(result?.yaml).toBe(expected);
    expect(result?.sources.api?.repository).toBe("https://gitea.test/acme/api");
    expect(result?.sources.api?.setup).toBe("api");
  });

  it.each([
    { name: "a document with no services key", yaml: "project:\n  name: acme\n" },
    { name: "a services key with nothing under it", yaml: "services:\n" },
    { name: "an empty file", yaml: "" },
  ])("answers undefined for $name — nothing has been merged yet", ({ yaml }) => {
    expect(importReadyTier(yaml)).toBeUndefined();
  });

  it("keeps a top-level key that follows the services block", () => {
    const result = importReadyTier(`services:
  - hostname: db
    type: postgresql@17
other:
  kept: true
`);
    expect(result?.yaml).toContain("other:\n  kept: true");
  });

  it("carries a tier with nothing to convert through unchanged", () => {
    const managed = "services:\n  - hostname: db\n    type: postgresql@17\n";
    const result = importReadyTier(managed);
    expect(result?.yaml).toBe(managed);
    expect(result?.sources).toEqual({});
  });
});

describe("importReadyTier on zcp's own tiers", () => {
  // The stage tier zcp proposed on Dara's run (2026-09-17): four-space
  // items, `buildFromGit` opening each built item, `zeropsSetup` last. The
  // dialog read it as "no recipe on main yet".
  const ZCP_TIER = `project:
    name: Imperial Titan - dev stage
services:
    - buildFromGit: https://web-2fe9-3000.prg1.zerops.app/imperial-titan/todoapp
      hostname: todoapp
      maxContainers: 10
      minContainers: 1
      type: ubuntu/nodejs@22
      verticalAutoscaling:
        cpuMode: SHARED
        maxCpu: 8
      zeropsSetup: todoapp
    - hostname: tododb
      priority: 10
      profile: oltp-staging
      type: postgresql:single@18
`;

  it("reads four-space items and converts a build that opens its item", () => {
    const ready = importReadyTier(ZCP_TIER);
    expect(ready?.services).toEqual(["todoapp", "tododb"]);
    expect(ready?.sources).toEqual({
      todoapp: {
        repository: "https://web-2fe9-3000.prg1.zerops.app/imperial-titan/todoapp",
        setup: "todoapp",
      },
    });
    expect(ready?.yaml).toContain("    - startWithoutCode: true\n      hostname: todoapp");
    expect(ready?.yaml).not.toContain("buildFromGit");
    expect(ready?.yaml).not.toContain("zeropsSetup");
    expect(ready?.yaml).toContain("    - hostname: tododb\n      priority: 10");
  });
});

describe("recipeProjectImportYaml on a four-space project block", () => {
  // zcp's tiers indent by four; the rewrite wrote a two-space name and kept
  // the four-space one, and the platform refused the document (Dara's stage
  // tier, 2026-09-17).
  it("replaces the name at the block's own indentation and keeps the rest of the block", () => {
    const doc = recipeProjectImportYaml(
      `project:
    name: Imperial Titan - dev stage
    envVariables:
        APP_KEY: <@generateRandomString(<32>)>
services:
    - hostname: db
      type: postgresql:single@18
`,
      { name: "Imperial Titan - stage", tagList: ["mate:g:x", "mate:role:stage"] },
    );
    expect(doc).toBe(`project:
    name: Imperial Titan - stage
    tags:
      - mate:g:x
      - mate:role:stage
    envVariables:
        APP_KEY: <@generateRandomString(<32>)>
services:
    - hostname: db
      type: postgresql:single@18
`);
    expect(doc.match(/^\s+name:/gmu)).toHaveLength(1);
  });
});
