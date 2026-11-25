import { Badge } from "~/components/ui/badge";
import { RadioGroup, RadioRow } from "~/components/ui/radio-group";

import { definePlayground, jsxElement } from "../kitPlayground";

const SIZES = ["sm", "xs"] as const;

const REPOSITORIES = [
  { value: "acme/storefront", line: "Private · connected now" },
  { value: "acme/storefront-api", line: "Private · name matches" },
  { value: "acme/marketing", line: "Public" },
] as const;

export default definePlayground({
  section: "radio-group",
  name: "RadioRow",
  imports: 'import { RadioGroup, RadioRow } from "~/components/ui/radio-group";',
  controls: {
    size: { kind: "enum", options: SIZES, note: "xs in a popup's dense list" },
    lines: { kind: "boolean", note: "a quiet line under each name" },
    badge: { kind: "boolean", note: "a mark after a name" },
    takenDisabled: { kind: "boolean", note: "one repository another project holds" },
  },
  initial: { size: "sm", lines: true, badge: true, takenDisabled: true },
  render: ({ size, lines, badge, takenDisabled }) => (
    <div className="w-96">
      <RadioGroup aria-label="Repository" defaultValue="acme/storefront" layout="list">
        {REPOSITORIES.map((repository, index) => (
          <RadioRow
            badges={badge && index === 1 ? <Badge tone="info">Suggested</Badge> : undefined}
            disabled={takenDisabled && index === 2}
            key={repository.value}
            line={lines ? repository.line : undefined}
            size={size}
            title={repository.value}
            value={repository.value}
          />
        ))}
      </RadioGroup>
    </div>
  ),
  jsx: ({ size, lines, badge, takenDisabled }) =>
    jsxElement(
      "RadioGroup",
      { "aria-label": "Repository", defaultValue: "acme/storefront", layout: "list" },
      REPOSITORIES.map((repository, index) =>
        jsxElement(
          "RadioRow",
          {
            value: repository.value,
            title: repository.value,
            line: lines ? repository.line : undefined,
            size,
            disabled: takenDisabled && index === 2,
            'badges={<Badge tone="info">Suggested</Badge>}':
              badge && index === 1 ? true : undefined,
          },
          undefined,
          { size: "sm", disabled: false },
        ),
      ).join("\n"),
      { layout: "stack" },
    ),
  usage: {
    do: [
      "Use rows for one choice from a list too long or too wordy for cards: a repository, an effort.",
      "Let the radio say which is chosen; the row lights only under the pointer.",
      "Disable a choice that cannot be made here, with its reason as its line.",
    ],
    dont: [
      "Put a check at a row's end to say it is chosen: the radio leads the row.",
      "Use it for something that opens on a press: that is a pressable Row.",
    ],
  },
});
