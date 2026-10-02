import { describe, expect, it } from "vite-plus/test";

import {
  deployTargetTier,
  RECIPE_TIER_PATHS,
  recipeProjectImportYaml,
  recipeServicesWithout,
  recipeTierRepositories,
  recipeTierServices,
  splitRecipeTier,
} from "./recipeTier.ts";

/** A Mate's tier as zcp proposes it, a dev/stage pair per codebase, plus a public utility. */
const MATE_TIER = `#zeropsPreprocessor=on
project:
  name: Acme - Vera
  envVariables:
    APP_KEY: <@generateRandomString(<32>)>
services:
  # The API, built from its own repository.
  - hostname: apidev
    type: nodejs@22
    buildFromGit: https://gitea.test/acme/api
    zeropsSetup: dev
    priority: 5
    minContainers: 1
  - hostname: apistage
    type: nodejs@22
    buildFromGit: https://gitea.test/acme/api
    zeropsSetup: prod
    enableSubdomainAccess: true
  - hostname: mail
    type: go@1
    buildFromGit: https://github.com/acme/mailpit
    zeropsSetup: mail
    priority: 1
  - hostname: db
    type: postgresql@17
    mode: NON_HA
    priority: 10
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
  });
});

describe("recipeTierServices", () => {
  it("reads what each service is, in the tier's order", () => {
    expect(recipeTierServices(MATE_TIER)).toEqual([
      { hostname: "apidev", role: "dev" },
      { hostname: "apistage", role: "stage" },
      { hostname: "mail", role: "utility" },
      { hostname: "db", role: "managed" },
      { hostname: "files", role: "managed" },
    ]);
  });

  // A public repository is one the platform can clone itself: github.com or gitlab.com, over
  // https, with nothing that would make the clone the person's rather than anyone's.
  it.each([
    { url: "https://github.com/acme/mailpit", role: "utility" },
    { url: "https://gitlab.com/acme/mailpit", role: "utility" },
    { url: "https://github.com/acme/mailpit@main", role: "utility" },
    { url: "http://github.com/acme/mailpit", role: "dev" },
    { url: "https://token@github.com/acme/mailpit", role: "dev" },
    { url: "https://user:secret@gitlab.com/acme/mailpit", role: "dev" },
    { url: "https://github.com/acme/mailpit?ref=main", role: "dev" },
    { url: "https://github.com/acme/mailpit#main", role: "dev" },
    { url: "https://github.com:8443/acme/mailpit", role: "dev" },
    { url: "https://gist.github.com/acme/mailpit", role: "dev" },
    { url: "https://github.com.gitea.test/acme/mailpit", role: "dev" },
    { url: "https://gitea.test/acme/mailpit", role: "dev" },
    { url: "not a url", role: "dev" },
  ])("reads a build from $url as $role", ({ url, role }) => {
    const tier = `services:\n  - hostname: mail\n    type: go@1\n    buildFromGit: ${url}\n`;
    expect(recipeTierServices(tier)).toEqual([{ hostname: "mail", role }]);
  });

  it.each([
    { case: "a setup with no build", keys: "    zeropsSetup: api\n", role: "dev" },
    { case: "an empty start", keys: "    startWithoutCode: true\n", role: "dev" },
    { case: "no build at all", keys: "    mode: NON_HA\n", role: "managed" },
  ])("reads $case as $role", ({ keys, role }) => {
    expect(
      recipeTierServices(`services:\n  - hostname: api\n    type: nodejs@22\n${keys}`),
    ).toEqual([{ hostname: "api", role }]);
  });

  it("reads a stage half by its name, zcp's convention", () => {
    const tier = `services:\n  - hostname: webstage\n    buildFromGit: https://gitea.test/acme/web\n`;
    expect(recipeTierServices(tier)).toEqual([{ hostname: "webstage", role: "stage" }]);
  });

  it("reads only the item's own keys, never one nested under another", () => {
    // An environment variable called `buildFromGit` is not a build.
    const tier = `services:
  - hostname: db
    type: postgresql@17
    envSecrets:
      buildFromGit: https://gitea.test/acme/api
`;
    expect(recipeTierServices(tier)).toEqual([{ hostname: "db", role: "managed" }]);
  });

  it.each([
    { name: "a document with no services key", yaml: "project:\n  name: acme\n" },
    { name: "a services key with nothing under it", yaml: "services:\n" },
    { name: "an empty file", yaml: "" },
  ])("answers undefined for $name — nothing has been merged yet", ({ yaml }) => {
    expect(recipeTierServices(yaml)).toBeUndefined();
  });
});

