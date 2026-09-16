// @effect-diagnostics nodeBuiltinImport:off -- This test reads the import document it verifies.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import { GITEA_PROJECT_IMPORT_YAML } from "./giteaProjectImport.gen.ts";
import {
  buildGiteaImportYaml,
  GITEA_IMPORT_PLACEHOLDERS,
  GITEA_MATE_REPOSITORY,
} from "./giteaRecipe.ts";

const IMPORT = {
  region: "prg1",
  appOrigins: ["https://app.zerops.io", "http://localhost:5733/"],
  appUrl: "https://app.zerops.io/",
  clientId: "org-1",
  projectId: "proj-1",
  brokerToken: "BROKER-TOKEN-VALUE",
} as const;

/** The copy this package ships, as bytes. */
const copyUrl = new URL("./giteaProjectImport.yaml", import.meta.url);
/** The document's home, when that checkout sits beside this one. */
const repoUrl = new URL("../../../../../gitea-mate/import/gitea-project.yaml", import.meta.url);

describe("the copied import document", () => {
  it("is what the generated module carries", () => {
    expect(GITEA_PROJECT_IMPORT_YAML).toBe(NodeFS.readFileSync(copyUrl, "utf8"));
  });

  it("is byte-identical to the one in `zeropsio/gitea-mate`", (context) => {
    if (!NodeFS.existsSync(repoUrl)) {
      // The document's home is a sibling checkout, not a dependency; CI has
      // only the copy, and the copy is what ships.
      context.skip();
      return;
    }
    expect(NodeFS.readFileSync(copyUrl, "utf8")).toBe(NodeFS.readFileSync(repoUrl, "utf8"));
  });

  it("declares every placeholder the build knows how to fill, and no other", () => {
    expect(GITEA_IMPORT_PLACEHOLDERS).toEqual([
      "__CORS__",
      "__MATE_APP_URL__",
      "__REGION__",
      "__ZEROPS_CLIENT_ID__",
      "__ZEROPS_PROJECT_ID__",
      "__ZEROPS_TOKEN__",
    ]);
  });
});

describe("the Gitea import", () => {
  it("leaves no placeholder in the document", () => {
    const yaml = buildGiteaImportYaml(IMPORT);
    for (const placeholder of GITEA_IMPORT_PLACEHOLDERS) {
      expect(yaml, placeholder).not.toContain(placeholder);
    }
    expect(yaml).not.toMatch(/__[A-Z_]+__/u);
  });

  it("fills every blank the app is the only one to know", () => {
    const yaml = buildGiteaImportYaml(IMPORT);
    expect(yaml).toContain("GITEA_DOMAIN: web-${zeropsSubdomainHost}-3000.prg1.zerops.app");
    expect(yaml).toContain("MATE_ZEROPS_API_URL: https://api.app-prg1.zerops.io");
    expect(yaml).toContain("MATE_ZEROPS_CLIENT_ID: org-1");
    expect(yaml).toContain("MATE_ZEROPS_PROJECT_ID: proj-1");
    expect(yaml).toContain("MATE_APP_URL: https://app.zerops.io");
    expect(yaml).toContain("value: BROKER-TOKEN-VALUE");
  });

  it("names no variable `ZEROPS_*`, which the import endpoint refuses", () => {
    // `400 userDataZeropsPrefixForbidden`, case-insensitive, and it fails the
    // whole document — sign-up would stop at the import (measured 2026-09-16).
    const yaml = buildGiteaImportYaml(IMPORT);
    for (const [, key] of yaml.matchAll(/^\s{6}(\w+):/gmu)) {
      expect(
        key?.toLowerCase().startsWith("zerops_"),
        `${key ?? ""} is refused by the import`,
      ).toBe(false);
    }
    expect(yaml).not.toMatch(/^\s+zerops_\w+:/imu);
  });

  it("lists every app origin literally, comma-separated, without a trailing slash", () => {
    // ALLOW_DOMAIN matches the origin string: localhost does not cover
    // 127.0.0.1, and a port is part of the string.
    expect(buildGiteaImportYaml(IMPORT)).toContain(
      "GITEA_CORS_ALLOW_DOMAIN: https://app.zerops.io,http://localhost:5733",
    );
  });

  it("refuses a document that would answer no browser origin at all", () => {
    expect(() => buildGiteaImportYaml({ ...IMPORT, appOrigins: [] })).toThrow(/origin/u);
    expect(() => buildGiteaImportYaml({ ...IMPORT, appOrigins: ["", "  /"] })).toThrow(/origin/u);
  });

  it("builds Gitea and the broker from one repository, each picking its half", () => {
    const yaml = buildGiteaImportYaml(IMPORT);
    expect(yaml).toContain("zeropsSetup: gitea");
    expect(yaml).toContain("zeropsSetup: broker");
    expect(yaml.split(`buildFromGit: ${GITEA_MATE_REPOSITORY}\n`)).toHaveLength(3);
  });

  it("runs one Postgres rather than a cluster, and imports no runner", () => {
    const yaml = buildGiteaImportYaml(IMPORT);
    expect(yaml).toContain("type: postgresql@18");
    expect(yaml).toContain("mode: NON_HA");
    expect(yaml).not.toContain("postgresql:ha");
    // The broker imports one per group when that group's first workflow
    // appears; an account that never adds a project runs none.
    expect([...yaml.matchAll(/^ {2}- hostname: (\S+)$/gmu)].map(([, name]) => name)).toEqual([
      "db",
      "volume",
      "web",
      "broker",
    ]);
  });

  it("generates the broker's own secrets inside the import, not in the browser", () => {
    const yaml = buildGiteaImportYaml(IMPORT);
    expect(yaml.startsWith("#zeropsPreprocessor=on")).toBe(true);
    for (const key of ["GITEA_WEBHOOK_SECRET", "OIDC_CLIENT_SECRET", "OIDC_SEED"]) {
      expect(yaml, key).toMatch(
        new RegExp(`${key}:\\n\\s+value: <@generateRandomString\\(<64>\\)>`, "u"),
      );
    }
  });

  it("references Gitea's admin credential rather than copying it, and marks it sensitive", () => {
    // A reference resolves in the broker's container and nowhere else. The
    // broker needs the password as well as the token: Gitea's token routes
    // answer 401 to an API token, however privileged.
    const yaml = buildGiteaImportYaml(IMPORT);
    expect(yaml).toMatch(
      /GITEA_ADMIN_TOKEN:\n\s+value: \$\{web_GITEA_ADMIN_TOKEN\}\n\s+sensitive: true/u,
    );
    expect(yaml).toMatch(
      /GITEA_ADMIN_PASSWORD:\n\s+value: \$\{web_GITEA_ADMIN_PASSWORD\}\n\s+sensitive: true/u,
    );
    expect(yaml).toContain("GITEA_ADMIN_USERNAME: admin");
  });

  it("carries no project block, which the import endpoint rejects", () => {
    expect(buildGiteaImportYaml(IMPORT)).not.toMatch(/^project:/mu);
  });
});
