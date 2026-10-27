import { ProviderDriverKind, type ServerProviderModel } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerAccessControl, ComposerModelChoices } from "./ComposerModelControl";

const SONNET: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    isCustom: false,
    capabilities: {
      optionDescriptors: [
        {
          id: "effort",
          label: "Reasoning",
          type: "select",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High", isDefault: true },
            { id: "xhigh", label: "Extra High" },
            { id: "max", label: "Max" },
            { id: "ultrathink", label: "Ultrathink" },
          ],
          promptInjectedValues: ["ultrathink"],
        },
        {
          id: "contextWindow",
          label: "Context Window",
          type: "select",
          options: [
            { id: "200k", label: "200k", isDefault: true },
            { id: "1m", label: "1M" },
          ],
        },
      ],
    },
  },
];

function sonnetChoices(prompt: string) {
  return renderToStaticMarkup(
    <ComposerModelChoices
      traits={{
        provider: ProviderDriverKind.make("claudeAgent"),
        models: SONNET,
        model: "claude-sonnet-5",
        prompt,
        onPromptChange: () => {},
        planModeEnabled: false,
        onModelOptionsChange: () => {},
      }}
      runtimeMode="full-access"
      onRuntimeModeChange={() => {}}
    />,
  );
}

describe("ComposerModelChoices", () => {
  // Every access stays reachable from the one control's menu, the usual one
  // included, with the chosen one said in a sentence.
  it("offers every access, the chosen one checked and said", () => {
    const markup = renderToStaticMarkup(
      <ComposerModelChoices
        traits={null}
        runtimeMode="full-access"
        onRuntimeModeChange={() => {}}
      />,
    );

    for (const access of ["Supervised", "Auto-accept edits", "Auto", "Full access"]) {
      expect(markup).toContain(`>${access}<`);
    }
    expect(markup.match(/role="radio"/g)).toHaveLength(4);
    expect(markup.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(markup).toContain("Allow commands and edits without prompts.");
  });
});

describe("ComposerModelChoices with a model's efforts", () => {
  // The effort levels are in the one menu, each a choice, the chosen one
  // checked — and "ultrathink" in the prompt's own words holds them.
  it.each<{
    readonly prompt: string;
    readonly checked: ReadonlyArray<string>;
    readonly held: boolean;
  }>([
    { prompt: "", checked: ["High", "200k", "Full access"], held: false },
    {
      prompt: "Ultrathink:\nfix the build",
      checked: ["Ultrathink", "200k", "Full access"],
      held: false,
    },
    {
      prompt: "please ultrathink about it",
      checked: ["Ultrathink", "200k", "Full access"],
      held: true,
    },
  ])("prompt $prompt: checks $checked", ({ prompt, checked, held }) => {
    const markup = sonnetChoices(prompt);

    expect(markup).toContain(">Reasoning<");
    expect(markup).toContain(">Context Window<");
    expect(markup.match(/role="radio"/g)).toHaveLength(6 + 2 + 4);
    const chosen = [...markup.matchAll(/aria-checked="true"[^>]*>(?:<[^>]+>)*([^<]+)</g)].map(
      (match) => match[1],
    );
    expect(chosen).toEqual(checked);
    expect(markup.includes("Your prompt says &quot;ultrathink&quot;")).toBe(held);
  });
});

describe("ComposerAccessControl", () => {
  it("says the unusual access in the toolbar, opened by the access shortcut", () => {
    const markup = renderToStaticMarkup(
      <ComposerAccessControl runtimeMode="approval-required" onRuntimeModeChange={() => {}} />,
    );

    expect(markup).toContain("Supervised");
    expect(markup).toContain('data-composer-shortcut="composer.mode"');
  });
});