describe("splitRecipeTier — the managed part, imported with the project", () => {
  const split = splitRecipeTier(MATE_TIER);

  it("keeps the header, the project block and the managed services, byte for byte", () => {
    expect(split?.managed).toBe(`#zeropsPreprocessor=on
project:
  name: Acme - Vera
  envVariables:
    APP_KEY: <@generateRandomString(<32>)>
services:
  # The API, built from its own repository.
  - hostname: db
    type: postgresql@17
    mode: NON_HA
    priority: 10
  - hostname: files
    type: shared-storage
`);
    expect(split?.managedServices).toEqual(["db", "files"]);
  });

  it("gives a tier with no managed service an empty list, which a project import takes", () => {
    // `services: []` with the project block alone is what zcp's farm imports its shells with
    // (zcp `docs/spec-eval-farm.md` FM-10, measured 2026-09-10).
    const only = splitRecipeTier(`project:
  name: Acme - Vera
services:
  - hostname: appdev
    buildFromGit: https://gitea.test/acme/app
`);
    expect(only?.managed).toBe("project:\n  name: Acme - Vera\nservices: []\n");
    expect(only?.managedServices).toEqual([]);
  });
});

describe("splitRecipeTier — the runtimes, imported once the project is closed off", () => {
  const split = splitRecipeTier(MATE_TIER);

  it("names each runtime and what it is, in the tier's order", () => {
    expect(split?.runtimes?.services).toEqual([
      { hostname: "apidev", role: "dev" },
      { hostname: "apistage", role: "stage" },
      { hostname: "mail", role: "utility" },
    ]);
  });

  it("imports them services-only, in one wave, the preprocessor header still first", () => {
    expect(split?.runtimes?.yaml).toBe(`#zeropsPreprocessor=on
services:
  # The API, built from its own repository.
  - hostname: apidev
    type: nodejs@22
    startWithoutCode: true
    minContainers: 1
  - hostname: apistage
    type: nodejs@22
    enableSubdomainAccess: true
  - hostname: mail
    type: go@1
    buildFromGit: https://github.com/acme/mailpit
    zeropsSetup: mail
`);
  });

  it.each([
    {
      case: "a dev half starts empty, where its build was",
      item: "  - hostname: apidev\n    buildFromGit: https://gitea.test/acme/api\n    zeropsSetup: dev\n",
      expected: "  - hostname: apidev\n    startWithoutCode: true\n",
    },
    {
      case: "a dev half that already started empty says so once",
      item: "  - hostname: apidev\n    startWithoutCode: true\n    zeropsSetup: dev\n",
      expected: "  - hostname: apidev\n    startWithoutCode: true\n",
    },
    {
      case: "a stage half waits for its first deploy: no build, no empty start",
      item: "  - hostname: apistage\n    buildFromGit: https://gitea.test/acme/api\n    startWithoutCode: true\n    zeropsSetup: prod\n",
      expected: "  - hostname: apistage\n",
    },
    {
      case: "a build written as a block goes with its nested lines",
      item: "  - hostname: apidev\n    buildFromGit:\n      url: https://gitea.test/acme/api\n      ref: main\n    type: nodejs@22\n",
      expected: "  - hostname: apidev\n    startWithoutCode: true\n    type: nodejs@22\n",
    },
    {
      case: "a utility keeps its build and loses only its priority",
      item: "  - hostname: mail\n    priority: 3\n    buildFromGit: https://github.com/acme/mailpit\n",
      expected: "  - hostname: mail\n    buildFromGit: https://github.com/acme/mailpit\n",
    },
  ])("converts: $case", ({ item, expected }) => {
    expect(splitRecipeTier(`services:\n${item}`)?.runtimes?.yaml).toBe(`services:\n${expected}`);
  });

  it("has no runtimes to import for a tier of managed services", () => {
    expect(
      splitRecipeTier("services:\n  - hostname: db\n    type: postgresql@17\n")?.runtimes,
    ).toBe(undefined);
  });
});

describe("splitRecipeTier on zcp's own tiers", () => {
  // Four-space items, keys sorted, so `buildFromGit` opens every runtime's item (Dara's tier,
  // 2026-09-17, and yaml.v3's order in zcp's `BuildGroupRecipe`).
  const ZCP_TIER = `#zeropsPreprocessor=on
project:
    name: Imperial Titan - Vera
services:
    - buildFromGit: https://gitea.test/imperial-titan/todoapp
      envSecrets:
          SESSION_KEY: <@generateRandomString(<32>)>
      hostname: todoapp
      type: ubuntu/nodejs@22
      zeropsSetup: dev
    - buildFromGit: https://gitea.test/imperial-titan/todoapp
      enableSubdomainAccess: true
      hostname: todoappstage
      type: ubuntu/nodejs@22
      zeropsSetup: prod
    - hostname: tododb
      priority: 10
      type: postgresql:single@18
`;
  const split = splitRecipeTier(ZCP_TIER);

  it("starts a dev half empty in place of the build that opened its item", () => {
    expect(split?.runtimes?.yaml).toContain(
      "    - startWithoutCode: true\n      envSecrets:\n          SESSION_KEY: <@generateRandomString(<32>)>\n      hostname: todoapp\n",
    );
  });

  it("opens a stage half's item on its next key once its build is gone", () => {
    expect(split?.runtimes?.yaml).toContain(
      "    - enableSubdomainAccess: true\n      hostname: todoappstage\n      type: ubuntu/nodejs@22\n",
    );
  });

  it("keeps the preprocessor header, so a runtime's generated secret is generated", () => {
    // zcp writes a runtime's auto-secrets as its own `envSecrets` directives (`BuildGroupRecipe`).
    expect(split?.runtimes?.yaml.split("\n")[0]).toBe("#zeropsPreprocessor=on");
    expect(split?.runtimes?.yaml).not.toContain("project:");
    expect(split?.runtimes?.yaml).not.toContain("buildFromGit");
    expect(split?.runtimes?.yaml).not.toContain("zeropsSetup");
  });

  it("leaves the managed service, its priority included, with the project", () => {
    expect(split?.managed).toContain("    - hostname: tododb\n      priority: 10\n");
    expect(split?.managedServices).toEqual(["tododb"]);
  });
});

