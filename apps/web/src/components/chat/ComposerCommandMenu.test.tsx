import { markupDom } from "../../../test/markupDom";
import { renderToStaticMarkup } from "react-dom/server";
import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { ComposerCommandMenu, composerSuggestionOptionId } from "./ComposerCommandMenu";

describe("composerSuggestionOptionId", () => {
  it("keeps every suggestion's option apart, in one composer and across composers", () => {
    const paths = [
      "docs/my file.md",
      "docs/my_file.md",
      "docs/my%20file.md",
      "docs/my\tfile.md",
      "docs/\ud800.md",
      "docs/\ud801.md",
      "docs/\udc00.md",
      "docs/\ufffd.md",
      "docs/\\ud800.md",
      "docs/\ud83d\ude80.md",
    ];
    const ids = paths.map((path) => composerSuggestionOptionId("suggestions", `path:file:${path}`));

    expect(new Set(ids).size).toBe(paths.length);
    for (const id of ids) expect(id).not.toMatch(/\s|[\ud800-\udfff]/u);
    expect(composerSuggestionOptionId("other-composer", paths[0]!)).not.toBe(
      composerSuggestionOptionId("suggestions", paths[0]!),
    );
  });
});

describe("ComposerCommandMenu", () => {
  it("names its list for a screen reader and marks the option the keys are on", () => {
    const markup = renderToStaticMarkup(
      <ComposerCommandMenu
        listId="test-suggestions"
        items={[
          {
            id: "path:file:src/a.ts",
            type: "path",
            path: "src/a.ts",
            pathKind: "file",
            label: "a.ts",
            description: "src",
          },
          {
            id: "path:file:src/b.ts",
            type: "path",
            path: "src/b.ts",
            pathKind: "file",
            label: "b.ts",
            description: "src",
          },
        ]}
        resolvedTheme="dark"
        isLoading={false}
        triggerKind="path"
        activeItemId="path:file:src/b.ts"
        onHighlightedItemChange={() => {}}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain('id="test-suggestions"');
    expect(markup).toContain('aria-label="Files and folders"');
    const active = composerSuggestionOptionId("test-suggestions", "path:file:src/b.ts");
    const other = composerSuggestionOptionId("test-suggestions", "path:file:src/a.ts");
    expect(markup).toMatch(
      new RegExp(`id="${active}"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="${active}"`),
    );
    expect(markup).toMatch(
      new RegExp(`id="${other}"[^>]*aria-selected="false"|aria-selected="false"[^>]*id="${other}"`),
    );
  });

  it("renders slash-command results as an attached composer drawer", () => {
    const markup = renderToStaticMarkup(
      <ComposerCommandMenu
        listId="test-suggestions"
        items={[]}
        resolvedTheme="dark"
        isLoading={false}
        triggerKind="slash-command"
        activeItemId={null}
        onHighlightedItemChange={() => {}}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain('data-composer-command-drawer="true"');
  });

  it("renders commands without a category heading or invented icons", () => {
    const markup = renderToStaticMarkup(
      <ComposerCommandMenu
        listId="test-suggestions"
        items={[
          {
            id: "slash:model",
            type: "slash-command",
            command: "model",
            label: "/model",
            description: "Switch response model for this thread",
          },
        ]}
        resolvedTheme="dark"
        isLoading={false}
        triggerKind="slash-command"
        activeItemId="slash:model"
        onHighlightedItemChange={() => {}}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain("/model");
    expect(markup).toContain("Switch response model for this thread");
    expect(markup).not.toContain("Built-in");
    expect(markup).not.toContain("<svg");
  });

  it("renders the skill source icon inside its badge", () => {
    const markup = renderToStaticMarkup(
      <ComposerCommandMenu
        listId="test-suggestions"
        items={[
          {
            id: "skill:codex:browser",
            type: "skill",
            provider: ProviderDriverKind.make("codex"),
            skill: {
              name: "browser",
              path: "/Users/maria/.codex/plugins/browser/skills/browser/SKILL.md",
              scope: "user",
              enabled: true,
            },
            label: "Browser",
            description: "Open and control the in-app browser",
          },
        ]}
        resolvedTheme="dark"
        isLoading={false}
        triggerKind="skill"
        activeItemId="skill:codex:browser"
        onHighlightedItemChange={() => {}}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain("Browser");
    expect(markup).toContain('data-slot="badge"');
    expect(markup).toContain(">App Skill</span>");
    expect(markup).toContain("Open and control the in-app browser");
    expect(markup.indexOf("Open and control the in-app browser")).toBeLessThan(
      markup.indexOf(">App Skill</span>"),
    );
    expect(markup).toContain("<svg");
    expect(markup.indexOf('data-slot="badge"')).toBeLessThan(markup.indexOf("<svg"));
  });

  it("keeps slash skills aligned with the source icon inside the badge", () => {
    const markup = renderToStaticMarkup(
      <ComposerCommandMenu
        listId="test-suggestions"
        items={[
          {
            id: "skill:codex:ask-matt",
            type: "skill",
            provider: ProviderDriverKind.make("codex"),
            skill: {
              name: "ask-matt",
              displayName: "Ask Matt",
              path: "/skills/ask-matt/SKILL.md",
              scope: "repo",
              enabled: true,
            },
            label: "/skill:ask-matt",
            description: "Find the right skill or workflow",
          },
        ]}
        resolvedTheme="dark"
        isLoading={false}
        triggerKind="slash-command"
        activeItemId="skill:codex:ask-matt"
        onHighlightedItemChange={() => {}}
        onSelect={() => {}}
      />,
    );

    expect(markupDom(markup).body.textContent).toContain("/skill:Ask Matt");
    expect(markup).toContain('data-slot="badge"');
    expect(markup).toContain(">Repo</span>");
    expect(markup).toContain("Find the right skill or workflow");
  });
  it("offers crewmates by face, handle and job", () => {
    const markup = renderToStaticMarkup(
      <ComposerCommandMenu
        listId="test-suggestions"
        items={[
          {
            id: "crewmate:backend",
            type: "crewmate",
            handle: "backend",
            tint: "sky",
            label: "@backend",
            description: "Owns the API under src/api and its tests.",
          },
        ]}
        resolvedTheme="dark"
        isLoading={false}
        triggerKind="crewmate"
        activeItemId="crewmate:backend"
        onHighlightedItemChange={() => {}}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain("@backend");
    expect(markup).toContain("Owns the API under src/api and its tests.");
    expect(markup).toContain("fill-[var(--zerops-mate-tint-sky)]");
  });

  it("says no crewmate matches when none does", () => {
    const markup = renderToStaticMarkup(
      <ComposerCommandMenu
        listId="test-suggestions"
        items={[]}
        resolvedTheme="dark"
        isLoading={false}
        triggerKind="crewmate"
        activeItemId={null}
        onHighlightedItemChange={() => {}}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain("No crewmate or file by that name.");
  });
});
