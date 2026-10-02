import { describe, expect, it } from "vite-plus/test";

import { rewriteTier } from "./importTiers.ts";

const HQ = "https://hqzone.prg1-zerops.zone";
const APP = "0b7c4c1e-9f1d-4a43-8f43-6d2b8a1c2e10";
const at = {
  host: "web-318e-3000.prg1.zerops.app",
  owner: "medusa",
  repos: ["group", "medusadev", "nextstoredev"],
  to: (repo: string) => `${HQ}/git/${APP}/${repo}.git`,
};
const tier = (...lines: ReadonlyArray<string>) => [...lines, ""].join("\n");

describe("a recipe tier, rewritten to build from HQ", () => {
  it("moves each runtime built from the application's own Gitea repository, and nothing else", () => {
    const rewritten = rewriteTier(
      tier(
        "# The stage: both halves built from the group's repositories.",
        "services:",
        "  - hostname: medusastage",
        "    type: nodejs@22",
        "    buildFromGit: https://web-318e-3000.prg1.zerops.app/medusa/medusadev.git # backend",
        "    zeropsSetup: medusa",
        "  - hostname: storestage",
        '    buildFromGit: "https://web-318e-3000.prg1.zerops.app/medusa/nextstoredev"',
        "    zeropsSetup: store",
        "  - hostname: mailpit",
        "    buildFromGit: https://github.com/zeropsio/recipe-mailpit",
        "  - hostname: db",
        "    type: postgresql@16",
      ),
      at,
    );
    expect(rewritten.content).toBe(
      tier(
        "# The stage: both halves built from the group's repositories.",
        "services:",
        "  - hostname: medusastage",
        "    type: nodejs@22",
        `    buildFromGit: ${HQ}/git/${APP}/medusadev.git # backend`,
        "    zeropsSetup: medusa",
        "  - hostname: storestage",
        `    buildFromGit: "${HQ}/git/${APP}/nextstoredev.git"`,
        "    zeropsSetup: store",
        "  - hostname: mailpit",
        "    buildFromGit: https://github.com/zeropsio/recipe-mailpit",
        "  - hostname: db",
        "    type: postgresql@16",
      ),
    );
    expect(rewritten.rewritten).toEqual([5, 8]);
    expect(rewritten.notes).toEqual([]);
  });

  it.each([
    [
      "another org's repository",
      "    buildFromGit: https://web-318e-3000.prg1.zerops.app/heron/appdev.git",
      "line 2 builds from heron/appdev on Gitea, no repository of this application's",
    ],
    [
      "a repository the bundle lacks",
      "    buildFromGit: https://web-318e-3000.prg1.zerops.app/medusa/admin.git",
      "line 2 builds from medusa/admin on Gitea, which the bundle does not bring",
    ],
    [
      "another host, neither HQ's nor a public one",
      "    buildFromGit: https://git.example.com/medusa/medusadev.git",
      "line 2 builds from git.example.com, neither Gitea's nor a public host",
    ],
    [
      "Gitea named outside a build",
      "    envSecrets: { GITEA_URL: https://web-318e-3000.prg1.zerops.app }",
      "line 2 names Gitea",
    ],
  ])("leaves %s as it is, and says so", (_name, line, note) => {
    const content = tier("services:", line);
    const rewritten = rewriteTier(content, at);
    expect([rewritten.content, rewritten.rewritten, rewritten.notes]).toEqual([
      content,
      [],
      [note],
    ]);
  });
});
