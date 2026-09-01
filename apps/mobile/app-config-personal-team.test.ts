// @effect-diagnostics nodeBuiltinImport:off -- This architecture test verifies native build policy.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

const read = (relativePath: string) =>
  NodeFS.readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("iOS personal-team configuration", () => {
  it("uses the local team, disables OTA, and runs the entitlement stripper last", () => {
    const config = read("app.config.ts");
    const personalPlugin = '"./plugins/withoutIosPersonalTeamCapabilities.cjs"';

    expect(config).toContain("T3CODE_IOS_PERSONAL_TEAM_ID");
    expect(config).toContain("enabled: !isIosPersonalTeamBuild");
    expect(config).toContain("{ appleTeamId: personalTeamId }");
    expect(config.indexOf(personalPlugin)).toBeLessThan(config.indexOf('"expo-asset"'));
  });

  it("strips every capability a free personal team cannot sign", () => {
    const plugin = read("plugins/withoutIosPersonalTeamCapabilities.cjs");
    expect(plugin).toContain('delete modConfig.modResults["aps-environment"]');
    expect(plugin).toContain(
      'delete modConfig.modResults["com.apple.developer.associated-domains"]',
    );
    expect(plugin).toContain('delete modConfig.modResults["com.apple.developer.applesignin"]');
    expect(plugin).toContain(
      'delete modConfig.modResults["com.apple.security.application-groups"]',
    );
  });
});
