// @effect-diagnostics nodeBuiltinImport:off
// Regression coverage for the shared workspace titlebar geometry.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

describe("workspace page header", () => {
  it("uses the shared workspace topbar geometry", () => {
    const headerSource = NodeFS.readFileSync(
      new URL("../components/WorkspacePageHeader.tsx", import.meta.url),
      "utf8",
    );
    expect(headerSource).toContain("h-[var(--workspace-topbar-height)]");
    expect(headerSource).toContain("min-h-[var(--workspace-topbar-height)]");
    expect(headerSource).toContain("COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS");
  });
});
