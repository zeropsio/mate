import { describe, expect, it } from "vite-plus/test";

import { recipeFromProjectExport } from "./recipeExport.ts";

/** The shape `GET /project/{id}/export` returned on 2026-09-05, secrets replaced. */
const EXPORT = `project:
  name: copy of Acme Docs - stage
  tags:
    - mate:g:6sf11t2b2vga
    - mate:role:stage
  vault:
    ZCP_API_KEY: project-secret
  envIsolation: none
  sshIsolation: vpn service@zcp
  sharedIpv4: false
services:
  - hostname: zcp
    type: zcp@1
    vault:
      VSCODE_PASSWORD:
        value: container-secret
        sensitive: true
    verticalAutoscaling:
      minRam: 2
    maxContainers: 1
  - hostname: db
    type: postgresql:single@16
  - hostname: app
    type: alpine/go@1.22
    buildFromGit: https://github.com/zerops-recipe-apps/go-hello-world-app@main
    enableSubdomainAccess: true
    envSecrets:
      API_TOKEN: app-secret
    verticalAutoscaling:
      minRam: 0.25
`;

describe("recipeFromProjectExport", () => {
  it("keeps the application services and nothing above them", () => {
    const recipe = recipeFromProjectExport(EXPORT);
    expect(recipe?.services).toEqual(["db", "app"]);
    expect(recipe?.servicesYaml).toBe(`services:
  - hostname: db
    type: postgresql:single@16
  - hostname: app
    type: alpine/go@1.22
    buildFromGit: https://github.com/zerops-recipe-apps/go-hello-world-app@main
    enableSubdomainAccess: true
    verticalAutoscaling:
      minRam: 0.25
`);
  });

  it("drops the agent container, whatever it is called", () => {
    const renamed = EXPORT.replace("hostname: zcp", "hostname: agent");
    const recipe = recipeFromProjectExport(renamed);
    expect(recipe?.droppedContainers).toEqual(["agent"]);
    expect(recipe?.servicesYaml).not.toContain("zcp@");
  });

  it("removes every secret block and reports only that it did", () => {
    const recipe = recipeFromProjectExport(EXPORT);
    expect(recipe?.scrubbedBlocks).toBe(1);
    for (const secret of [
      "project-secret",
      "container-secret",
      "app-secret",
      "vault",
      "envSecrets",
    ]) {
      expect(recipe?.servicesYaml).not.toContain(secret);
    }
  });

  it("names the services that build from a repository", () => {
    // Their build setup does not survive the export; the person decides with
    // that in view.
    expect(recipeFromProjectExport(EXPORT)?.builtFromGit).toEqual(["app"]);
  });

  it("has nothing to clone from an environment that was only a container", () => {
    const bare = `project:
  name: bare
services:
  - hostname: zcp
    type: zcp@1
`;
    expect(recipeFromProjectExport(bare)).toBeUndefined();
  });

  it("has nothing to clone from an export without services", () => {
    expect(recipeFromProjectExport("project:\n  name: x\n")).toBeUndefined();
  });

  it("leaves a following top-level key out of the services", () => {
    const withTrailer = `${EXPORT}other:\n  key: value\n`;
    expect(recipeFromProjectExport(withTrailer)?.servicesYaml).not.toContain("other:");
  });
});
