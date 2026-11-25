import { SkillChip } from "~/components/chat/SkillInlineText";
import { TerminalContextInlineChip } from "~/components/chat/TerminalContextInlineChip";
import type { TerminalContextKind } from "~/lib/terminalContext";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

/** What the chip names: terminal lines, a table (both `TerminalContextKind`), or a skill. */
const CHIPS = [
  ...variantsOf<TerminalContextKind>({ terminal: true, data: true }),
  "skill",
] as const;

/** The words it sits in, so its em sizing shows against them. */
const SIZES = {
  caption: "m-0 max-w-md text-caption text-foreground",
  body: "m-0 max-w-md text-body text-foreground",
  emphasis: "m-0 max-w-md text-emphasis text-foreground",
} as const;
const TEXT_SIZES = Object.keys(SIZES) as (keyof typeof SIZES)[];

export default definePlayground({
  section: "inline-chips",
  name: "Inline chips",
  imports: [
    'import { SkillChip } from "~/components/chat/SkillInlineText";',
    'import { TerminalContextInlineChip } from "~/components/chat/TerminalContextInlineChip";',
  ].join("\n"),
  controls: {
    chip: { kind: "enum", options: CHIPS, note: "terminal lines, a table, or a skill" },
    label: { kind: "text", note: "what it names, short" },
    expired: { kind: "boolean", note: "the lines it named are gone: terminal and data only" },
    text: { kind: "enum", options: TEXT_SIZES, note: "the words around it: it scales with them" },
  },
  initial: { chip: "terminal", label: "zsh 12–40", expired: false, text: "body" },
  render: ({ chip, label, expired, text }) => (
    <p className={SIZES[text]}>
      Look at{" "}
      {chip === "skill" ? (
        <SkillChip rawText={`$${label}`} skill={{ name: label, displayName: label }} />
      ) : (
        <TerminalContextInlineChip
          expired={expired}
          kind={chip}
          label={label}
          tooltipText={chip === "data" ? `Table ${label}` : `Terminal lines ${label}`}
        />
      )}{" "}
      and tell me why the build stopped.
    </p>
  ),
  jsx: ({ chip, label, expired }) =>
    chip === "skill"
      ? jsxElement("SkillChip", {
          rawText: `$${label}`,
          [`skill={{ name: "${label}", displayName: "${label}" }}`]: true,
        })
      : jsxElement(
          "TerminalContextInlineChip",
          {
            kind: chip,
            label,
            tooltipText: chip === "data" ? `Table ${label}` : `Terminal lines ${label}`,
            expired,
          },
          undefined,
          { kind: "terminal", expired: false },
        ),
  usage: {
    do: [
      "Name a thing the person attached inside their words: terminal lines, a table, a skill.",
      "Let it take the size of the text it sits in: it is set in em.",
      "Say in its tooltip what it holds in full.",
    ],
    dont: [
      "Use it as a label beside a row: that is a Badge.",
      "Make it a press of its own inside a sentence.",
    ],
  },
});