describe("deployTargetTier — a stage or a production, whole", () => {
  it("starts every runtime the broker deploys empty, and builds a utility", () => {
    expect(deployTargetTier(MATE_TIER)).toBe(`#zeropsPreprocessor=on
project:
  name: Acme - Vera
  envVariables:
    APP_KEY: <@generateRandomString(<32>)>
services:
  # The API, built from its own repository.
  - hostname: apidev
    type: nodejs@22
    startWithoutCode: true
    priority: 5
    minContainers: 1
  - hostname: apistage
    type: nodejs@22
    startWithoutCode: true
    enableSubdomainAccess: true
  - hostname: mail
    type: go@1
    buildFromGit: https://github.com/acme/mailpit
    zeropsSetup: mail
    priority: 1
  - hostname: db
    type: postgresql@17
    mode: NON_HA
    priority: 10
  - hostname: files
    type: shared-storage
`);
  });

  it("keeps a top-level key that follows the services block", () => {
    expect(
      deployTargetTier(
        "services:\n  - hostname: db\n    type: postgresql@17\nother:\n  kept: true\n",
      ),
    ).toContain("other:\n  kept: true");
  });

  it("answers undefined for a tier with no services", () => {
    expect(deployTargetTier("services:\n")).toBeUndefined();
  });
});

describe("recipeTierRepositories", () => {
  it("names where each built service's code lives, a block's url included", () => {
    const tier = `services:
  - hostname: api
    buildFromGit: https://gitea.test/acme/api
  - hostname: web
    buildFromGit:
      url: https://gitea.test/acme/web
      ref: main
  - hostname: db
    type: postgresql@17
`;
    expect([...recipeTierRepositories(tier)]).toEqual([
      ["api", "https://gitea.test/acme/api"],
      ["web", "https://gitea.test/acme/web"],
    ]);
  });

  it("names nothing for a tier with no services", () => {
    expect(recipeTierRepositories("project:\n  name: acme\n").size).toBe(0);
  });
});

describe("recipeServicesWithout", () => {
  const RUNTIMES = `#zeropsPreprocessor=on
services:
  - hostname: apidev
    startWithoutCode: true
  - hostname: apistage
    type: nodejs@22
`;

  it("leaves out the services the project already has", () => {
    expect(recipeServicesWithout(RUNTIMES, ["apidev", "db"])).toBe(
      "#zeropsPreprocessor=on\nservices:\n  - hostname: apistage\n    type: nodejs@22\n",
    );
  });

  it("imports everything into a project that has none of them", () => {
    expect(recipeServicesWithout(RUNTIMES, [])).toBe(RUNTIMES);
  });

  it("has nothing to import once the project has them all", () => {
    expect(recipeServicesWithout(RUNTIMES, ["apistage", "apidev"])).toBeUndefined();
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
      { name: "Imperial Titan - stage", tagList: ["mate"] },
    );
    expect(doc).toBe(`project:
    name: Imperial Titan - stage
    tags:
      - mate
    envVariables:
        APP_KEY: <@generateRandomString(<32>)>
services:
    - hostname: db
      type: postgresql:single@18
`);
    expect(doc.match(/^\s+name:/gmu)).toHaveLength(1);
  });
});

// A Mate's project is closed off by the press and by nothing else: a tier that names the project's
// isolation would open it at birth, before the press reads it back (pass 28 review).
describe("recipeProjectImportYaml never carries the project's isolation", () => {
  it.each([
    {
      case: "a key of the project block",
      yaml: "project:\n  name: Acme - dev\n  envIsolation: none\nservices:\n  - hostname: db\n    type: postgresql@17\n",
    },
    {
      case: "a project variable",
      yaml: "project:\n  name: Acme - dev\n  envVariables:\n    envIsolation: none\n    APP_KEY: k\nservices:\n  - hostname: db\n    type: postgresql@17\n",
    },
  ])("drops it as $case", ({ yaml }) => {
    const doc = recipeProjectImportYaml(yaml, { name: "Acme - Ada" });
    expect(doc).not.toMatch(/envIsolation/u);
    expect(doc).toContain("name: Acme - Ada");
    expect(doc).toContain("hostname: db");
  });

  it("keeps the project's other variables", () => {
    const doc = recipeProjectImportYaml(
      "project:\n  name: Acme - dev\n  envVariables:\n    envIsolation: none\n    APP_KEY: k\nservices: []\n",
      { name: "Acme - Ada" },
    );
    expect(doc).toContain("    APP_KEY: k");
  });
});
