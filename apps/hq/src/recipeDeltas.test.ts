import { assert, describe, it } from "@effect/vitest";

import { deltaImport, isPublicBuild, tierServices } from "./recipeDeltas.ts";

const APP = "0b7c1d2e-0000-4000-8000-000000000001";

const TIER = [
  "#zeropsPreprocessor=on",
  "project:",
  "  name: Shop - stage",
  "services:",
  "  - hostname: api",
  "    type: nodejs@22",
  `    buildFromGit: https://hq.example.test/git/${APP}/api.git`,
  "    zeropsSetup: api",
  "    priority: 5",
  "    envSecrets:",
  "      APP_KEY: <@generateRandomString(<32>)>",
  "  - hostname: mail",
  "    type: nodejs@22",
  "    buildFromGit: https://github.com/zeropsio/recipe-mailpit",
  "    zeropsSetup: mail",
  "  - hostname: db",
  "    type: postgresql@16",
  "    mode: NON_HA",
  "",
].join("\n");

describe("tierServices", () => {
  // Main D15: each service's whole declaration, compared regardless of the order its keys were
  // written in, so a reordering is no change.
  it("reads each service's declaration, the same whatever order its keys come in", () => {
    const read = tierServices(TIER);
    const reordered = tierServices(
      "services:\n  - mode: NON_HA\n    type: postgresql@16\n    hostname: db\n",
    );
    assert.isTrue(read.ok && reordered.ok);
    if (!read.ok || !reordered.ok) return;
    assert.deepStrictEqual(
      read.services.map((service) => service.hostname),
      ["api", "mail", "db"],
    );
    assert.strictEqual(
      read.services.find((service) => service.hostname === "db")?.block,
      reordered.services[0]?.block,
    );
  });

  it.each([
    { name: "no YAML", yaml: "services: [", problem: "not_yaml" },
    { name: "a service with no hostname", yaml: "services:\n  - type: x\n", problem: "invalid" },
    {
      name: "a hostname twice",
      yaml: "services:\n  - hostname: a\n  - hostname: a\n",
      problem: "hostname_twice",
    },
  ])("refuses $name", ({ yaml, problem }) => {
    const read = tierServices(yaml);
    assert.isFalse(read.ok);
    if (!read.ok) assert.strictEqual(read.problem, problem);
  });
});

describe("isPublicBuild", () => {
  // Main D19: a utility the platform builds from a public recipe.
  it.each([
    { url: "https://github.com/zeropsio/recipe-mailpit", public: true },
    { url: "https://gitlab.com/group/project", public: true },
    { url: "https://user:secret@github.com/zeropsio/x", public: false },
    { url: "https://github.com:8443/zeropsio/x", public: false },
    { url: "https://github.com/zeropsio/x?ref=main", public: false },
    { url: `https://hq.example.test/git/${APP}/api.git`, public: false },
    { url: "http://github.com/zeropsio/x", public: false },
  ])("$url: $public", ({ url, public: expected }) => {
    assert.strictEqual(isPublicBuild(url), expected);
  });
});

describe("deltaImport", () => {
  // Main D15: what a delta imports is created empty — the platform cannot clone HQ's repository —
  // and deployed by HQ; a public build keeps its build, a managed service passes through; the
  // preprocessor stays on where a directive needs it.
  it("imports a runtime without code, a public build and a managed service as declared", () => {
    const read = tierServices(TIER);
    assert.isTrue(read.ok);
    if (!read.ok) return;
    const doc = deltaImport(read.services);
    assert.isTrue(doc.startsWith("#zeropsPreprocessor=on\n"));
    const imported = tierServices(doc);
    assert.isTrue(imported.ok);
    if (!imported.ok) return;
    const [api, mail, db] = imported.services.map((service) => service.declaration);
    assert.deepStrictEqual(api, {
      hostname: "api",
      type: "nodejs@22",
      priority: 5,
      envSecrets: { APP_KEY: "<@generateRandomString(<32>)>" },
      startWithoutCode: true,
    });
    assert.deepStrictEqual(mail, {
      hostname: "mail",
      type: "nodejs@22",
      buildFromGit: "https://github.com/zeropsio/recipe-mailpit",
      zeropsSetup: "mail",
    });
    assert.deepStrictEqual(db, { hostname: "db", type: "postgresql@16", mode: "NON_HA" });
  });

  it("leaves the preprocessor off where no directive needs it", () => {
    const read = tierServices("services:\n  - hostname: db\n    type: postgresql@16\n");
    assert.isTrue(read.ok);
    if (read.ok) assert.isFalse(deltaImport(read.services).includes("zeropsPreprocessor"));
  });
});
