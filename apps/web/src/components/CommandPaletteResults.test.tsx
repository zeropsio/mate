import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { CommandPaletteResults } from "./CommandPaletteResults";

const render = (emptyStateMessage: string) =>
  renderToStaticMarkup(
    <CommandPaletteResults
      emptyStateMessage={emptyStateMessage}
      groups={[]}
      isActionsOnly={false}
      keybindings={[] as never}
      onExecuteItem={() => {}}
    />,
  );

describe("CommandPaletteResults: an empty result says nothing while unread, in a line's room", () => {
  it("holds the sentence's line, with nothing read out, while the lists are unread", () => {
    const text = render("").replace(/<[^>]*>/gu, "");
    expect(text).toBe(" ");
    expect(render("")).toContain('aria-hidden="true"');
  });

  it("says the sentence once read", () => {
    expect(render("No matching commands, projects, or threads.")).toContain(
      "No matching commands, projects, or threads.",
    );
  });
});
