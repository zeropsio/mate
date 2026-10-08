import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Command } from "./ui/command";
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

it.each([false, true])(
  "folder failures remain visible with browse-up present: %s",
  (hasBrowseUp) => {
    const html = renderToStaticMarkup(
      <Command>
        <CommandPaletteResults
          statusMessage="Listing refused."
          emptyStateMessage="Press Enter to create this folder and add it as a project."
          groups={
            hasBrowseUp
              ? [
                  {
                    value: "navigation",
                    label: "Navigation",
                    items: [
                      {
                        kind: "action",
                        value: "browse:up",
                        title: "Parent folder",
                        icon: null,
                        searchTerms: [],
                        run: async () => {},
                      },
                    ],
                  },
                ]
              : []
          }
          isActionsOnly={false}
          keybindings={[] as never}
          onExecuteItem={() => {}}
        />
      </Command>,
    );
    expect(html).toContain("Listing refused.");
    expect(html).not.toContain("Press Enter to create");
    if (hasBrowseUp) expect(html).toContain("Parent folder");
  },
);
