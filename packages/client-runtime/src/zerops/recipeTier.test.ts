import { describe, expect, it } from "vite-plus/test";

import {
  deployTargetTier,
  mateBirthImportYaml,
  mateTier,
  RECIPE_TIER_PATHS,
  recipeProjectImportYaml,
  recipeServicesWithout,
  recipeTierRepositories,
  recipeTierServices,
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
    buildFromGit: https://hq.test/git/acme/api.git
    zeropsSetup: dev
    priority: 5
    minContainers: 1
  - hostname: apistage
    type: nodejs@22
    buildFromGit: https://hq.test/git/acme/api.git
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
    { url: "https://github.com.hq.test/acme/mailpit", role: "dev" },
    { url: "https://hq.test/git/acme/mailpit.git", role: "dev" },
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

  it.each([
    { type: "swarm@1", keys: "    zeropsSetup: api\n" },
    { type: "swarm-vm@1", keys: "    startWithoutCode: true\n" },
    { type: "alpine/swarm@1", keys: "    buildFromGit: https://hq.test/git/acme/api.git\n" },
    { type: "ubuntu/zbox@1", keys: "    startWithoutCode: true\n" },
    { type: "zbox@1", keys: "" },
  ])("never reads a $type pool or Box as a dev, whatever keys it carries", ({ type, keys }) => {
    expect(recipeTierServices(`services:\n  - hostname: pool\n    type: ${type}\n${keys}`)).toEqual(
      [{ hostname: "pool", role: "managed" }],
    );
  });

  it("reads a stage half by its name, zcp's convention", () => {
    const tier = `services:\n  - hostname: webstage\n    buildFromGit: https://hq.test/git/acme/web.git\n`;
    expect(recipeTierServices(tier)).toEqual([{ hostname: "webstage", role: "stage" }]);
  });

  it("reads only the item's own keys, never one nested under another", () => {
    // An environment variable called `buildFromGit` is not a build.
    const tier = `services:
  - hostname: db
    type: postgresql@17
    envSecrets:
      buildFromGit: https://hq.test/git/acme/api.git
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

describe("mateTier — the tier a Mate's birth imports beside its container", () => {
  const tier = mateTier(MATE_TIER);

  it("names each runtime and what it is, in the tier's order", () => {
    expect(tier?.runtimes).toEqual([
      { hostname: "apidev", role: "dev" },
      { hostname: "apistage", role: "stage" },
      { hostname: "mail", role: "utility" },
    ]);
    expect(tier?.managed).toEqual(["db", "files"]);
  });

  it("imports every service services-only, each keeping its priority, the preprocessor header still first", () => {
    expect(tier?.yaml).toBe(`#zeropsPreprocessor=on
services:
  # The API, built from its own repository.
  - hostname: apidev
    type: nodejs@22
    startWithoutCode: true
    priority: 5
    minContainers: 1
  - hostname: apistage
    type: nodejs@22
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

  it.each([
    {
      case: "a dev half starts empty, where its build was",
      item: "  - hostname: apidev\n    buildFromGit: https://hq.test/git/acme/api.git\n    zeropsSetup: dev\n",
      expected: "  - hostname: apidev\n    startWithoutCode: true\n",
    },
    {
      case: "a dev half that already started empty says so once",
      item: "  - hostname: apidev\n    startWithoutCode: true\n    zeropsSetup: dev\n",
      expected: "  - hostname: apidev\n    startWithoutCode: true\n",
    },
    {
      case: "a stage half waits for its first deploy: no build, no empty start",
      item: "  - hostname: apistage\n    buildFromGit: https://hq.test/git/acme/api.git\n    startWithoutCode: true\n    zeropsSetup: prod\n",
      expected: "  - hostname: apistage\n",
    },
    {
      case: "a build written as a block goes with its nested lines",
      item: "  - hostname: apidev\n    buildFromGit:\n      url: https://hq.test/git/acme/api.git\n      ref: main\n    type: nodejs@22\n",
      expected: "  - hostname: apidev\n    startWithoutCode: true\n    type: nodejs@22\n",
    },
    {
      case: "a utility keeps its build and its priority",
      item: "  - hostname: mail\n    priority: 3\n    buildFromGit: https://github.com/acme/mailpit\n",
      expected:
        "  - hostname: mail\n    priority: 3\n    buildFromGit: https://github.com/acme/mailpit\n",
    },
  ])("converts: $case", ({ item, expected }) => {
    expect(mateTier(`services:\n${item}`)?.yaml).toBe(`services:\n${expected}`);
  });
});

describe("mateTier on zcp's own tiers", () => {
  // Four-space items, keys sorted, so `buildFromGit` opens every runtime's item (Dara's tier,
  // 2026-09-17, and yaml.v3's order in zcp's `BuildGroupRecipe`).
  const ZCP_TIER = `#zeropsPreprocessor=on
project:
    name: Imperial Titan - Vera
services:
    - buildFromGit: https://hq.test/git/imperial-titan/todoapp.git
      envSecrets:
          SESSION_KEY: <@generateRandomString(<32>)>
      hostname: todoapp
      type: ubuntu/nodejs@22
      zeropsSetup: dev
    - buildFromGit: https://hq.test/git/imperial-titan/todoapp.git
      enableSubdomainAccess: true
      hostname: todoappstage
      type: ubuntu/nodejs@22
      zeropsSetup: prod
    - hostname: tododb
      priority: 10
      type: postgresql:single@18
`;
  const tier = mateTier(ZCP_TIER);

  it("starts a dev half empty in place of the build that opened its item", () => {
    expect(tier?.yaml).toContain(
      "    - startWithoutCode: true\n      envSecrets:\n          SESSION_KEY: <@generateRandomString(<32>)>\n      hostname: todoapp\n",
    );
  });

  it("opens a stage half's item on its next key once its build is gone", () => {
    expect(tier?.yaml).toContain(
      "    - enableSubdomainAccess: true\n      hostname: todoappstage\n      type: ubuntu/nodejs@22\n",
    );
  });

  it("keeps the preprocessor header, so a runtime's generated secret is generated", () => {
    // zcp writes a runtime's auto-secrets as its own `envSecrets` directives (`BuildGroupRecipe`).
    expect(tier?.yaml.split("\n")[0]).toBe("#zeropsPreprocessor=on");
    expect(tier?.yaml).not.toContain("project:");
    expect(tier?.yaml).not.toContain("buildFromGit");
    expect(tier?.yaml).not.toContain("zeropsSetup");
  });
});

describe("mateBirthImportYaml — a Mate's birth is one import", () => {
  const CONTAINER = `services:
  - hostname: zcp
    type: zcp@1
    envSecrets:
      ZCP_API_KEY: "key"
    zeropsYaml:
      zerops:
        - setup: zcp`;

  it("creates the container first, above the tier's highest priority, every service isolated but to it", () => {
    expect(mateBirthImportYaml(CONTAINER, mateTier(MATE_TIER)?.yaml)).toBe(`#zeropsPreprocessor=on
services:
  # The API, built from its own repository.
  - hostname: zcp
    type: zcp@1
    envSecrets:
      ZCP_API_KEY: "key"
    zeropsYaml:
      zerops:
        - setup: zcp
    envIsolation: service@zcp
    priority: 11
  - hostname: apidev
    type: nodejs@22
    startWithoutCode: true
    priority: 5
    minContainers: 1
    envIsolation: service@zcp
  - hostname: apistage
    type: nodejs@22
    enableSubdomainAccess: true
    envIsolation: service@zcp
  - hostname: mail
    type: go@1
    buildFromGit: https://github.com/acme/mailpit
    zeropsSetup: mail
    priority: 1
    envIsolation: service@zcp
  - hostname: db
    type: postgresql@17
    mode: NON_HA
    priority: 10
    envIsolation: service@zcp
  - hostname: files
    type: shared-storage
    envIsolation: service@zcp
`);
  });

  it("imports the container alone, isolated and first, for a Mate with no tier", () => {
    expect(mateBirthImportYaml(CONTAINER, undefined)).toBe(`services:
  - hostname: zcp
    type: zcp@1
    envSecrets:
      ZCP_API_KEY: "key"
    zeropsYaml:
      zerops:
        - setup: zcp
    envIsolation: service@zcp
    priority: 1
`);
  });

  it("keeps an isolation a service states itself", () => {
    const tier = "services:\n  - hostname: db\n    type: postgresql@17\n    envIsolation: none\n";
    expect(mateBirthImportYaml(CONTAINER, tier)).toContain(
      "  - hostname: db\n    type: postgresql@17\n    envIsolation: none\n",
    );
  });

  it("indents the container as the tier indents its services, so the list stays one list", () => {
    const tier = "services:\n    - hostname: db\n      type: postgresql@17\n";
    expect(mateBirthImportYaml(CONTAINER, tier)).toBe(`services:
    - hostname: zcp
      type: zcp@1
      envSecrets:
        ZCP_API_KEY: "key"
      zeropsYaml:
        zerops:
          - setup: zcp
      envIsolation: service@zcp
      priority: 1
    - hostname: db
      type: postgresql@17
      envIsolation: service@zcp
`);
  });
});

describe("deployTargetTier — a stage or a production, whole", () => {
  it("starts every runtime HQ deploys empty, and builds a utility", () => {
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
    buildFromGit: https://hq.test/git/acme/api.git
  - hostname: web
    buildFromGit:
      url: https://hq.test/git/acme/web.git
      ref: main
  - hostname: db
    type: postgresql@17
`;
    expect([...recipeTierRepositories(tier)]).toEqual([
      ["api", "https://hq.test/git/acme/api.git"],
      ["web", "https://hq.test/git/acme/web.git"],
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

describe("project import tags", () => {
  it("emits only the Mate marker even when its caller supplies legacy metadata", () => {
    const yaml = recipeProjectImportYaml(
      "project:\n  name: old\n  tags: [old]\nservices:\n  - hostname: app\n",
      { name: "New", tagList: ["mate", "mate:face:rose:seal", "billing"] },
    );
    expect(yaml).toContain("  tags:\n    - mate\n");
    expect(yaml).not.toContain("mate:face:");
    expect(yaml).not.toContain("billing");
  });
});
