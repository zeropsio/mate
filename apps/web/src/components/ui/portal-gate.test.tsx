// @effect-diagnostics nodeBuiltinImport:off -- Source ownership guards read authored files directly.
import * as NodeFS from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { gatedPortal, PortalGate } from "./portal-gate";

function source(relative: string): string {
  return NodeFS.readFileSync(new URL(relative, import.meta.url), "utf8");
}

const Portal = gatedPortal(({ children }: { readonly children: ReactNode }) => (
  <section>{children}</section>
));

describe("PortalGate", () => {
  it.each([
    [false, "<section>A project name</section>"],
    [true, ""],
  ] as const)("closed = %s renders %j", (closed, markup) => {
    expect(
      renderToStaticMarkup(
        <PortalGate closed={closed}>
          <Portal>A project name</Portal>
        </PortalGate>,
      ),
    ).toBe(markup);
  });

  it("an ungated portal renders its content", () => {
    expect(renderToStaticMarkup(<Portal>A project name</Portal>)).toBe(
      "<section>A project name</section>",
    );
  });

  // Every floating layer — dialog, popover, sheet, tooltip, combobox, toast —
  // leaves the document when the gate closes, so none sits beside a lapse's
  // overlay (DESIGN §10 0.10).
  it.each([
    "./alert-dialog.tsx",
    "./autocomplete.tsx",
    "./combobox.tsx",
    "./command.tsx",
    "./dialog.tsx",
    "./menu.tsx",
    "./popover.tsx",
    "./select.tsx",
    "./sheet.tsx",
    "./toast.tsx",
    "./tooltip.tsx",
  ])("%s renders every portal through the gate", (file) => {
    const contents = source(file);
    const portals = [...contents.matchAll(/\b\w+\.Portal\b(?!\.Props)/g)];
    expect(portals.length).toBeGreaterThan(0);
    for (const portal of portals) {
      expect(contents.slice(portal.index - "gatedPortal(".length, portal.index)).toBe(
        "gatedPortal(",
      );
    }
  });
});
