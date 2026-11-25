import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";

import { definePlayground, jsxElement } from "../kitPlayground";

const CHOICES = ["Light", "Dark", "System"] as const;

export default definePlayground({
  section: "toggle-group",
  name: "ToggleGroup",
  imports: 'import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";',
  controls: {
    variant: {
      kind: "enum",
      options: ["segmented", "default", "outline"],
      note: "segmented for one of a few",
    },
    size: { kind: "enum", options: ["segmented", "segmented-sm", "compact", "default", "sm"] },
    value: { kind: "enum", options: CHOICES },
    disabled: { kind: "boolean" },
  },
  initial: { variant: "segmented", size: "segmented", value: "Dark", disabled: false },
  render: ({ variant, size, value, disabled }) => (
    <ToggleGroup
      aria-label="Appearance"
      disabled={disabled}
      size={size}
      value={[value]}
      variant={variant}
    >
      {CHOICES.map((choice) => (
        <Toggle key={choice} value={choice}>
          {choice}
        </Toggle>
      ))}
    </ToggleGroup>
  ),
  jsx: ({ variant, size, value, disabled }) =>
    jsxElement(
      "ToggleGroup",
      { "aria-label": "Appearance", variant, size, disabled, [`value={["${value}"]}`]: true },
      CHOICES.map((choice) => `<Toggle value="${choice}">${choice}</Toggle>`).join("\n"),
      { variant: "segmented", size: "segmented", disabled: false },
    ),
  usage: {
    do: ["Use the segmented variant for one of two to four short choices."],
    dont: ["Let it reach none pressed when one must stay chosen."],
  },
});
