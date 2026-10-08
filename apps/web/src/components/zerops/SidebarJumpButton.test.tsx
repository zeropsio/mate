import { markupDom } from "../../../test/markupDom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SidebarJumpButton } from "./SidebarJumpButton";

describe("SidebarJumpButton", () => {
  const button = (shortcut: string | undefined) =>
    renderToStaticMarkup(<SidebarJumpButton onJump={() => {}} shortcut={shortcut} />);

  // One control with its key inside it, in the logo row: nothing beside it
  // reads as the key's owner (M12).
  it.each([
    { shortcut: "⌘K", keys: "Meta+K /" },
    { shortcut: "Ctrl+K", keys: "Control+K /" },
    { shortcut: undefined, keys: "/" },
  ])("carries its key $shortcut inside it and names it as $keys", ({ shortcut, keys }) => {
    const html = button(shortcut);
    expect(html).toContain('data-zerops-surface="sidebar-jump"');
    expect(html).toContain(`aria-keyshortcuts="${keys}"`);
    expect(html).toContain('aria-label="Jump to a Mate, project, change or stop"');
    if (shortcut === undefined)
      expect(markupDom(html).querySelector("button")?.textContent).toBe("");
    else expect(html).toContain(`>${shortcut}</span>`);
  });

  it("displays the shortcut inside the named jump control", () => {
    const html = button("⌘K");
    const control = markupDom(html).querySelector("button");
    expect(control?.textContent).toContain("⌘K");
    expect(control?.getAttribute("aria-label")).toBe("Jump to a Mate, project, change or stop");
  });
});
