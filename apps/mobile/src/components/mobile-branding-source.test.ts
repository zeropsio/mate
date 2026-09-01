// @effect-diagnostics nodeBuiltinImport:off -- This architecture test verifies native brand consumers.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

const componentRoot = new URL("./", import.meta.url);
const mobileRoot = new URL("../../", import.meta.url);

function readSource(relativePath: string): string {
  return NodeFS.readFileSync(new URL(relativePath, mobileRoot), "utf8");
}

describe("mobile native branding", () => {
  it("renders the canonical shared Zerops mark in both native brand headers", () => {
    const markUrl = new URL("ZeropsMark.tsx", componentRoot);
    expect(NodeFS.existsSync(markUrl)).toBe(true);
    if (!NodeFS.existsSync(markUrl)) return;

    const mark = NodeFS.readFileSync(markUrl, "utf8");
    const compactTitle = readSource("src/components/CompactBrandTitle.tsx");
    const brandMark = readSource("src/components/BrandMark.tsx");
    const homeHeader = readSource("src/features/home/HomeHeader.tsx");
    const workspaceTitle = readSource("src/features/home/WorkspaceConnectionTitle.tsx");
    const threadSidebar = readSource("src/features/threads/ThreadNavigationSidebar.tsx");

    expect(mark).toContain('import { ZEROPS_MARK } from "@t3tools/shared/brand"');
    expect(mark).toContain("ZEROPS_MARK.paths.map");
    for (const consumer of [brandMark, compactTitle, homeHeader]) {
      expect(consumer).toContain("<ZeropsMark");
      expect(consumer).not.toContain("T3Wordmark");
    }
    expect(brandMark).not.toContain("black-ios-1024.png");
    // The custom leading-item path renders as an empty slot in a production
    // iOS 26 build. Keep the brand in the stable title slot and explicitly opt
    // out of the editor navigation style.
    expect(compactTitle).toContain('unstable_navigationItemStyle: "navigator"');
    expect(workspaceTitle).toContain(
      'unstable_navigationItemStyle: opts.navigationItemStyle ?? "navigator"',
    );
    expect(compactTitle).toContain("headerTitle: renderCompactBrandTitle");
    expect(workspaceTitle).toContain("brand={<CompactBrandTitle allowFontScaling />}");
    expect(compactTitle).not.toContain("unstable_headerLeftItems:");
    expect(workspaceTitle).not.toContain("unstable_headerLeftItems:");
    expect(threadSidebar).toContain('navigationItemStyle: "editor"');
  });

  it("does not expose the retired T3 Connect name on connection and settings surfaces", () => {
    const source = [
      "src/connection/platform.ts",
      "src/features/connection/ConnectionEnvironmentRow.tsx",
      "src/features/settings/SettingsRouteScreen.tsx",
    ]
      .map(readSource)
      .join("\n");

    expect(source).not.toContain("T3 Connect");
  });
});
