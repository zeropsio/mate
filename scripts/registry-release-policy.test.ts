// @effect-diagnostics nodeBuiltinImport:off - reads repository files as bytes to assert deleted paths stay deleted.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "@effect/vitest";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const read = (relativePath: string) =>
  NodeFS.readFileSync(NodePath.join(repoRoot, relativePath), "utf8");
const exists = (relativePath: string) => NodeFS.existsSync(NodePath.join(repoRoot, relativePath));

describe("registry-free server releases", () => {
  it("publishes only the supported server bundle and checksum", () => {
    const workflow = read(".github/workflows/release.yml");
    expect(workflow).toContain("needs: build");
    expect(workflow).not.toContain("build_desktop:");
    expect(workflow).not.toContain("desktop-assets");
    expect(workflow).toContain("sha256sum -c SHA256SUMS");
  });
  it("has no server-side registry installer or self-update runtime", () => {
    for (const relativePath of [
      "apps/server/src/cloud/pinnedRuntime.ts",
      "apps/server/src/cloud/selfUpdate.ts",
      "apps/server/src/cloud/serviceLauncherClient.ts",
      "apps/server/src/cloud/servicePreflight.ts",
      "apps/server/src/cloud/serviceProtocol.ts",
      "apps/server/src/serviceLauncher.ts",
      "apps/server/src/service-launcher.ts",
    ]) {
      expect(exists(relativePath), relativePath).toBe(false);
    }

    expect(read("apps/server/package.json")).not.toContain("service-launcher");
    expect(read("apps/server/src/environment/ServerEnvironment.ts")).not.toContain(
      "serverSelfUpdate",
    );
    expect(read("apps/server/src/server.ts")).not.toContain("ServiceLauncherClient");
    expect(read("apps/server/src/serverRuntimeStartup.ts")).not.toContain("prepareTrial");
  });

  it("has no maintainer command that publishes the server package to a registry", () => {
    const source = read("apps/server/scripts/cli.ts");

    expect(source).not.toContain("const publishCmd");
    expect(source).not.toContain("vp pm publish");
    expect(source).not.toContain("Publish the server package to npm");
  });

  it("has no client in-app server update action", () => {
    expect(exists("apps/web/src/components/ServerUpdateAction.tsx")).toBe(false);
    expect(read("packages/client-runtime/src/state/server.ts")).not.toContain("serverUpdateServer");
  });

  it("never reconstructs a registry-backed CLI launch command", () => {
    const invocation = read("apps/server/src/cli/invocation.ts");

    expect(invocation).not.toContain("suggestedPackageSpec");
    expect(invocation).not.toContain("detectCliRunner");
    expect(invocation).not.toContain("zerops-mate@nightly");
  });

  it("documents the GitHub release and zcp pin path without registry instructions", () => {
    const docs = read("docs/README.md");
    expect(docs).toContain("https://github.com/zeropsio/mate/releases");
    expect(docs).toContain("zcp/docs/spec-mate.md");

    const workflow = read(".github/workflows/release.yml");
    expect(workflow).toContain("VITE_BASE_PATH: /mate");
    expect(workflow).toContain("SHA256SUMS");
    expect(workflow).not.toMatch(/\b(?:npm|vp pm)\s+publish\b/);
    for (const releaseScript of [
      "scripts/update-release-package-versions.ts",
      "scripts/resolve-nightly-release.ts",
      "scripts/build-desktop-artifact.ts",
      "scripts/merge-update-manifests.ts",
    ]) {
      expect(exists(releaseScript), releaseScript).toBe(true);
    }

    for (const relativePath of [
      "CONTRIBUTING.md",
      ".github/ISSUE_TEMPLATE/via-triage.yml",
      "docs/README.md",
    ]) {
      const source = read(relativePath);
      expect(source, relativePath).not.toContain("pingdotgg/t3code");
      expect(source, relativePath).not.toMatch(
        /\b(?:npm|npx)\s+(?:install\s+)?(?:t3|zerops-mate)@/,
      );
    }
  });
});
