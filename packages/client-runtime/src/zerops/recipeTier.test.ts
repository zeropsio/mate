import { describe, expect, it } from "vite-plus/test";

import { ENVIRONMENTS_DOCUMENT_PATH, importReadyTier, RECIPE_TIER_PATHS } from "./recipeTier.ts";

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
