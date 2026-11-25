import type { UsageProviderKind } from "@t3tools/contracts";

import { PROVIDER_ORDER, PROVIDER_PRESENTATION } from "~/components/usage/usageProviders";

import { definePlayground, jsxElement } from "../kitPlayground";

/** Each provider's mark as `Icons.tsx` exports it: a provider added to the contract fails here. */
const MARK_NAME: Readonly<Record<UsageProviderKind, string>> = {
  codex: "OpenAI",
  claude: "ClaudeAI",
  grok: "GrokIcon",
  cursor: "CursorIcon",
  opencode: "OpenCodeIcon",
  antigravity: "AntigravityIcon",
};

/** Its holder's box: a mark takes the size it is given. */
const SIZE_CLASS = { "16": "size-4", "20": "size-5", "24": "size-6", "32": "size-8" } as const;
const SIZES = Object.keys(SIZE_CLASS) as (keyof typeof SIZE_CLASS)[];
const PLACES = ["alone", "named"] as const;

export default definePlayground({
  section: "provider-marks",
  name: "Provider marks",
  imports: `import { ${Object.values(MARK_NAME).join(", ")} } from "~/components/Icons";`,
  controls: {
    provider: { kind: "enum", options: PROVIDER_ORDER, note: "the coding agent's maker" },
    size: { kind: "enum", options: SIZES, note: "its holder's box, in px" },
    place: { kind: "enum", options: PLACES, note: "named: beside its name, as usage lists it" },
  },
  initial: { provider: "claude", size: "24", place: "alone" },
  render: ({ provider, size, place }) => {
    const { mark: Mark, label } = PROVIDER_PRESENTATION[provider];
    return place === "named" ? (
      <span className="flex items-center gap-2 text-body text-foreground">
        <Mark aria-hidden="true" className={SIZE_CLASS[size]} />
        {label}
      </span>
    ) : (
      <Mark aria-label={label} className={SIZE_CLASS[size]} role="img" />
    );
  },
  jsx: ({ provider, size, place }) => {
    const { label } = PROVIDER_PRESENTATION[provider];
    const mark = jsxElement(MARK_NAME[provider], {
      ...(place === "named" ? { "aria-hidden": "true" } : { "aria-label": label, role: "img" }),
      className: SIZE_CLASS[size],
    });
    return place === "named" ? `<span>\n  ${mark}\n  ${label}\n</span>` : mark;
  },
  usage: {
    do: [
      "Name a coding agent by its own mark beside its name: Claude Code, Codex, Cursor.",
      "Read the mark, the name and the chart colour from PROVIDER_PRESENTATION, in PROVIDER_ORDER.",
      "Give a mark standing alone an accessible name.",
    ],
    dont: [
      "Draw a Mate with a provider's mark: a Mate is its face, its agent only signs it in.",
      "Recolour a mark; the two-tone ones keep their maker's colours.",
      "Say provider in copy: it is the coding agent.",
    ],
  },
});
