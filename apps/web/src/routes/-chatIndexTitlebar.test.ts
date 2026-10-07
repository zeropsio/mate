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

/**
 * Every declaration of `property` in a stylesheet, in source order, with the
 * selectors and at-rules it stands in (`[":root", "@variant md"]`).
 */
function declarationsOf(
  sheet: string,
  property: string,
): ReadonlyArray<{ readonly context: ReadonlyArray<string>; readonly value: string }> {
  const found: Array<{ readonly context: ReadonlyArray<string>; readonly value: string }> = [];
  const stack: string[] = [];
  let segment = "";
  for (const character of sheet.replace(/\/\*[\s\S]*?\*\//gu, "")) {
    if (character === "{") {
      stack.push(segment.trim());
      segment = "";
    } else if (character === "}") {
      stack.pop();
      segment = "";
    } else if (character === ";") {
      const [name, ...value] = segment.split(":");
      if (name?.trim() === property) {
        found.push({ context: [...stack], value: value.join(":").trim() });
      }
      segment = "";
    } else {
      segment += character;
    }
  }
  return found;
}

describe("the top bar's height", () => {
  // One height for every top row: the menu's logo row and each page's header
  // beside it (the owner, 2026-09-29: the whole top bar at 65, so the logo,
  // the conversation's header and their bottom edges stand on one line).
  // Where the menu stands beside the page (md up) that is 65 px, so the
  // menu's 33 px mark, centred in it, stands 16 px from the top as from the
  // left; on a phone the menu is a sheet over the page and the bar keeps 52;
  // a desktop window's bar is its title bar — 52 beside macOS's traffic
  // lights (`MACOS_WORKSPACE_TOPBAR_HEIGHT`), the overlay's own on Windows.
  const sheet = NodeFS.readFileSync(new URL("../index.css", import.meta.url), "utf8");
  const declarations = declarationsOf(sheet, "--workspace-topbar-height");
  // Every selector here weighs the same, so the last one that applies wins.
  const resolve = (shell: { readonly md: boolean; readonly classes: ReadonlyArray<string> }) =>
    declarations.findLast(({ context }) =>
      context.every(
        (part) =>
          part === ":root" ||
          (part === "@variant md" && shell.md) ||
          (part.startsWith(".") && shell.classes.includes(part.slice(1))),
      ),
    )?.value;

  it.each([
    { shell: "a phone's browser", md: false, classes: [], height: "52px" },
    { shell: "a browser beside the menu", md: true, classes: [], height: "4.0625rem" },
    { shell: "a macOS desktop window", md: true, classes: ["electron"], height: "52px" },
    {
      shell: "a Windows desktop window",
      md: true,
      classes: ["electron", "electron-windows", "wco"],
      height: "max(40px, env(titlebar-area-height, 52px))",
    },
  ])("is $height in $shell", ({ md, classes, height }) => {
    expect(resolve({ md, classes })).toBe(height);
  });

  it("stands the menu's 33 px mark 16 px from the top beside the page", () => {
    const height = /^([\d.]+)(rem|px)$/u.exec(resolve({ md: true, classes: [] }) ?? "");
    const px = Number(height?.[1]) * (height?.[2] === "rem" ? 16 : 1);
    expect((px - 33) / 2).toBe(16);
  });
});
