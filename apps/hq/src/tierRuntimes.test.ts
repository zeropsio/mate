import { assert, describe, it } from "@effect/vitest";

import { tierRuntimes } from "./tierRuntimes.ts";

const APP = "0b7c1d2e-0000-4000-8000-000000000001";
const repo = (name: string) => `https://hq.example.test/git/${APP}/${name}.git`;

describe("tierRuntimes", () => {
  // Main B10/B11: the runtimes HQ deploys are those built from one of the application's own
  // repositories with a setup; a database, a public build or another application's repository is
  // the import's alone. Higher priority first, ties in the file's order.
  it("answers the application's runtimes in the order the platform builds them", () => {
    const yaml = [
      "#zeropsPreprocessor=on",
      "project:",
      "  name: Shop - stage",
      "services:",
      "  - hostname: db",
      "    type: postgresql@16",
      "    priority: 10",
      "  - hostname: web",
      "    type: nodejs@22",
      `    buildFromGit: ${repo("web")}`,
      "    zeropsSetup: web",
      "  - hostname: api",
      "    type: go@1",
      `    buildFromGit: ${repo("api")}`,
      "    zeropsSetup: api",
      "    priority: 5",
      "  - hostname: worker",
      "    type: nodejs@22",
      `    buildFromGit: https://hq.example.test/git/${APP}/api`,
      "    zeropsSetup: worker",
      "  - hostname: mail",
      "    type: nodejs@22",
      "    buildFromGit: https://github.com/zeropsio/recipe-mailpit",
      "    zeropsSetup: mail",
      "  - hostname: other",
      "    type: nodejs@22",
      "    buildFromGit: https://hq.example.test/git/another-app/web.git",
      "    zeropsSetup: other",
      "  - hostname: nosetup",
      "    type: nodejs@22",
      `    buildFromGit: ${repo("web")}`,
      "",
    ].join("\n");
    assert.deepStrictEqual(tierRuntimes(yaml, APP), {
      ok: true,
      runtimes: [
        { hostname: "api", repo: "api", zeropsSetup: "api", priority: 5 },
        { hostname: "web", repo: "web", zeropsSetup: "web", priority: 0 },
        { hostname: "worker", repo: "api", zeropsSetup: "worker", priority: 0 },
      ],
    });
  });

  it.each([
    { name: "a file that is no YAML", yaml: "services: [", problem: "not_yaml" },
    {
      name: "a service with no hostname",
      yaml: "services:\n  - type: nodejs@22\n",
      problem: "invalid",
    },
    {
      name: "a hostname used twice",
      yaml: "services:\n  - hostname: web\n  - hostname: web\n",
      problem: "hostname_twice",
    },
  ])("refuses $name", ({ yaml, problem }) => {
    const read = tierRuntimes(yaml, APP);
    assert.isFalse(read.ok);
    if (!read.ok) assert.strictEqual(read.problem, problem);
  });

  it("answers no runtimes for a file with no services", () => {
    assert.deepStrictEqual(tierRuntimes("project:\n  name: x\n", APP), { ok: true, runtimes: [] });
  });
});
