import { Label } from "~/components/ui/label";
import { Radio, RadioGroup } from "~/components/ui/radio-group";

import { definePlayground, jsxElement } from "../kitPlayground";

const OPTIONS = [
  { value: "team", label: "The team" },
  { value: "public", label: "Anyone with the address" },
  { value: "nobody", label: "Nobody" },
] as const;

export default definePlayground({
  section: "radio-group",
  name: "Radio",
  imports:
    'import { Label } from "~/components/ui/label";\nimport { Radio, RadioGroup } from "~/components/ui/radio-group";',
  controls: {
    disabled: { kind: "boolean", note: "the whole group" },
    optionDisabled: { kind: "boolean", note: "one option that cannot be chosen here" },
  },
  initial: { disabled: false, optionDisabled: false },
  render: ({ disabled, optionDisabled }) => (
    <RadioGroup aria-label="Who can open the preview" defaultValue="team" disabled={disabled}>
      {OPTIONS.map((option) => (
        <Label key={option.value}>
          <Radio disabled={optionDisabled && option.value === "nobody"} value={option.value} />
          {option.label}
        </Label>
      ))}
    </RadioGroup>
  ),
  jsx: ({ disabled, optionDisabled }) =>
    jsxElement(
      "RadioGroup",
      { "aria-label": "Who can open the preview", defaultValue: "team", disabled },
      OPTIONS.map((option) =>
        jsxElement(
          "Label",
          {},
          `${jsxElement("Radio", { value: option.value, disabled: optionDisabled && option.value === "nobody" }, undefined, { disabled: false })}\n${option.label}`,
        ),
      ).join("\n"),
      { disabled: false },
    ),
  usage: {
    do: [
      "Use it for one choice from two to five, every option in view at once.",
      "Put each Radio in a Label with its words, so the words pick it too.",
      "Start with the usual answer chosen.",
    ],
    dont: [
      "Use it for a setting that takes effect at once and is on or off: that is a Switch.",
      "List more options than fit in view: that is a Select or a Combobox.",
      "Draw options that need a line of their own explanation as radios: those are RadioCards.",
    ],
  },
});
